import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { sleepGuardCommand, SleepGuard } from "../src/bridge/sleep-guard.ts";

const bridge = readFileSync("src/bridge/index.ts", "utf8");
const html = readFileSync("src/web/index.html", "utf8");
const main = readFileSync("src/web/main.ts", "utf8");

test("macOS: caffeinate blocks idle sleep and follows the bridge pid", () => {
  const command = sleepGuardCommand("darwin", 4242);
  assert.deepEqual(command, { command: "caffeinate", args: ["-i", "-w", "4242"] });
});

test("Linux: systemd-inhibit holds an idle lock and exits with the bridge", () => {
  const command = sleepGuardCommand("linux", 4242);
  assert.equal(command?.command, "systemd-inhibit");
  assert.ok(command?.args.includes("--what=idle"));
  assert.ok(command?.args.includes("--mode=block"));
  // watcher loop: no orphan inhibitor if the bridge is SIGKILLed
  assert.match(command?.args.at(-1) ?? "", /kill -0 4242/);
});

test("Windows: PowerShell helper keeps SetThreadExecutionState armed", () => {
  const command = sleepGuardCommand("win32", 4242);
  assert.equal(command?.command, "powershell");
  const script = command?.args.at(-1) ?? "";
  assert.match(script, /SetThreadExecutionState/);
  // ES_CONTINUOUS | ES_SYSTEM_REQUIRED, then wait for the bridge to disappear
  assert.match(script, /0x80000001/);
  assert.match(script, /Get-Process -Id 4242/);
});

test("unsupported platforms stay a no-op", () => {
  assert.equal(sleepGuardCommand("freebsd", 1), null);
});

function harness(options: { enabled: boolean }) {
  const spawned: Array<{ command: string; args: string[]; child: EventEmitter }> = [];
  const spawnFn = ((command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      kill() {
        child.emit("exit", 0);
      },
      unref() {},
    });
    spawned.push({ command, args, child });
    return child;
  }) as never;
  const guard = new SleepGuard({
    enabled: () => options.enabled,
    platform: "darwin",
    bridgePid: 99,
    spawnFn,
  });
  return { guard, spawned };
}

test("the preference is off by default, so nothing is spawned", () => {
  const { guard, spawned } = harness({ enabled: false });
  guard.track({ type: "agent_start" });
  assert.equal(guard.active, false);
  assert.equal(spawned.length, 0);
});

test("a run holds one helper from agent_start and releases it on settle", () => {
  const { guard, spawned } = harness({ enabled: true });
  guard.track({ type: "agent_start" });
  // a second start event (turn boundary) must not stack helpers
  guard.track({ type: "agent_start" });
  assert.equal(spawned.length, 1);
  assert.equal(guard.active, true);
  guard.track({ type: "agent_settled" });
  assert.equal(guard.active, false);
});

test("an aborted run releases the helper without waiting for settle", () => {
  const { guard, spawned } = harness({ enabled: true });
  guard.track({ type: "agent_start" });
  guard.track({ type: "message_end", aborted: true });
  assert.equal(guard.active, false);
  assert.equal(spawned.length, 1);
});

test("the bridge arms the guard on the pi event stream and clears it on exit", () => {
  // armed only when the preference is on: a busy bridge alone holds nothing
  assert.match(
    bridge,
    /enabled: \(\) => configStore\.get\(\)\.keepAwakeWhileWorking === true/,
  );
  assert.match(bridge, /sleepGuard\.track\(event\);/);
  assert.match(bridge, /sleepGuard\.release\(\);/);
  assert.match(bridge, /onExit: \(_code, _signal, error, kind\) => \{/);
});

test("the setting lives in the shared Webview settings, unchecked by default", () => {
  assert.match(html, /id="keep-awake-while-working"/);
  assert.match(html, /class="field-checkbox"/);
  assert.match(main, /let keepAwakeWhileWorking = false;/);
  assert.match(main, /persistWebviewConfig\(\{ keepAwakeWhileWorking \}\);/);
});
