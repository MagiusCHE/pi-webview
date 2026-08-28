// Shared `pi --mode rpc` process management between the standalone bridge and
// the IDE adapter: spawn, JSONL parsing, stdin backpressure, restart with
// backoff. (concept 0002 D3/D5)

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { createJsonlParser, writeJsonl } from "./jsonl.ts";
import { resolveDirectNode } from "./spawn.ts";

export interface PiProcessOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  args?: string[];
}

export interface PiProcessCallbacks {
  onEvent: (event: Record<string, unknown>) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null, error?: string) => void;
  onStderr?: (line: string) => void;
  /** OSC 777 notify (turn complete etc.): the TUI shows it as a desktop
   *  notification — surface it in the UI, never as chat text */
  onNotify?: (n: { title: string; body: string }) => void;
  log?: (msg: string) => void;
}

export class PiProcess {
  private child: ChildProcessByStdio<Writable, Readable, Readable> | null = null;
  private stopping = false;
  private restarts = 0;
  private sending = false;
  private queue: unknown[] = [];
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private spawnError = false; // spawn failed: the following 'exit' event must be ignored
  private bootWatchdog: ReturnType<typeof setTimeout> | null = null;
  private booted = false; // first line from pi → boot ok, watchdog disarmed
  private command: string;
  private cb: PiProcessCallbacks;
  private opts: PiProcessOptions;

