// Assembla il package pi (installabile con `pi install ./packages/pi-webview`):
// 1) compila l'estensione pi-side → packages/pi-webview/dist/extension.js (ESM)
// 2) compila bridge + CLI standalone → packages/pi-webview/dist/{bridge,piw}.js
// 3) copia la UI buildata (dist/web) e il vsix companion nel package

import { build } from "esbuild";
import { cpSync, mkdirSync, existsSync } from "node:fs";

if (!existsSync("dist/pi-webview-ide.vsix")) {
  console.error("vsix companion mancante: esegui prima `pnpm package:ide`");
  process.exit(1);
}
if (!existsSync("dist/web/index.html")) {
  console.error("UI buildata mancante: esegui prima `pnpm package:ide` (vite build)");
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

// bridge standalone (serve la UI e parla con pi --mode rpc).
// Output CJS: `ws` è CJS e non si bundle-a in ESM puro (dynamic require).
await build({
  entryPoints: ["src/bridge/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "packages/pi-webview/dist/bridge.cjs",
  logLevel: "info",
});

// CLI `piw` (bin npm): shebang nel banner perché esbuild non lo preserva
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
