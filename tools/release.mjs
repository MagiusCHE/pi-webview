#!/usr/bin/env node
// Deterministic release prep/publish for the pi package @magiusche/pi-webview.
//
// Usage:
//   pnpm release -- --version 0.1.1
//   pnpm release -- --publish
//   pnpm release -- --publish --publish-only
//   pnpm release -- --publish --tag next
//
// Preparation always builds every distributable artifact and packages one hashed
// tarball. Publishing requires the prepared version to be committed, uploads that
// exact tarball, verifies it on npm, then creates the matching Git tag and GitHub release.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NPMJS_REGISTRY, publishAndVerifyNpmPackage, runNpm } from "./npm-publish.mjs";
import { releaseChangelog, releaseNotesForVersion } from "./changelog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = join(root, "package.json");
const pkgPi = join(root, "packages", "pi-webview", "package.json");
const piDir = join(root, "packages", "pi-webview");
const changelogPath = join(root, "CHANGELOG.md");
const manifestPath = join(root, "dist", "release-manifest.json");

const RELEASE_ARTIFACTS = [
  "dist/pi-webview-ide.vsix",
  "dist/pi-webview-visualstudio.vsix",
  "dist/pi-webview-chrome.zip",
  "dist/pi-webview-chrome",
  "packages/pi-webview/companion/pi-webview-ide.vsix",
  "packages/pi-webview/companion/pi-webview-visualstudio.vsix",
  "packages/pi-webview/companion/pi-webview-chrome.zip",
  "packages/pi-webview/companion/chrome",
  "packages/pi-webview/dist",
  "packages/pi-webview/CHANGELOG.md",
  "packages/pi-webview/PRIVACY.md",
];

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const value = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const version = value("--version");
const tag = value("--tag");
const publish = has("--publish");
const publishOnly = has("--publish-only");
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const VALUE_FLAGS = new Set(["--version", "--tag"]);
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, "--publish", "--publish-only"]);

const fail = (message) => {
  throw new Error(message);
};

const validateArguments = () => {
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!KNOWN_FLAGS.has(argument)) fail(`unknown release argument: ${argument}`);
    if (seen.has(argument)) fail(`release argument may be used only once: ${argument}`);
    seen.add(argument);
    if (VALUE_FLAGS.has(argument)) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
    }
  }
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));
const writeJson = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const normalizedRelativePath = (path) => relative(root, path).split(sep).join("/");

const commandExists = (command) =>
  spawnSync(command, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;
const useDirenv = commandExists("direnv");

const runLocal = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });

const runLocalOutput = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

const remoteCommand = (command, args) =>
  useDirenv ? ["direnv", ["exec", root, command, ...args]] : [command, args];

const remoteEnvironment = {
  GH_PAGER: "cat",
  GH_PROMPT_DISABLED: "1",
  NO_COLOR: "1",
  PAGER: "cat",
};

const runRemote = (command, args, options = {}) => {
  const [executable, commandArgs] = remoteCommand(command, args);
  return execFileSync(executable, commandArgs, {
    cwd: root,
    env: { ...process.env, ...remoteEnvironment },
    stdio: "inherit",
    ...options,
  });
};

