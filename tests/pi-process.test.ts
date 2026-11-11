import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, join } from "node:path";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import { PiProcess } from "../src/bridge/pi-process.ts";

function harness(context: TestContext, args: string[] = []) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp", "pi-startup-"));
  const shim = join(root, "pi.cmd");
  const script = join(root, "fixture.js");
  writeFileSync(shim, 'node "%~dp0fixture.js" %*');
  writeFileSync(script, "");
  const children: Array<ReturnType<typeof createChild>> = [];
  const invocations: Array<{ command: string; args: string[] }> = [];
  function createChild() {
    return Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: context.mock.fn(),
    });
  }
  const spawn = context.mock.method(childProcess, "spawn", (...input: unknown[]) => {
    invocations.push({ command: input[0] as string, args: input[1] as string[] });
    const child = createChild();
    children.push(child);
    return child as unknown as ChildProcess;
  });
  syncBuiltinESMExports();
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const events: Record<string, unknown>[] = [];
  const exits: unknown[][] = [];
  const pi = new PiProcess(
    shim,
    {
      onEvent: (event) => events.push(event),
      onExit: (...exit) => exits.push(exit),
    },
    { args },
  );
  context.after(() => {
    pi.dispose();
    spawn.mock.restore();
    syncBuiltinESMExports();
    context.mock.timers.reset();
    Object.defineProperty(process, "platform", platform);
    rmSync(root, { recursive: true, force: true });
  });
  return { pi, children, invocations, script, events, exits };
}

// The launcher resolves a Windows `pi.cmd` shim to Node plus the real CLI entry.
// That branch reads the platform at module load, so the test is meaningful only
// on Windows: elsewhere the POSIX spawn path is exercised by the other tests.
const windowsOnly =
  process.platform === "win32" ? false : "Windows-only launcher resolution";

for (const mode of ["new", "reload"] as const) {
  test(
    `Windows ${mode} session stays alive through slow startup and accepts RPC`,
    { skip: windowsOnly },
    (context) => {
      const args = mode === "reload" ? ["--session", "saved-session.jsonl"] : [];
      const h = harness(context, args);
      h.pi.start();
      const child = h.children[0]!;
      h.pi.send({ id: mode, type: "get_state" });
      assert.deepEqual(h.invocations[0], {
        command: process.execPath,
        args: [h.script, "--mode", "rpc", ...args],
      });
      context.mock.timers.tick(120_000);
      assert.equal(h.pi.running, true);
      assert.equal(child.kill.mock.callCount(), 0);
      assert.equal(h.invocations.length, 1);
      assert.match(child.stdin.read().toString(), /get_state/);
      child.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ type: "response", id: mode, success: true }) + "\n"),
      );
      assert.equal(h.events.length, 1);
      assert.equal(h.events[0]?.id, mode);
      h.pi.send({ type: "get_messages" });
      assert.match(child.stdin.read().toString(), /get_messages/);
    },
  );
}

test("disposing during reload cancels a pending crash restart", (context) => {
  const h = harness(context);
  h.pi.start();
  h.children[0]!.emit("exit", 1, null);
  h.pi.dispose();
  context.mock.timers.tick(120_000);
  assert.equal(h.invocations.length, 1);
  assert.equal(h.pi.running, false);
});

test("slow failed boots still exhaust the crash retry budget", (context) => {
  const h = harness(context);
  h.pi.start();
  for (let attempt = 0; attempt < 6; attempt++) {
    context.mock.timers.tick(60_000);
    h.children[attempt]!.emit("exit", 1, null);
    context.mock.timers.tick(1_000);
  }
  assert.equal(h.invocations.length, 6);
  assert.equal(h.exits.length, 1);
  assert.equal(h.pi.running, false);
});
