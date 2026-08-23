#!/usr/bin/env node
// Release prep/publish per il pacchetto pi @magiusche/pi-webview.
//
// Uso:
//   pnpm release -- --version 0.1.1                 → SOLO prepara (nessuna pubblicazione)
//   pnpm release -- --version 0.1.1 --tag next      → prepara (il tag serve alla pubblicazione)
//   pnpm release -- --publish                       → pubblica la versione corrente
//   pnpm release -- --version 0.1.1 --publish       → bump + rebuild + pubblica
//   pnpm release -- --version 0.1.1 --publish --tag beta
//
// - `--version <semver>`: aggiorna "version" in package.json (root, VS Code)
//   e in packages/pi-webview/package.json (pacchetto pi).
// - `--tag <dist-tag>`: dist-tag npm per la pubblicazione (latest è il default).
// - `--publish`: esegue `npm publish --access public` e, a pubblicazione
//   riuscita, crea in automatico il tag git `v<version>` + la GitHub release
//   (idempotente: se tag/release esistono già per quella versione, skip).

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = join(root, "package.json");
const pkgPi = join(root, "packages", "pi-webview", "package.json");
const piDir = join(root, "packages", "pi-webview");

// --- argomenti ---
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
  console.error(`✗ versione non valida: "${version}" (atteso semver, es. 0.1.1)`);
  process.exit(1);
}
if (tag !== undefined && !publish) {
  console.warn("⚠ --tag ignorato: senza --publish non si pubblica.");
}
if (!version && !publish) {
  console.error(
    "✗ uso: pnpm release -- --version <semver> [--tag <dist-tag>] [--publish]",
  );
  process.exit(1);
}

// --- 1) bump versione (se richiesto) ---
if (version) {
  for (const file of [pkgRoot, pkgPi]) {
    const json = JSON.parse(readFileSync(file, "utf-8"));
    const before = json.version;
    json.version = version;
    writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
    console.log(`✓ ${file.replace(root + "/", "")}: ${before} → ${version}`);
  }
} else {
  const cur = JSON.parse(readFileSync(pkgPi, "utf-8")).version;
  console.log(`→ nessun bump richiesto, versione corrente: ${cur}`);
}

// --- 2) rebuild (vsix companion + bundle pi) ---
console.log("\n→ build companion (vsix)…");
execSync("node tools/build-ide-vsix.mjs", { cwd: root, stdio: "inherit" });
console.log("→ build pacchetto pi (bundle + copia vsix)…");
execSync("node tools/build-addon.mjs", { cwd: root, stdio: "inherit" });

// --- 3) verifica tarball ---
const piJson = JSON.parse(readFileSync(pkgPi, "utf-8"));
console.log(`\n→ verifica tarball ${piJson.name}@${piJson.version}…`);
execSync("npm pack --dry-run", { cwd: piDir, stdio: "inherit" });

// --- 4) pubblicazione (solo con --publish esplicito) ---
if (publish) {
  console.log(
    `\n→ npm publish ${piJson.name}@${piJson.version}${tag ? ` --tag ${tag}` : ""}…`,
  );
  execSync(`npm publish --access public${tag ? ` --tag ${tag}` : ""}`, {
    cwd: piDir,
    stdio: "inherit",
  });
  console.log(`\n✓ pubblicato: ${piJson.name}@${piJson.version}`);
  console.log("→ gli utenti aggiornano con: pi update npm:@magiusche/pi-webview");

  // --- 5) tag git + release GitHub (solo dopo publish riuscito, idempotenti) ---
  const releaseName = `v${piJson.version}`;

  // usa `direnv exec .` per git push / gh (account GitHub corretto per il
  // repo) quando la dir del progetto o un parent ha un .envrc
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

  // tag git (idempotente)
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
    console.log(`→ tag git ${releaseName} già esistente: skip.`);
  } else {
    try {
      const dirty = execSync("git status --porcelain", {
        cwd: root,
        encoding: "utf-8",
      }).trim();
      if (dirty) {
        console.warn(
          `⚠ working tree sporco: il tag ${releaseName} verrà creato sul commit corrente (le modifiche non committate NON saranno incluse).`,
        );
      }
    } catch {
      // non in un repo git: si procede comunque
    }
    execSync(
      `git tag -a ${releaseName} -m "@magiusche/pi-webview ${piJson.version}"`,
      { cwd: root, stdio: "inherit" },
    );
    console.log(`✓ tag git creato: ${releaseName}`);
  }

  // push del tag
  try {
    run(`git push origin ${releaseName}`);
    console.log(`✓ tag pushato: ${releaseName}`);
  } catch (err) {
    console.warn(`⚠ push del tag fallito: ${err instanceof Error ? err.message : String(err)}`);
  }

  // release GitHub (idempotente)
  let ghExists = false;
  try {
    execSync(`gh release view ${releaseName}`, { cwd: root, stdio: "ignore" });
    ghExists = true;
  } catch {
    ghExists = false;
  }
  if (ghExists) {
    console.log(`→ release GitHub ${releaseName} già esistente: skip.`);
  } else {
    const notesFile = join(tmpdir(), `pi-webview-notes-${piJson.version}.md`);
    writeFileSync(
      notesFile,
      `@magiusche/pi-webview ${piJson.version}\n\nInstall: \`pi install npm:@magiusche/pi-webview\`\nUpdate: \`pi update --extensions\`\n\nhttps://www.npmjs.com/package/@magiusche/pi-webview\n`,
    );
    // tarball da allegare (opzionale: se il pack fallisce si allega il solo link)
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
      console.log(`✓ release GitHub creata: ${releaseName}`);
    } catch (err) {
      console.warn(
        `⚠ creazione release GitHub fallita: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      rmSync(notesFile, { force: true });
      if (tgzPath) rmSync(tgzPath, { force: true });
    }
  }
} else {
  console.log("\n✓ pacchetto pronto. Nulla è stato pubblicato.");
  console.log("→ per pubblicare: pnpm release -- --publish [--tag <dist-tag>]");
}
