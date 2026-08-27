#!/usr/bin/env node
// Release prep/publish for the pi package @magiusche/pi-webview.
//
// Usage:
//   pnpm release -- --version 0.1.1                 → ONLY prepare (no publish)
//   pnpm release -- --version 0.1.1 --tag next      → prepare (the tag is used by the publish)
//   pnpm release -- --publish                       → publish the current version
//   pnpm release -- --version 0.1.1 --publish       → bump + rebuild + publish
//   pnpm release -- --version 0.1.1 --publish --tag beta
//
// - `--version <semver>`: updates "version" in package.json (root, VS Code)
//   and in packages/pi-webview/package.json (pi package).
// - `--tag <dist-tag>`: npm dist-tag for the publish (latest is the default).
// - `--publish`: runs `npm publish --access public` and, after a successful
//   publish, automatically creates the git tag `v<version>` + the GitHub
//   release (idempotent: skips if tag/release already exist for that version).

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = join(root, "package.json");
const pkgPi = join(root, "packages", "pi-webview", "package.json");
const piDir = join(root, "packages", "pi-webview");

// --- arguments ---
const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const version = value("--version");
const tag = value("--tag");
const publish = has("--publish");

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
if (version !== undefined && !SEMVER.test(version)) {
  console.error(`✗ invalid version: "${version}" (expected semver, e.g. 0.1.1)`);
  process.exit(1);
}
if (tag !== undefined && !publish) {
  console.warn("⚠ --tag ignored: without --publish nothing is published.");
}
if (!version && !publish) {
  console.error(
    "✗ usage: pnpm release -- --version <semver> [--tag <dist-tag>] [--publish]",
  );
  process.exit(1);
}

// --- 1) version bump (if requested) ---
if (version) {
  for (const file of [pkgRoot, pkgPi]) {
    const json = JSON.parse(readFileSync(file, "utf-8"));
    const before = json.version;
    json.version = version;
    writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    console.log(`✓ ${relative(root, file)}: ${before} → ${version}`);
  }
} else {
  const cur = JSON.parse(readFileSync(pkgPi, "utf-8")).version;
  console.log(`→ no bump requested, current version: ${cur}`);
}

// --- 2) rebuild (companion vsix + pi bundle) ---
console.log("\n→ build companion VS Code (vsix)…");
execSync("node tools/build-ide-vsix.mjs", { cwd: root, stdio: "inherit" });
// Visual Studio companion (best effort: skipped on machines without the wine
// toolchain — build-addon.mjs warns and packages without it)
try {
  console.log("\n→ build companion Visual Studio (vsix)…");
  execSync("node tools/build-vs-vsix.mjs", { cwd: root, stdio: "inherit" });
} catch {
  console.warn("VS companion build skipped (wine toolchain missing? see tools/setup-vs-wine.mjs)");
}
console.log("→ build pacchetto pi (bundle + copia vsix)…");
execSync("node tools/build-addon.mjs", { cwd: root, stdio: "inherit" });

// --- 3) tarball check ---
const piJson = JSON.parse(readFileSync(pkgPi, "utf-8"));
console.log(`\n→ verifica tarball ${piJson.name}@${piJson.version}…`);
execSync("npm pack --dry-run", { cwd: piDir, stdio: "inherit" });

// --- 4) publish (only with explicit --publish) ---
if (publish) {
  console.log(
    `\n→ npm publish ${piJson.name}@${piJson.version}${tag ? ` --tag ${tag}` : ""}…`,
  );
  execSync(`npm publish --access public${tag ? ` --tag ${tag}` : ""}`, {
    cwd: piDir,
    stdio: "inherit",
  });
  console.log(`\n✓ pubblicato: ${piJson.name}@${piJson.version}`);
  console.log("→ users update with: pi update npm:@magiusche/pi-webview");

  // --- 5) git tag + GitHub release (only after a successful publish, idempotent) ---
  const releaseName = `v${piJson.version}`;

  // uses `direnv exec .` for git push / gh (correct GitHub account for the
  // repo) when the project dir or a parent has a .envrc
  const hasDirenv = (() => {
    try {
      execSync("which direnv", { stdio: "ignore" });
    } catch {
      return false;
    }
    let dir = root;
    for (;;) {
      if (existsSync(join(dir, ".envrc"))) return true;
      const parent = dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  })();
  const run = (cmd) =>
    execSync(hasDirenv ? `direnv exec . ${cmd}` : cmd, {
      cwd: root,
      stdio: "inherit",
    });

  // git tag (idempotent)
  let tagExists = false;
  try {
    execSync(`git rev-parse --verify refs/tags/${releaseName}`, {
      cwd: root,
      stdio: "ignore",
    });
    tagExists = true;
  } catch {
    tagExists = false;
  }
  if (tagExists) {
    console.log(`→ git tag ${releaseName} already exists: skip.`);
  } else {
    try {
      const dirty = execSync("git status --porcelain", {
        cwd: root,
        encoding: "utf-8",
      }).trim();
      if (dirty) {
        console.warn(
          `⚠ dirty working tree: the tag ${releaseName} will be created on the current commit (uncommitted changes will NOT be included).`,
        );
      }
    } catch {
      // not in a git repo: proceed anyway
    }
    execSync(
      `git tag -a ${releaseName} -m "@magiusche/pi-webview ${piJson.version}"`,
      { cwd: root, stdio: "inherit" },
    );
    console.log(`✓ git tag created: ${releaseName}`);
  }

  // push the tag
  try {
    run(`git push origin ${releaseName}`);
    console.log(`✓ tag pushed: ${releaseName}`);
  } catch (err) {
    console.warn(`⚠ tag push failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // GitHub release (idempotent)
  let ghExists = false;
  try {
    execSync(`gh release view ${releaseName}`, { cwd: root, stdio: "ignore" });
    ghExists = true;
  } catch {
    ghExists = false;
  }
  if (ghExists) {
    console.log(`→ GitHub release ${releaseName} already exists: skip.`);
  } else {
    const notesFile = join(tmpdir(), `pi-webview-notes-${piJson.version}.md`);
    writeFileSync(
      notesFile,
      `@magiusche/pi-webview ${piJson.version}\n\nInstall: \`pi install npm:@magiusche/pi-webview\`\nUpdate: \`pi update --extensions\`\n\nhttps://www.npmjs.com/package/@magiusche/pi-webview\n`,
    );
    // tarball to attach (optional: if the pack fails, only the link is attached)
    let tgzPath = null;
    try {
      const out = execSync("npm pack", { cwd: piDir, encoding: "utf-8" });
      const filename = out.trim().split(/\r?\n/).pop() ?? "";
      if (filename) tgzPath = join(piDir, filename);
    } catch {
      tgzPath = null;
    }
    const tgzArg = tgzPath ? ` "${tgzPath}"` : "";
    try {
      run(
        `gh release create ${releaseName}${tgzArg} --title "@magiusche/pi-webview ${piJson.version}" --notes-file "${notesFile}"`,
      );
      console.log(`✓ GitHub release created: ${releaseName}`);
    } catch (err) {
      console.warn(
        `⚠ GitHub release creation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      rmSync(notesFile, { force: true });
      if (tgzPath) rmSync(tgzPath, { force: true });
    }
  }
} else {
  console.log("\n✓ package ready. Nothing was published.");
  console.log("→ to publish: pnpm release -- --publish [--tag <dist-tag>]");
}
