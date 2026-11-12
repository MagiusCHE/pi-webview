// Idle-sleep guard for the host machine (concept: keep the computer awake only
// while pi is actually working, never just because the bridge is running).
//
// The bridge owns the pi process, so it is the only place that can watch a run
// from start to settle and cover every runtime connected to it: the standalone
// page, the Chrome side panel (even when the panel is closed) and any other
// client of the same bridge. IDE companions spawn their own pi, so they are out
// of scope here.
//
// What can be prevented and what cannot (all platforms):
// - idle system sleep: yes, this is what the guard holds;
// - display sleep: no, the screen may still turn off (usually desirable);
// - lid close on a laptop, manual sleep, critical battery: no API can veto
//   those, they need OS-level configuration (`pmset -a disablesleep` on macOS).
//
// Every child watches the bridge pid, so a crashed or SIGKILLed bridge never
// leaves an orphan assertion behind.

import { spawn, type ChildProcess } from "node:child_process";

export interface SleepGuardCommand {
  command: string;
  args: string[];
}

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED: keep the system awake until this process
// exits. SetThreadExecutionState is per-thread, so the helper has to stay alive.
const WINDOWS_SCRIPT = `
$sig = @"
using System;
using System.Runtime.InteropServices;
public static class PiWebviewSleep {
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
Add-Type -TypeDefinition $sig
[void][PiWebviewSleep]::SetThreadExecutionState(0x80000001)
while (Get-Process -Id __PID__ -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }
`;

/**
 * Command holding the idle-sleep assertion until `bridgePid` disappears.
 * Returns null when the platform has no supported mechanism.
 */
export function sleepGuardCommand(
  platform: NodeJS.Platform,
  bridgePid: number,
): SleepGuardCommand | null {
  switch (platform) {
    case "darwin":
      // -i: PreventUserIdleSystemSleep (valid on battery too)
      // -w: release the assertion and exit as soon as the bridge is gone
      return { command: "caffeinate", args: ["-i", "-w", String(bridgePid)] };
    case "linux":
      // --what=idle keeps the host from idle-suspending; the watcher exits with
      // the bridge, which releases the inhibitor lock.
      return {
        command: "systemd-inhibit",
        args: [
          "--what=idle",
          "--mode=block",
          "--who=pi-webview",
          "--why=pi is working",
          "sh",
          "-c",
          `while kill -0 ${bridgePid} 2>/dev/null; do sleep 5; done`,
        ],
      };
    case "win32":
      return {
        command: "powershell",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          WINDOWS_SCRIPT.replace("__PID__", String(bridgePid)),
        ],
      };
    default:
      return null;
  }
}

export interface SleepGuardOptions {
  /** reads the user preference on every run: no restart needed */
  enabled: () => boolean;
  platform?: NodeJS.Platform;
  bridgePid?: number;
  spawnFn?: typeof spawn;
  log?: (message: string) => void;
}

/**
 * Holds the assertion while an agent run is active. Idempotent: repeated start
 * events never spawn a second helper, and a release without a hold is a no-op.
 */
export class SleepGuard {
  private child: ChildProcess | null = null;
  private readonly options: SleepGuardOptions;
  private readonly platform: NodeJS.Platform;
  private readonly bridgePid: number;
  private readonly spawnFn: typeof spawn;

  constructor(options: SleepGuardOptions) {
    this.options = options;
    this.platform = options.platform ?? process.platform;
    this.bridgePid = options.bridgePid ?? process.pid;
    this.spawnFn = options.spawnFn ?? spawn;
    process.once("exit", () => this.release());
  }

  /** true while the helper process is supposed to be running */
  get active(): boolean {
    return this.child !== null;
  }

  /** Follow the pi RPC stream: a run starts on agent_start, ends on settle. */
  track(event: Record<string, unknown>): void {
    switch (event.type) {
      case "agent_start":
        this.hold();
        break;
      case "agent_settled":
      case "agent_end":
        // agent_end can precede a compaction that keeps the outer run alive,
        // but holding until settle is the conservative side: release only on
        // settle, and let the exit handler clean up a run that never settles.
        if (event.type === "agent_settled") this.release();
        break;
      case "message_end":
        if (event.aborted === true) this.release();
        break;
      default:
        break;
    }
  }

  hold(): void {
    if (this.child) return;
    if (!this.options.enabled()) return;
    const command = sleepGuardCommand(this.platform, this.bridgePid);
    if (!command) return;
    try {
      const child = this.spawnFn(command.command, command.args, {
        stdio: "ignore",
        detached: false,
      });
      child.unref();
      child.on("error", (error: Error) => {
        this.options.log?.(`sleep guard unavailable: ${error.message}`);
        this.child = null;
      });
      child.on("exit", () => {
        if (this.child === child) this.child = null;
      });
      this.child = child;
      this.options.log?.(`sleep guard active (${command.command})`);
    } catch (error) {
      this.options.log?.(
        `sleep guard failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  release(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    try {
      child.kill();
    } catch {
      // already gone: the assertion died with the process
    }
  }
}
