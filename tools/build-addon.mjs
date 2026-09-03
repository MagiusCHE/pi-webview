// Assembles the pi package (installable with `pi install ./packages/pi-webview`):
// 1) builds the pi-side extension → packages/pi-webview/dist/extension.js (ESM)
// 2) builds bridge + standalone CLI → packages/pi-webview/dist/bridge.cjs + piw.js
// 3) copies the built UI (dist/web) and the companion vsixes (VS Code + Visual
//    Studio) into the package

import { build } from "esbuild";
import { chmodSync, cpSync, mkdirSync, existsSync, rmSync } from "node:fs";

if (!existsSync("dist/pi-webview-ide.vsix")) {
  console.error("VS Code companion vsix missing: run `pnpm package:vscode` first");
  process.exit(1);
}
if (!existsSync("dist/web/index.html")) {
  console.error("built UI missing: run `pnpm package:vscode` first (vite build)");
  process.exit(1);
}
// the Visual Studio companion vsix is optional at assembly time (it needs the
// wine toolchain on Linux, see tools/build-vs-vsix.mjs): the package works
// for VS Code-only installs without it, and the VS auto-install is skipped
// when the vsix is absent.
const vsVsix = "dist/pi-webview-visualstudio.vsix";
if (existsSync(vsVsix)) {
  console.log("VS companion vsix present → included in the package");
} else {
  console.warn(
    "VS companion vsix missing: run `pnpm package:visualstudio` to include Visual Studio support",
  );
}

// Rebuild the distributable directory from scratch so removed or renamed
// bundles can never leak into npm tarballs from an earlier local build.
rmSync("packages/pi-webview/dist", { recursive: true, force: true });
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
// The local development install points directly at this file. A clean rebuild
// creates it as 0644, while npm normally applies executable mode to package bins.
chmodSync("packages/pi-webview/dist/piw.js", 0o755);

rmSync("packages/pi-webview/dist/web", { recursive: true, force: true });
cpSync("dist/web", "packages/pi-webview/dist/web", { recursive: true });
cpSync("media/icon.png", "packages/pi-webview/dist/web/icon.png");
cpSync("dist/pi-webview-ide.vsix", "packages/pi-webview/companion/pi-webview-ide.vsix");
const bundledVsVsix = "packages/pi-webview/companion/pi-webview-visualstudio.vsix";
if (existsSync(vsVsix)) {
  cpSync(vsVsix, bundledVsVsix);
} else {
  rmSync(bundledVsVsix, { force: true });
}

console.log("✓ package pi assemblato → packages/pi-webview/");
