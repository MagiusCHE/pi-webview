// Build of the VS Code extension: web UI (vite) + adapter bundle (esbuild)
// into a single CommonJS file (main → dist/extension/extension.cjs).

import { build } from "esbuild";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

// 1) UI web → dist/web
execSync("vite build", { stdio: "inherit" });

// 2) adapter + bridge modules → dist/extension/extension.cjs
mkdirSync("dist/extension", { recursive: true });
await build({
  entryPoints: ["src/adapters/vscode/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/extension/extension.cjs",
  external: ["vscode"],
  logLevel: "info",
  sourcemap: false,
});

console.log("✓ extension compilata → dist/extension/extension.cjs");
