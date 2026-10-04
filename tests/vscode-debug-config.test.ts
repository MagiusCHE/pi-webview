import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launch = JSON.parse(readFileSync(".vscode-example/launch.json", "utf8"));
const config = launch.configurations.find(
  (item: { type: string }) => item.type === "extensionHost",
) as { args: string[]; outFiles: string[]; preLaunchTask: string };

test("F5 excludes the installed companion only from the development window", () => {
  assert.ok(config);
  assert.ok(config.args.includes("--extensionDevelopmentPath=${workspaceFolder}"));
  assert.ok(config.args.includes("--disable-extension=magiusche.pi-webview-ide"));
  assert.ok(config.args.includes("${workspaceFolder}"));
  assert.ok(!config.args.includes("--disable-extensions"));
  const packaging = readFileSync("tools/build-ide-vsix.mjs", "utf8");
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(`${root.publisher}.${root.name}`, "magiusche.pi-webview");
  assert.match(packaging, /name: "pi-webview-ide"/);
});

test("F5 debugger output patterns match the actual CommonJS adapter bundle", () => {
  assert.deepEqual(config.outFiles, ["${workspaceFolder}/dist/extension/**/*.cjs"]);
  const root = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(root.main, "dist/extension/extension.cjs");
  assert.equal(config.preLaunchTask, "build-extension");
});
