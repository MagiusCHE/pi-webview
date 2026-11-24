import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("extension checks launcher PATH without waiting for companion maintenance", async (context) => {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp", "extension-startup-"));
  const bundle = join(root, "extension.mjs");
  for (const name of ["piw", "piw-public"])
    writeFileSync(join(root, `${name}.js`), "", { mode: 0o755 });
  const binDir = process.env.PIW_BIN_DIR;
  process.env.PIW_BIN_DIR = join(root, "bin");
  const home = context.mock.method(os, "homedir", () => root);
  const execute = context.mock.method(
    childProcess,
    "execFile",
    () => ({}) as ChildProcess,
  );
  syncBuiltinESMExports();
  context.after(() => {
    home.mock.restore();
    execute.mock.restore();
    syncBuiltinESMExports();
    if (binDir === undefined) delete process.env.PIW_BIN_DIR;
    else process.env.PIW_BIN_DIR = binDir;
    rmSync(root, { recursive: true, force: true });
  });
  await build({
    stdin: {
      contents: `
        import extension from "./packages/pi-webview/extension.ts";
        export { finish } from "./src/bridge/companions.ts";
        export default extension;
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundle,
    plugins: [
      {
        name: "pending-companion",
        setup(build) {
          build.onLoad({ filter: /[\\/]bridge[\\/]companions\.ts$/ }, () => ({
            contents: `
            export let finish;
            export const ensureCompanions = (_root, options) => options.ignoreAutoInstall
              ? Promise.resolve([])
              : new Promise(resolve => { finish = resolve; });
            export const formatCompanionNotes = () => ["Companion maintenance finished"];
            export const companionReloadHints = () => [];
            export const COMPANION_ID = "fixture", VSIX_ID = "fixture";
            const unused = () => {};
            export { unused as runCli, unused as resolveCodeCli,
              unused as installedCompanionVersion, unused as installCompanion,
              unused as uninstallVsCodeCompanionDirect, unused as visualStudioInstances,
              unused as isVsVersionSupported, unused as openChromeExtensionsManager };
          `,
          }));
        },
      },
    ],
  });
  const extension = await import(pathToFileURL(bundle).href);
  const hooks: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
  type NotifyContext = { ui: { notify: (message: string, kind: string) => void } };
  let runPiw: ((args: string, ctx: NotifyContext) => Promise<void>) | undefined;
  const api = {
    on: (event: string, handler: (...args: unknown[]) => unknown) =>
      hooks.push({ event, handler }),
    getCommands: () => [],
    getAllTools: () => [{ name: "browser_page_dom" }],
    registerCommand: (name: string, command: { handler: typeof runPiw }) => {
      assert.equal(name, "piw");
      runPiw = command.handler;
    },
  };
  const loaded = extension.default(api);
  const state = await Promise.race([
    loaded.then(() => "ready"),
    new Promise((resolve) => setImmediate(() => resolve("blocked"))),
  ]);
  assert.equal(state, "ready", "the extension factory must finish before maintenance");
  const sessionStart = hooks.find((hook) => hook.event === "session_start");
  assert.ok(sessionStart);
  const infos: string[] = [];
  const warnings: string[] = [];
  const ctx = {
    ui: {
      notify: (message: string, kind: string) =>
        (kind === "warning" ? warnings : infos).push(message),
    },
  };
  sessionStart.handler({}, ctx);
  sessionStart.handler({}, ctx);
  const checksUnixPath = process.platform === "linux" || process.platform === "darwin";
  if (checksUnixPath) {
    assert.equal(warnings.length, 1, "warn once even if Pi starts another session");
    assert.match(warnings[0] ?? "", /PATH/);
    assert.match(warnings[0] ?? "", /command -v piw; command -v piw-public/);
  } else {
    assert.deepEqual(warnings, []);
  }
  extension.finish([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(infos, ["Companion maintenance finished"]);

  hooks
    .filter((hook) => hook.event === "session_start")
    .at(-1)
    ?.handler({}, ctx);
  assert.ok(runPiw);
  for (const subcommand of ["status", "install", "reinstall"]) {
    warnings.length = 0;
    infos.length = 0;
    await runPiw(subcommand, ctx);
    assert.equal(warnings.length + infos.length, 1, "single recap notification");
    assert.equal(warnings.length, checksUnixPath ? 1 : 0);
  }
});