const runRemoteOutput = (command, args, options = {}) => {
  const [executable, commandArgs] = remoteCommand(command, args);
  return execFileSync(executable, commandArgs, {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, ...remoteEnvironment },
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
};

const gitOutput = (args) => runLocalOutput("git", args).trim();
const currentHead = () => gitOutput(["rev-parse", "HEAD"]);

const hashArtifact = (path) => {
  if (!existsSync(path))
    fail(`release artifact is missing: ${normalizedRelativePath(path)}`);

  const hash = createHash("sha256");
  const visit = (current) => {
    const stats = statSync(current);
    const name = normalizedRelativePath(current);
    const mode = stats.mode & 0o777;
    if (stats.isDirectory()) {
      hash.update(`D\0${name}\0${mode}\0`);
      for (const entry of readdirSync(current).sort()) visit(join(current, entry));
      return;
    }
    if (!stats.isFile()) fail(`release artifact is not a regular file: ${name}`);
    hash.update(`F\0${name}\0${mode}\0`);
    hash.update(readFileSync(current));
  };

  visit(path);
  return hash.digest("hex");
};

const artifactHashes = (paths) =>
  Object.fromEntries(paths.map((path) => [path, hashArtifact(join(root, path))]));

const tarballDetails = (filename) => {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename !== basename(filename) ||
    filename.includes("\\") ||
    !filename.endsWith(".tgz")
  ) {
    fail("release tarball filename is invalid");
  }
  const path = join(piDir, filename);
  if (!existsSync(path)) fail("release tarball is missing");
  const contents = readFileSync(path);
  return {
    filename,
    path,
    relativePath: normalizedRelativePath(path),
    integrity: `sha512-${createHash("sha512").update(contents).digest("base64")}`,
    shasum: createHash("sha1").update(contents).digest("hex"),
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
};

const writeBuildManifest = (releaseVersion, tarball) => {
  const paths = [...RELEASE_ARTIFACTS, tarball.relativePath];
  const manifest = {
    schemaVersion: 2,
    version: releaseVersion,
    commit: currentHead(),
    tarball: {
      filename: tarball.filename,
      path: tarball.relativePath,
      integrity: tarball.integrity,
      shasum: tarball.shasum,
      sha256: tarball.sha256,
    },
    artifacts: artifactHashes(paths),
  };
  writeJson(manifestPath, manifest);
  console.log(`✓ release artifact manifest → ${normalizedRelativePath(manifestPath)}`);
};

const verifyBuildManifest = (releaseVersion) => {
  if (!existsSync(manifestPath)) {
    fail(
      "--publish-only requires a successful full build for this release (manifest is missing)",
    );
  }

  let manifest;
  try {
    manifest = readJson(manifestPath);
  } catch {
    fail("--publish-only cannot read the release artifact manifest");
  }
  if (manifest?.schemaVersion !== 2 || manifest.version !== releaseVersion) {
    fail("--publish-only manifest does not match the package version being published");
  }
  if (manifest.commit !== currentHead()) {
    fail(
      "--publish-only artifacts were built for a different commit; run a full release build first",
    );
  }

  const tarball = tarballDetails(manifest.tarball?.filename);
  if (
    manifest.tarball?.path !== tarball.relativePath ||
    manifest.tarball?.integrity !== tarball.integrity ||
    manifest.tarball?.shasum !== tarball.shasum ||
    manifest.tarball?.sha256 !== tarball.sha256
  ) {
    fail("--publish-only tarball changed since its full build");
  }

  const paths = [...RELEASE_ARTIFACTS, tarball.relativePath];
  const mismatches = paths.filter(
    (path) => manifest.artifacts?.[path] !== hashArtifact(join(root, path)),
  );
  if (mismatches.length > 0) {
    fail(
      `--publish-only artifacts changed since their full build: ${mismatches.join(", ")}`,
    );
  }
  console.log("✓ release artifact manifest verified.");
  return tarball;
};

const assertCleanWorktree = () => {
  const dirty = gitOutput(["status", "--porcelain"]);
  if (dirty) {
    fail(
      "publishing requires a clean Git worktree so v<version> can identify the exact release commit; commit the prepared release, then run `pnpm release -- --publish`",
    );
  }
};

const readReleasePackages = () => {
  const rootPackage = readJson(pkgRoot);
  const piPackage = readJson(pkgPi);
  if (rootPackage.version !== piPackage.version) {
    fail("package.json and packages/pi-webview/package.json have different versions");
  }
  return { rootPackage, piPackage };
};

const assertPublishedVersionHasNotes = (releaseVersion) => {
  const notes = releaseNotesForVersion(
    readFileSync(changelogPath, "utf-8"),
    releaseVersion,
  );
  if (!notes || !/^\s*[-*]\s+\S/m.test(notes)) {
    fail(
      `CHANGELOG.md has no release notes for ${releaseVersion}; prepare the version with \`pnpm release -- --version ${releaseVersion}\` first`,
    );
  }
};

const prepareVersion = (releaseVersion) => {
  const changelogBefore = readFileSync(changelogPath, "utf-8");
  const releasedChangelog = releaseChangelog(
    changelogBefore,
    releaseVersion,
    new Date().toISOString().slice(0, 10),
  );

  for (const path of [pkgRoot, pkgPi]) {
    const json = readJson(path);
    const before = json.version;
    json.version = releaseVersion;
    writeJson(path, json);
    console.log(`✓ ${normalizedRelativePath(path)}: ${before} → ${releaseVersion}`);
  }
  if (releasedChangelog !== changelogBefore) {
    writeFileSync(changelogPath, releasedChangelog);
    console.log(`✓ CHANGELOG.md: Unreleased → ${releaseVersion}`);
  } else {
    console.log(`→ CHANGELOG.md already contains ${releaseVersion}`);
  }
};

const buildReleaseArtifacts = () => {
  console.log("\n→ build companion VS Code (vsix)…");
  runLocal(process.execPath, ["tools/build-ide-vsix.mjs"]);
  console.log("\n→ build companion Visual Studio (vsix)…");
  runLocal(process.execPath, ["tools/build-vs-vsix.mjs"]);
  console.log("\n→ build companion Chrome (zip)…");
  runLocal(process.execPath, ["tools/build-chrome-extension.mjs"]);
  console.log("→ build pi package (bundle + companion copies)…");
  runLocal(process.execPath, ["tools/build-addon.mjs"]);
};

const createReleaseTarball = (piPackage) => {
  console.log(`\n→ create verified tarball ${piPackage.name}@${piPackage.version}…`);
  const packed = runNpm(["pack", "--json", "--registry", NPMJS_REGISTRY], { cwd: piDir });
  if (packed.status !== 0) fail("unable to create the verified npm release tarball");

  let entries;
  try {
    entries = JSON.parse(packed.stdout);
  } catch {
    fail("npm pack did not return its JSON artifact metadata");
  }
  const filename = Array.isArray(entries) ? entries[0]?.filename : undefined;
  if (typeof filename !== "string" || filename.length === 0) {
    fail("npm pack did not report a tarball filename");
  }

  return tarballDetails(filename);
};

const localTagTarget = (releaseName) => {
  try {
    return gitOutput(["rev-parse", `${releaseName}^{}`]);
  } catch {
    return null;
  }
};

const ensureReleaseTag = (releaseName, releaseVersion) => {
  const head = currentHead();
  const existing = localTagTarget(releaseName);
  if (existing && existing !== head) {
    fail(
      `existing tag ${releaseName} points to ${existing}, not the release commit ${head}`,
    );
  }
  if (existing) {
    console.log(`→ git tag ${releaseName} already points to the release commit.`);
  } else {
    runLocal("git", [
      "tag",
      "-a",
      releaseName,
      "-m",
      `@magiusche/pi-webview ${releaseVersion}`,
    ]);
    console.log(`✓ git tag created: ${releaseName}`);
  }

  runRemote("git", ["push", "origin", releaseName]);
  const remoteRefs = runRemoteOutput("git", [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${releaseName}`,
    `refs/tags/${releaseName}^{}`,
  ]);
  const remoteLines = remoteRefs.trim().split(/\r?\n/).filter(Boolean);
  const directRef = `refs/tags/${releaseName}`;
  const peeledRef = `${directRef}^{}`;
  const remoteTarget =
    remoteLines
      .map((line) => line.split(/\s+/, 2))
      .find(([, ref]) => ref === peeledRef)?.[0] ??
    remoteLines
      .map((line) => line.split(/\s+/, 2))
      .find(([, ref]) => ref === directRef)?.[0];
  if (!remoteTarget) fail(`remote tag ${releaseName} could not be verified`);
  if (remoteTarget !== head) {
    fail(
      `remote tag ${releaseName} points to ${remoteTarget}, not the release commit ${head}`,
    );
  }
  console.log(`✓ tag pushed and verified: ${releaseName}`);
};

const readGitHubRelease = (releaseName) => {
  try {
    return JSON.parse(
      runRemoteOutput("gh", ["release", "view", releaseName, "--json", "url,assets"]),
    );
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (/release not found|HTTP 404/i.test(output)) return null;
    throw new Error(`unable to query GitHub release ${releaseName}`);
  }
};

const releaseNotes = (piPackage) =>
  `@magiusche/pi-webview ${piPackage.version}\n\nInstall: \`pi install npm:@magiusche/pi-webview\`\nUpdate: \`pi update --extensions\`\n\nhttps://www.npmjs.com/package/@magiusche/pi-webview\n`;

const ensureGitHubRelease = (releaseName, piPackage, tarball) => {
  const notesPath = join(root, "dist", `release-notes-${piPackage.version}.md`);
  writeFileSync(notesPath, releaseNotes(piPackage));

  try {
    const expectedDigest = `sha256:${tarball.sha256}`;
    let release = readGitHubRelease(releaseName);
    let asset = release?.assets?.find((entry) => entry.name === tarball.filename);
    if (!release) {
      runRemote("gh", [
        "release",
        "create",
        releaseName,
        tarball.path,
        "--title",
        `@magiusche/pi-webview ${piPackage.version}`,
        "--notes-file",
        notesPath,
      ]);
      console.log(`✓ GitHub release created: ${releaseName}`);
    } else if (asset?.digest !== expectedDigest) {
      runRemote("gh", ["release", "upload", releaseName, tarball.path, "--clobber"]);
      console.log(`✓ GitHub release asset uploaded: ${tarball.filename}`);
    } else {
      console.log(
        `→ GitHub release ${releaseName} already contains the verified ${tarball.filename}.`,
      );
    }

    release = readGitHubRelease(releaseName);
    asset = release?.assets?.find((entry) => entry.name === tarball.filename);
    if (!release || asset?.digest !== expectedDigest) {
      fail(`GitHub release ${releaseName} could not be verified with its exact tarball`);
    }
    console.log(`✓ GitHub release verified: ${release.url}`);
  } finally {
    rmSync(notesPath, { force: true });
  }
};

const main = async () => {
  validateArguments();
  if (version !== undefined && !SEMVER.test(version)) {
    fail(`invalid version: "${version}" (expected semver, e.g. 0.1.1)`);
  }
  if (has("--tag") && (!tag || tag.startsWith("--"))) {
    fail("--tag requires a non-empty npm dist-tag value");
  }
  if (tag && !publish) fail("--tag requires --publish");
  if (publishOnly && !publish) fail("--publish-only requires --publish");
  if (publishOnly && version) fail("--publish-only cannot be combined with --version");
  if (publish && version) {
    fail(
      "--version cannot be combined with --publish: prepare the release, commit it, then publish so the tag always identifies the exact release commit",
    );
  }
  if (!version && !publish) {
    fail(
      "usage: pnpm release -- --version <semver> | --publish [--publish-only] [--tag <dist-tag>]",
    );
  }
  if (version) {
    prepareVersion(version);
  } else {
    console.log(`→ no bump requested, current version: ${readJson(pkgPi).version}`);
  }

  const { piPackage } = readReleasePackages();
  if (publish) {
    assertPublishedVersionHasNotes(piPackage.version);
    assertCleanWorktree();
  }
  let tarball;
  if (publishOnly) {
    tarball = verifyBuildManifest(piPackage.version);
    console.log("\n→ --publish-only: reusing the verified release artifacts.");
  } else {
    buildReleaseArtifacts();
    tarball = createReleaseTarball(piPackage);
    writeBuildManifest(piPackage.version, tarball);
  }

  if (!publish) {
    console.log(
      "\n✓ release preparation completed. Commit the release, then publish with:",
    );
    console.log("→ pnpm release -- --publish [--tag <dist-tag>]");
    return;
  }

  assertCleanWorktree();
  const publication = await publishAndVerifyNpmPackage({
    packageDir: piDir,
    tarballPath: tarball.path,
    integrity: tarball.integrity,
    shasum: tarball.shasum,
    name: piPackage.name,
    version: piPackage.version,
    tag,
    registry: NPMJS_REGISTRY,
  });
  const npmUrl = `https://www.npmjs.com/package/${piPackage.name}/v/${piPackage.version}`;
  console.log(`✓ npm package verified: ${npmUrl}`);
  if (!publication.published) {
    console.log(
      "→ npm publication was already present; continuing deterministic release recovery.",
    );
  }

  const releaseName = `v${piPackage.version}`;
  ensureReleaseTag(releaseName, piPackage.version);
  ensureGitHubRelease(releaseName, piPackage, tarball);
};

try {
  await main();
} catch (error) {
  console.error(
    `✗ release failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
