// Update checks are live (no cache). Mock subprocesses, not registry data
// inside the checker, so Windows command failures exercise the complete flow.
// No real pi binary, npm process or network connection is used.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess, {
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";
import {
  PI_PACKAGE,
  checkPiUpdate,
  compareVersions,
  locatePi,
  parseLatestVersion,
  parseNpmSources,
} from "../packages/pi-webview/lib/update-check.ts";

test("PI_PACKAGE is the pi core npm package", () => {
  assert.equal(PI_PACKAGE, "@earendil-works/pi-coding-agent");
});

test("compareVersions: numeric parts, not string order", () => {
  assert.ok(compareVersions("0.9.0", "0.10.0") < 0); // 10 > 9
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.ok(compareVersions("1.2", "1.2.0") === 0); // missing part = 0
  assert.ok(compareVersions("1.2.4", "1.2.3") > 0);
});

test("compareVersions: leading v/= and whitespace are stripped", () => {
  assert.equal(compareVersions("v1.2.3", "=1.2.3"), 0);
  assert.equal(compareVersions(" 1.2.3", "1.2.3"), 0);
});

test("parseLatestVersion: npm view --json output (string or array)", () => {
  assert.equal(parseLatestVersion('"0.85.1"'), "0.85.1");
  assert.equal(parseLatestVersion('  "1.0.0-beta.1" \n'), "1.0.0-beta.1");
  // npm 12 returns an array for a single field
  assert.equal(parseLatestVersion('["0.85.0"]'), "0.85.0");
  assert.equal(parseLatestVersion('["0.9.0","1.0.0"]'), "1.0.0");
});

test("parseLatestVersion: garbage is null, never throws", () => {
  assert.equal(parseLatestVersion(""), null);
  assert.equal(parseLatestVersion("not json"), null);
  assert.equal(parseLatestVersion("42"), null); // JSON number, not a version string
  assert.equal(parseLatestVersion("null"), null);
  assert.equal(parseLatestVersion('["x"]'), null);
});

test("parseNpmSources: only npm: sources, deduplicated, tolerant", () => {
  assert.deepEqual(
    parseNpmSources({
      packages: [
        "npm:pi-spark",
        "../../Sources/Personal/pi-webview/packages/pi-webview", // local → skipped
        "git:github.com/user/repo", // git → skipped
        "npm:@scoped/pkg",
        "npm:pi-spark", // duplicate
        "npm:", // empty name
        42, // not a string
        null,
      ],
    }),
    ["pi-spark", "@scoped/pkg"],
  );
  assert.deepEqual(parseNpmSources(null), []);
  assert.deepEqual(parseNpmSources({}), []);
  assert.deepEqual(parseNpmSources({ packages: "nope" }), []);
});

interface CheckCommand {
  command: string;
  args: string[];
  options: SpawnSyncOptionsWithStringEncoding;
}

function commandResult(
  stdout: string,
  status: number | null = 0,
): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [null, stdout, null],
    stdout,
    stderr: "",
    status,
    signal: null,
  };
}

function mockCommands(
  context: TestContext,
  platform: NodeJS.Platform,
  respond: (command: CheckCommand) => SpawnSyncReturns<string>,
): CheckCommand[] {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  const originalComSpec = process.env.ComSpec;
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
  process.env.ComSpec = "C:\\Windows\\System32\\cmd.exe";
  const calls: CheckCommand[] = [];
  const spawn = context.mock.method(childProcess, "spawnSync", (...input: unknown[]) => {
    const [command, args, options] = input as [
      string,
      string[],
      SpawnSyncOptionsWithStringEncoding,
    ];
    const call = { command, args, options };
    calls.push(call);
    return respond(call);
  });
  syncBuiltinESMExports();
  context.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
    Object.defineProperty(process, "platform", originalPlatform);
    if (originalComSpec === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = originalComSpec;
  });
  return calls;
}

function updateFixture(context: TestContext) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp", "update-check-"));
  const temp = context.mock.method(os, "tmpdir", () => join(root, "temp"));
  syncBuiltinESMExports();
  context.after(() => {
    temp.mock.restore();
    syncBuiltinESMExports();
  });
  const home = join(root, "home with spaces");
  const projectDir = join(root, "project with spaces");
  const userRoot = join(home, ".pi", "agent");
  const projectRoot = join(projectDir, ".pi");
  for (const dir of [userRoot, projectRoot]) mkdirSync(dir, { recursive: true });
  const writeSettings = (dir: string, packages: string[]) =>
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages }));
  const install = (dir: string, name: string, version: string) => {
    const packageDir = join(dir, "npm", "node_modules", name);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name, version }));
  };
  writeSettings(userRoot, ["npm:@example/extension", "./local-extension"]);
  writeSettings(projectRoot, ["npm:project-extension", "npm:@example/extension"]);
  install(userRoot, "@example/extension", "2.0.0");
  install(projectRoot, "project-extension", "3.0.0");
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, projectDir, userRoot, projectRoot, writeSettings, install };
}

