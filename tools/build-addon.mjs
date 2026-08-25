// Assembles the pi package (installable with `pi install ./packages/pi-webview`):
// 1) builds the pi-side extension → packages/pi-webview/dist/extension.js (ESM)
// 2) builds bridge + standalone CLI → packages/pi-webview/dist/{bridge,piw}.js
// 3) copies the built UI (dist/web) and the companion vsix into the package

import { build } from "esbuild";
import { cpSync, mkdirSync, existsSync } from "node:fs";

if (!existsSync("dist/pi-webview-ide.vsix")) {
  console.error("companion vsix missing: run `pnpm package:ide` first");
  process.exit(1);
}
if (!existsSync("dist/web/index.html")) {
  console.error("built UI missing: run `pnpm package:ide` first (vite build)");
  process.exit(1);
}

mkdirSync("packages/pi-webview/dist", { recursive: true });
mkdirSync("packages/pi-webview/companion", { recursive: true });

await build({
  entryPoints: ["packages/pi-webview/extension.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "packages/pi-webview/dist/extension.js",
  logLevel: "info",
});

// standalone bridge (serves the UI and talks to pi --mode rpc).
// CJS output: `ws` is CJS and does not bundle into pure ESM (dynamic require).
await build({
  entryPoints: ["src/bridge/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "packages/pi-webview/dist/bridge.cjs",
  logLevel: "info",
});

// `piw` CLI (npm bin): shebang in the banner because esbuild does not preserve it
await build({
  entryPoints: ["src/bridge/piw.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "packages/pi-webview/dist/piw.js",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});

cpSync("dist/web", "packages/pi-webview/dist/web", { recursive: true });
cpSync("dist/pi-webview-ide.vsix", "packages/pi-webview/companion/pi-webview-ide.vsix");

console.log("✓ package pi assemblato → packages/pi-webview/");
