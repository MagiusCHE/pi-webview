import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("Windows extension registers session hooks while companion maintenance is pending", async (context) => {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp", "extension-startup-"));
  const bundle = join(root, "extension.mjs");
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
            export const ensureCompanions = () => new Promise(resolve => { finish = resolve; });
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
  const api = {
    on: (event: string, handler: (...args: unknown[]) => unknown) =>
      hooks.push({ event, handler }),
  };
  const loaded = extension.default(api);
  const state = await Promise.race([
    loaded.then(() => "ready"),
    new Promise((resolve) => setImmediate(() => resolve("blocked"))),
  ]);
  assert.equal(state, "ready", "the extension factory must finish before maintenance");
  const sessionStart = hooks.find((hook) => hook.event === "session_start");
  assert.ok(sessionStart);
  const notifications: string[] = [];
  sessionStart.handler(
    {},
    { ui: { notify: (message: string) => notifications.push(message) } },
  );
  extension.finish([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(notifications, ["Companion maintenance finished"]);
});