test("Windows checks pi and npm .cmd shims through the command processor", async (context) => {
  const fixture = updateFixture(context);
  const calls = mockCommands(context, "win32", ({ command, args }) => {
    // Direct pi/npm spawn cannot run Windows .cmd shims. Model that failure
    // instead of returning successful registry data for an invalid invocation.
    if (command !== process.env.ComSpec) return commandResult("", null);
    assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
    switch (args.slice(3).join(" ")) {
      case "pi --version":
        return commandResult("pi 1.0.0\r\n");
      case `npm view ${PI_PACKAGE} version --json`:
        return commandResult('["1.1.0"]\r\n');
      case "npm view @example/extension version --json":
        return commandResult('"2.1.0"\r\n');
      case "npm view project-extension version --json":
        return commandResult('"3.0.0"\r\n');
      default:
        assert.fail("Unexpected version-check command");
    }
  });
  assert.deepEqual(await checkPiUpdate(fixture), {
    core: { current: "1.0.0", latest: "1.1.0" },
    extensions: [{ name: "@example/extension", current: "2.0.0", latest: "2.1.0" }],
  });
  assert.equal(calls.length, 4);
  for (const { options } of calls) {
    assert.equal(options.windowsHide, true);
    assert.equal(options.windowsVerbatimArguments, true);
    assert.notEqual(options.shell, true);
    assert.ok(options.timeout);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
  }
  for (const { options } of calls.slice(1)) {
    assert.ok(options.cwd);
    assert.notEqual(options.cwd, fixture.projectDir);
  }
});

test("Windows extension updates are detected even when pi is missing from PATH", async (context) => {
  const fixture = updateFixture(context);
  const calls = mockCommands(context, "win32", ({ command, args }) => {
    if (command !== "cmd.exe") return commandResult("", null);
    if (args.slice(3).join(" ") === "pi --version") return commandResult("", 1);
    if (args.slice(3).join(" ") === "npm view @example/extension version --json")
      return commandResult('"2.1.0"');
    return commandResult('"3.0.0"');
  });
  delete process.env.ComSpec;
  assert.deepEqual(await checkPiUpdate(fixture), {
    core: null,
    extensions: [{ name: "@example/extension", current: "2.0.0", latest: "2.1.0" }],
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.command === "cmd.exe"));
});

test("Windows global npm fallback also uses the command processor", async (context) => {
  const fixture = updateFixture(context);
  const cli = join(fixture.root, "node_modules", PI_PACKAGE, "dist", "bundle", "cli.js");
  mkdirSync(join(cli, ".."), { recursive: true });
  writeFileSync(cli, "");
  const originalPath = process.env.PATH;
  process.env.PATH = "";
  context.after(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });
  mockCommands(context, "win32", ({ command, args, options }) => {
    if (command !== process.env.ComSpec) return commandResult("", null);
    assert.deepEqual(args, ["/d", "/s", "/c", "npm", "root", "-g"]);
    assert.equal(options.windowsHide, true);
    return commandResult(`${join(fixture.root, "node_modules")}\r\n`);
  });
  assert.equal(await locatePi(), cli);
});

test("non-Windows checks retain direct execution, live lookups and registry settings", async (context) => {
  const fixture = updateFixture(context);
  let latest = "1.0.0";
  const calls = mockCommands(context, "linux", ({ command, args, options }) => {
    assert.notEqual(options.shell, true);
    assert.notEqual(options.windowsVerbatimArguments, true);
    if (command === "pi") {
      assert.deepEqual(args, ["--version"]);
      return commandResult("1.0.0");
    }
    assert.equal(command, "npm");
    assert.equal(options.env, process.env);
    assert.deepEqual(args, ["view", args[1], "version", "--json"]);
    return commandResult(JSON.stringify(args[1] === PI_PACKAGE ? latest : "1.0.0"));
  });
  assert.equal(await checkPiUpdate(fixture), null);
  latest = "1.1.0";
  assert.deepEqual(await checkPiUpdate(fixture), {
    core: { current: "1.0.0", latest },
    extensions: [],
  });
  assert.equal(calls.filter((call) => call.command === "pi").length, 2);
  assert.equal(calls.filter((call) => call.command === "npm").length, 6);
});

test("failed registry commands cannot produce update notices from partial stdout", async (context) => {
  const fixture = updateFixture(context);
  mockCommands(context, "linux", ({ command }) =>
    command === "pi" ? commandResult("1.0.0") : commandResult('"99.0.0"', 1),
  );
  assert.equal(await checkPiUpdate(fixture), null);
});

test("missing command processors and timed-out lookups remain non-fatal", async (context) => {
  const fixture = updateFixture(context);
  let failing = true;
  mockCommands(context, "win32", () => {
    if (failing) throw new Error("ENOENT");
    return { ...commandResult('"99.0.0"', null), error: new Error("ETIMEDOUT") };
  });
  assert.equal(await checkPiUpdate(fixture), null);
  failing = false;
  assert.equal(await checkPiUpdate(fixture), null);
});

test("Windows registry lookups reject shell metacharacters from package sources", async (context) => {
  const fixture = updateFixture(context);
  const names = ["bad&command", "bad%PATH%", "bad^command", "bad command", "--help"];
  fixture.writeSettings(
    fixture.userRoot,
    names.map((name) => `npm:${name}`),
  );
  for (const name of names) fixture.install(fixture.userRoot, name, "1.0.0");
  fixture.writeSettings(fixture.projectRoot, []);
  const calls = mockCommands(context, "win32", () => commandResult("", null));
  assert.equal(await checkPiUpdate(fixture), null);
  assert.equal(calls.length, 1, "unsafe package names must never reach cmd.exe");
});

test("checkPiUpdate: the module no longer exposes any cache surface", async () => {
  // the 1h cache (update-check.json) was REMOVED: a fresh release must be
  // seen at the next session start, not an hour later — the check is live
  const mod = (await import("../packages/pi-webview/lib/update-check.ts")) as Record<
    string,
    unknown
  >;
  assert.equal(mod.CACHE_TTL_MS, undefined);
  assert.equal(mod.readCache, undefined);
  assert.equal(mod.updateCheckFile, undefined);
});
