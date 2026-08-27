#!/usr/bin/env node
// Visual Studio adapter build on Linux — wine + VSSDK toolchain setup.
//
// The VSIX build (src/adapters/visualstudio) needs Windows-only pieces:
// VSCTCompress.dll (native PE32) and CreatePkgDef.exe (a .NET Framework
// console app the VSSDK MSBuild task mishandles under the dotnet CLI).
// Wine runs them; Mono cannot load the native VSCTCompress.dll.
//
// This script makes the build reproducible:
//   1. creates a PROJECT-LOCAL wine prefix (src/adapters/visualstudio/.wine/
//      — never touches ~/.wine) with .NET Framework 4.8 (winetricks dotnet48);
//   2. patches the VSSDK.BuildTools nuget cache package in place so the MSBuild
//      targets resolve on a case-sensitive Linux filesystem and the Windows
//      tools run through wine wrapper shims:
//        - symlinks Microsoft.VsSDK.targets → Microsoft.VSSDK.targets
//          (and Suppressions) — the targets file is looked up with a
//          different case than the one shipped on disk;
//        - a build\..\tools\VSSDK\bin\ backslash dir (MSBuild's Path.Combine
//          in the VSCT task produces "build\..\tools\VSSDK\bin" from the
//          nuget package layout — on Linux that must exist literally) with
//          bash wrapper shims that expand .rsp files, relativize absolute
//          paths and exec `wine <real tool>`;
//        - Newtonsoft.Json.dll replaced with the netstandard2.0 build
//          (13.0.3) so the VSSDK tasks do not require System.Security.Permissions.
//
// Idempotent: safe to re-run. Needs wine + winetricks on PATH.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prefixDir = join(root, "src", "adapters", "visualstudio", ".wine");
const prefix = join(prefixDir, "prefix");
const VSSDK_VERSION = "18.4.33";
const home = process.env.HOME ?? process.env.USERPROFILE;
const nugetCache = process.env.NUGET_PACKAGES ?? join(home, ".nuget", "packages");
const vssdkDir = join(nugetCache, "microsoft.vssdk.buildtools", VSSDK_VERSION);

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function step(name) {
  console.log(`\n=== ${name} ===`);
}

// --- 1. wine prefix with .NET Framework 4.8 --------------------------------
function setupPrefix() {
  step("wine prefix (.NET Framework 4.8, project-local)");
  if (!existsSync(prefix)) {
    mkdirSync(prefixDir, { recursive: true });
    sh("winetricks", ["-q", "-f", `--prefix=${prefix}`, "dotnet48"], { env: { ...process.env, WINEPREFIX: prefix } });
  } else {
    console.log("prefix already present, skipping (delete it to rebuild)");
  }
}

// --- 2. VSSDK nuget package patches -----------------------------------------
function symlinkIfMissing(target, link) {
  if (existsSync(link)) return;
  try {
    symlinkSync(target, link);
    console.log(`symlink: ${link} -> ${target}`);
  } catch (err) {
    console.warn(`symlink failed ${link}: ${err.message}`);
  }
}

function wrapperShim(realTool, toolName) {
  // bash shim: expands a MSBuild .rsp file (BOM + quoted args on lines),
  // converts absolute paths to relative (wine maps the cwd to Z:\ by default
  // only for relative paths), then execs wine on the real tool.
  const rspExpansion = `if [[ "$1" == @* ]]; then
  rsp="\${1#@}"
  while IFS= read -r line; do
    line=\${line#$'\\xef\\xbb\\xbf'}
    line=\${line#\\"}
    line=\${line%\\"}
    for a in $line; do args+=("$a"); done
  done < "$rsp"
else
  args=("$@")
fi
out=()
for a in "\${args[@]}"; do
  case "$a" in
    /*) if [ -e "$a" ]; then
          rel=$(realpath --relative-to="$PWD" "$a")
          case "$rel" in -*) rel="./$rel" ;; esac
          a="$rel"
        fi ;;
    -I/*) inc="\${a#-I}"; if [ -d "$inc" ]; then inc=$(realpath --relative-to="$PWD" "$inc"); case "$inc" in -*) inc="./$inc" ;; esac; a="-I$inc"; fi ;;
  esac
  out+=("$a")
done`;
  return `#!/bin/bash
# Wrapper: runs ${toolName} (.NET) under Wine with the project-local prefix.
export WINEPREFIX=${prefix}
real="${realTool}"
args=()
${rspExpansion}
exec wine "$real" "\${out[@]}"
`;
}

