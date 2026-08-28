#!/usr/bin/env node
// Builds the Visual Studio companion vsix (src/adapters/visualstudio) on
// Linux (wine toolchain, see tools/setup-vs-wine.mjs) or Windows (native
// MSBuild). Output: dist/pi-webview-visualstudio.vsix (gitignored), ready to
// be copied into the pi package by build-addon.mjs.
//
// The vsix manifest version is derived from the root package.json at build
// time (-p:VsixVersion), like the VS Code companion vsix (build-ide-vsix.mjs
// reads root.version): the packaged companion always matches the package
// version.
//
// Prerequisites (Linux):
//   - wine + winetricks on PATH
//   - `node tools/setup-vs-wine.mjs` once (project-local prefix + VSSDK cache
//     patches; idempotent)
//   - `pnpm build` first (the vsix embeds dist/web)

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vsProj = join(
  root,
  "src",
  "adapters",
  "visualstudio",
  "src",
  "PiWebview.Vs",
  "PiWebview.Vs.csproj",
);
const outVsix = join(root, "dist", "pi-webview-visualstudio.vsix");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).version;

if (!existsSync(join(root, "dist", "web", "index.html"))) {
  console.error("dist/web missing: run `pnpm build` first (the vsix embeds the UI)");
  process.exit(1);
}

console.log(`→ dotnet build PiWebview.Vs (Debug, VsixVersion=${version})…`);
try {
  execSync(
    `dotnet build "${vsProj}" -c Debug -nologo -v minimal -p:VsixVersion=${version}`,
    {
      cwd: root,
      stdio: "inherit",
    },
  );
} catch {
  console.error(
    "dotnet build failed. On Linux run `node tools/setup-vs-wine.mjs` first (wine toolchain).",
  );
  process.exit(1);
}

// the vsix is produced in the project bin dir; copy it to dist/ (gitignored)
const built = join(
  root,
  "src",
  "adapters",
  "visualstudio",
  "src",
  "PiWebview.Vs",
  "bin",
  "Debug",
  "net472",
  "PiWebview.Vs.vsix",
);
if (!existsSync(built)) {
  console.error(`vsix not found at ${built}`);
  process.exit(1);
}
mkdirSync(join(root, "dist"), { recursive: true });
cpSync(built, outVsix);
console.log(`✓ VS companion vsix → ${outVsix}`);
