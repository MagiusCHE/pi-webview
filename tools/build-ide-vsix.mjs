// Build of the VS Code companion (vsix) for the pi-webview package:
// 1) builds UI (vite) + adapter (esbuild) → dist/extension/extension.cjs
// 2) assembles the extension folder in dist/companion/ (manifest, media, README)
// 3) `vsce package` → dist/pi-webview-ide.vsix

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";

// 1) UI web → dist/web + adapter → dist/extension/extension.cjs
execSync("vite build", { stdio: "inherit" });
mkdirSync("dist/extension", { recursive: true });
await build({
  entryPoints: ["src/adapters/vscode/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/extension/extension.cjs",
  external: ["vscode"],
  logLevel: "info",
});

// 2) assemble dist/companion/ (cleaned at every build: no stale files)
const root = JSON.parse(readFileSync("package.json", "utf-8"));
const manifest = {
  name: "pi-webview-ide",
  displayName: "pi-webview (IDE companion)",
  version: root.version,
  description:
    "WebView UI for the pi coding agent — companion auto-installed by the pi-webview addon",
  publisher: root.publisher,
  icon: "media/icon.png",
  license: "MIT",
  repository: root.repository,
  engines: { vscode: root.engines.vscode },
  main: "dist/extension/extension.cjs",
  // onStartupFinished: the panel restore must run at
  // EVERY startup, even if the pi view is not visible (closed side panel)
  activationEvents: ["onStartupFinished", "onView:piWebview"],
  contributes: root.contributes,
};
rmSync("dist/companion", { recursive: true, force: true });
mkdirSync("dist/companion", { recursive: true });
writeFileSync("dist/companion/package.json", JSON.stringify(manifest, null, 2) + "\n");
cpSync("dist/extension", "dist/companion/dist/extension", { recursive: true });
cpSync("dist/web", "dist/companion/dist/web", { recursive: true });
cpSync("media", "dist/companion/media", { recursive: true });
// notification icon for the webview (served from dist/web)
cpSync("media/icon.png", "dist/web/icon.png");
cpSync("README.md", "dist/companion/README.md");
cpSync("LICENSE", "dist/companion/LICENSE");

// 3) vsce package
// 3) vsce package (run from the extension folder, absolute out)
const out = new URL("../dist/pi-webview-ide.vsix", import.meta.url).pathname;
execSync(`pnpm exec vsce package --out "${out}"`, {
  cwd: "dist/companion",
  stdio: "inherit",
});
console.log("✓ companion → dist/pi-webview-ide.vsix");