function setupVssdk() {
  step(`VSSDK.BuildTools ${VSSDK_VERSION} patches (${vssdkDir})`);
  if (!existsSync(vssdkDir)) {
    console.error(`VSSDK nuget package not found at ${vssdkDir}. Run 'dotnet restore' first.`);
    process.exit(1);
  }
  const toolsDir = join(vssdkDir, "tools", "vssdk");

  // case-sensitivity: the targets reference Microsoft.VSSDK.targets, the
  // package ships Microsoft.VsSDK.targets (different case, same file)
  symlinkIfMissing("Microsoft.VsSDK.targets", join(toolsDir, "Microsoft.VSSDK.targets"));
  symlinkIfMissing("Microsoft.VsSDK.Suppressions.targets", join(toolsDir, "Microsoft.VsSdk.Suppressions.targets"));

  // the VSCT MSBuild task builds the tool dir with Path.Combine:
  // "$(NuGetPackageRoot)build\..\tools\VSSDK\bin" — on Linux the backslash
  // stays literal → create that literal dir with wrapper shims
  const backslashDir = join(vssdkDir, "build", "\\..\\tools\\VSSDK\\bin");
  mkdirSync(backslashDir, { recursive: true });
  const realBin = join(vssdkDir, "tools", "vssdk", "bin");
  const shims = {
    "vsct.exe": "VSCT.exe",
    "CreatePkgDef.exe": "CreatePkgDef.exe",
    "RegRiched20.exe": "RegRiched20.exe",
    "VsixPublisher.exe": "VsixPublisher.exe",
    "VsixUtil.exe": "VsixUtil.exe",
  };
  // lowercase tool names (the package's own layout) also resolve to the
  // uppercase VSSDK\bin dir in the targets — same wrappers there, so every
  // path the MSBuild targets try ends up on the wine shim
  const upperBin = join(vssdkDir, "tools", "VSSDK", "bin");
  mkdirSync(upperBin, { recursive: true });
  const upperShims = {
    "vsct.exe": "VSCT.exe",
    "createpkgdef.exe": "CreatePkgDef.exe",
    "regriched20.exe": "RegRiched20.exe",
    "vsixpublisher.exe": "VsixPublisher.exe",
    "vsixutil.exe": "VsixUtil.exe",
  };
  const installShims = (dir, map) => {
    for (const [shimName, realName] of Object.entries(map)) {
      const shimPath = join(dir, shimName);
      const realTool = join(realBin, realName);
      if (!existsSync(realTool)) {
        console.warn(`real tool missing (skip): ${realTool}`);
        continue;
      }
      if (existsSync(shimPath)) {
        // already a shim (a bash script from a previous run) → refresh the
        // prefix line only (the rest is stable)
        const content = readFileSync(shimPath, "utf8");
        if (content.includes("export WINEPREFIX")) {
          writeFileSync(shimPath, content.replace(/export WINEPREFIX=.*/, `export WINEPREFIX=${prefix}`), { mode: 0o755 });
          continue;
        }
        writeFileSync(shimPath, wrapperShim(realTool, realName), { mode: 0o755 });
        continue;
      }
      writeFileSync(shimPath, wrapperShim(realTool, realName), { mode: 0o755 });
      console.log(`wrapper: ${shimName} -> wine ${realName}`);
    }
  };
  installShims(backslashDir, shims);
  installShims(upperBin, upperShims);

  // Newtonsoft.Json.dll → netstandard2.0 (13.0.3): the shipped build needs
  // System.Security.Permissions which fails to load under the dotnet CLI
  const nsJson = join(nugetCache, "newtonsoft.json", "13.0.3", "lib", "netstandard2.0", "Newtonsoft.Json.dll");
  const targets = [
    join(vssdkDir, "Newtonsoft.Json.dll"),
    join(realBin, "lib", "Newtonsoft.Json.dll"),
    join(vssdkDir, "..", "VSSDK", "Newtonsoft.Json.dll"),
  ];
  if (!existsSync(nsJson)) {
    console.warn(`newtonsoft.json 13.0.3 netstandard2.0 not found (${nsJson}) — run 'dotnet restore'`);
  } else {
    for (const t of targets) {
      if (!existsSync(t)) continue;
      copyFileSync(nsJson, t);
      console.log(`Newtonsoft.Json.dll replaced: ${t}`);
    }
  }
}

// --- 3. workspace settings: never expose the prefix to indexers ------------
// The prefix contains dosdevices/z: -> / (wine maps the unix root). VS Code
// search/watcher that follow symlinks escape the workspace through it and
// scan the whole filesystem (4 ripgrep at 100% CPU). The guard keys live in
// .vscode-example/settings.json (committed, single source of truth); merge
// them into .vscode/settings.json (idempotent, preserves other settings).
function ensureWorkspaceSettings() {
  step("workspace settings (indexer guard for .wine)");
  const vscodeDir = join(root, ".vscode");
  const settingsPath = join(vscodeDir, "settings.json");
  const examplePath = join(root, ".vscode-example", "settings.json");
  const fallback = {
    "search.followSymlinks": false,
    "search.exclude": { "**/.wine/**": true },
    "files.exclude": { "**/.wine/**": true },
    "files.watcherExclude": { "**/.wine/**": true },
  };
  let guardKeys = fallback;
  if (existsSync(examplePath)) {
    try {
      const example = JSON.parse(readFileSync(examplePath, "utf8"));
      guardKeys = {};
      for (const key of Object.keys(fallback)) {
        guardKeys[key] = example[key] ?? fallback[key];
      }
    } catch (err) {
      console.warn(`could not parse ${examplePath} (${err.message}) — using built-in fallback`);
    }
  }
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (err) {
      console.warn(`could not parse ${settingsPath} (${err.message}) — add the .wine excludes manually`);
      return;
    }
  }
  let changed = false;
  for (const [key, value] of Object.entries(guardKeys)) {
    if (key === "search.followSymlinks") {
      if (settings[key] !== value) {
        settings[key] = value;
        changed = true;
      }
      continue;
    }
    const merged = { ...(settings[key] ?? {}), ...value };
    if (JSON.stringify(merged) !== JSON.stringify(settings[key] ?? {})) {
      settings[key] = merged;
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(vscodeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(`updated ${settingsPath} (search.followSymlinks=false, .wine excluded from search/files/watcher)`);
  } else {
    console.log("settings already protected");
  }
}

function main() {
  ensureWorkspaceSettings();
  setupPrefix();
  setupVssdk();
  console.log("\nDone. Build the adapter with:\n  pnpm build && dotnet build src/adapters/visualstudio/PiWebview.Vs.slnx");
}

main();