  // no parameter properties in the constructor: unsupported by the
  // strip-only TS of Node (src/bridge/ is run directly by Node)
  constructor(command: string, cb: PiProcessCallbacks, opts: PiProcessOptions = {}) {
    this.command = command;
    this.cb = cb;
    this.opts = opts;
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** current pi child pid (undefined while not running) — used to address
   *  the per-process startup-info file of the pi-webview extension */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    this.spawnError = false;
    const args = ["--mode", "rpc", ...(this.opts.args ?? [])];
    const childOpts = {
      stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
      ...(this.opts.env ? { env: this.opts.env } : {}),
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
    };
    // Windows: spawning the .cmd shim through `cmd /c` with piped stdio
    // kills pi's RPC stdin (boot ok, no requests ever read, verified 0.84.3)
    // → spawn node + cli.js directly (pi's own RpcClient pattern).
    const direct = resolveDirectNode(this.command);
    const child = direct
      ? spawn(direct.node, [direct.script, ...args], childOpts)
      : process.platform === "win32"
        ? spawn("cmd", ["/c", this.command, ...args], childOpts)
        : spawn(this.command, args, childOpts);
    this.cb.log?.(
      `spawn: ${direct ? `${direct.node} ${direct.script}` : this.command} ${args.join(" ")}`,
    );
    this.child = child;
    this.booted = false;
    // Boot watchdog: pi frozen (no output for 45s, e.g. stalled on missing
    // networks at startup) → kill the tree; the restart follows the normal
    // 'exit' flow (backoff 1s, cap 5) and each attempt gets a new watchdog.
    this.bootWatchdog = setTimeout(() => {
      if (this.stopping || this.booted || !this.child) return;
      this.cb.log?.(
        `pi unresponsive: no output in the first 45s of boot — kill + restart`,
      );
      const pid = this.child.pid;
      if (pid !== undefined) {
        if (process.platform === "win32") {
          // kill the whole tree (cmd → node → pi)
          const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
            stdio: "ignore",
          });
          killer.on("error", () => {});
        } else {
          this.child.kill();
        }
      }
    }, 45_000);

    child.stdin.on("error", (err) => {
      if (!this.stopping) this.cb.log?.(`stdin pi: ${err.message}`);
    });

    const parser = createJsonlParser((line) => {
      let payload: unknown;
      if (!this.booted) {
        // any line = pi alive: boot ok, watchdog disarmed
        this.booted = true;
        if (this.bootWatchdog) {
          clearTimeout(this.bootWatchdog);
          this.bootWatchdog = null;
        }
      }
      try {
        payload = JSON.parse(line);
      } catch {
        this.cb.log?.(`riga non JSON da pi, ignorata: ${line.slice(0, 120)}`);
        return;
      }
      this.cb.onEvent(payload as Record<string, unknown>);
    });
    child.stdout.on("data", (chunk: Buffer) => parser.push(chunk));
    child.stdout.on("end", () => parser.flush());

    // stderr: OSC-aware handling. pi writes terminal notifications (OSC 777
    // notify/title, e.g. "\x1b]777;notify;π;<answer>\x07") meant for the TUI.
    // CRITICAL: the OSC has NO trailing \n — a newline-split buffer would keep
    // it stuck until another line or the stream close (i.e. only at process
    // death). Extract complete OSC sequences at the BUFFER level (they may
    // also span chunks), then emit the remaining text split by newlines.
    let stderrBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf-8");
      // complete OSC sequences anywhere in the buffer (no newline needed)
      for (;;) {
        const oscStart = stderrBuffer.indexOf("\u001b]");
        if (oscStart < 0) break;
        const after = stderrBuffer.slice(oscStart + 2);
        const termIdx = after.search(/\u0007|\u001b\\/);
        if (termIdx === -1) break; // incomplete OSC: wait for more data
        const content = after.slice(0, termIdx);
        // OSC 777 notify: internal TUI message — surface it via onNotify,
        // never as chat text
        const notifyPrefix = "777;notify;";
        if (content.startsWith(notifyPrefix)) {
          const rest = content.slice(notifyPrefix.length);
          const semi = rest.indexOf(";");
          const title = semi === -1 ? "" : rest.slice(0, semi);
          const body = semi === -1 ? rest : rest.slice(semi + 1);
          if (title || body.trim()) this.cb.onNotify?.({ title, body });
        }
        // drop the OSC, keep the surrounding text
        stderrBuffer = stderrBuffer.slice(0, oscStart) + after.slice(termIdx + 1);
      }
      // remaining buffer: newline-terminated lines
      let idx: number;
      while ((idx = stderrBuffer.indexOf("\n")) !== -1) {
        const line = stderrBuffer.slice(0, idx);
        stderrBuffer = stderrBuffer.slice(idx + 1);
        if (line.trim()) this.cb.onStderr?.(line);
      }
    });
    child.stderr.on("end", () => {
      if (stderrBuffer.trim()) this.cb.onStderr?.(stderrBuffer);
    });

    // spawn failed (e.g. ENOENT/EACCES: binary not executable): do NOT retry,
    // it will not heal itself → onExit right away with the error message
    child.on("error", (err) => {
      if (this.stopping) return;
      this.spawnError = true;
      if (this.stabilityTimer) {
        clearTimeout(this.stabilityTimer);
        this.stabilityTimer = null;
      }
      if (this.bootWatchdog) {
        clearTimeout(this.bootWatchdog);
        this.bootWatchdog = null;
      }
      this.child = null;
      this.cb.log?.(`spawn pi fallito: ${err.message}`);
      this.cb.onExit?.(null, null, err.message);
    });

    // after 30s of life the process is considered stable: reset the counter
    this.stabilityTimer = setTimeout(() => {
      this.restarts = 0;
    }, 30_000);

    child.on("exit", (code, signal) => {
      if (this.spawnError) return; // already handled by the 'error' handler
      if (this.stabilityTimer) {
        clearTimeout(this.stabilityTimer);
        this.stabilityTimer = null;
      }
      if (this.bootWatchdog) {
        clearTimeout(this.bootWatchdog);
        this.bootWatchdog = null;
      }
      this.child = null;
      if (this.stopping) return;
      this.restarts++;
      if (this.restarts > 5) {
        this.cb.log?.("pi continua a crashare — mi fermo");
        this.cb.onExit?.(code, signal);
        return;
      }
      this.cb.log?.(`pi terminato (code=${code}, signal=${signal}); restart tra 1s`);
      setTimeout(() => this.start(), 1_000);
    });
  }

  send(obj: unknown): void {
    this.queue.push(obj);
    this.pump();
  }

  private pump(): void {
    if (this.sending || !this.child || !this.child.stdin.writable) return;
    const item = this.queue.shift();
    if (item === undefined) return;
    this.sending = true;
    const ok = writeJsonl(this.child.stdin, item);
    if (ok) {
      this.sending = false;
      this.pump();
    } else {
      this.child.stdin.once("drain", () => {
        this.sending = false;
        this.pump();
      });
    }
  }

  dispose(): void {
    this.stopping = true;
    if (this.bootWatchdog) {
      clearTimeout(this.bootWatchdog);
      this.bootWatchdog = null;
    }
    if (this.child) {
      const pid = this.child.pid;
      if (process.platform === "win32" && pid !== undefined) {
        const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
        });
        killer.on("error", () => {});
      } else {
        this.child.kill();
      }
    }
    this.child = null;
  }
}
