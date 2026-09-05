// pi self-update check (pi.dev UI parity, 2026-09-04).
//
// The pi TUI shows a "pi core vX.Y.Z is outdated — update: /piw update.pi.core"
// line at startup; the webview had no equivalent. This module runs the SAME
// check the pi extension uses:
//   1. current version: `pi --version` on PATH (the very binary the session
//      runs — not the version of THIS package)
//   2. latest version: `npm view <package> version --json` against the
//      configured registry (honors ~/.npmrc; a registry-less sandbox →
//      lookup fails → check silently skipped: BEST-EFFORT by design)
//   3. NO cache: every pi process runs the check LIVE at load (a fresh
//      release must be seen at the next session start, not an hour later),
//      plus on demand via the webview (the `/piw update.check` command).
//      The check is non-blocking and best-effort; a few registry lookups
//      per pi load is the accepted cost
//
// It also checks the INSTALLED pi extensions (pi package list sources with
// the `npm:` prefix — user settings `~/.pi/agent/settings.json` plus
// project settings `<cwd>/.pi/settings.json`): for each npm-installed
// package the version from its own package.json is compared against the
// registry latest. LOCAL extensions (path / git sources — not installed
// from an internet repo) are skipped by definition.
//
// All failures are silent (never throw): a broken network or a missing pi
// binary must not break the extension load or the webview boot.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** one outdated npm package (pi core or an extension) */
export interface PackageUpdate {
  name: string;
  current: string;
  latest: string;
}

/** Update check result: `core` non-null when the pi core is outdated;
 *  `extensions` lists the npm-installed extensions with a newer registry
 *  version. The caller gets `null` only when nothing is outdated. */
export interface UpdateAvailable {
  core: { current: string; latest: string } | null;
  extensions: PackageUpdate[];
}

export interface CheckOptions {
  home?: string;
  /** for the project-scoped package list (`<dir>/.pi/settings.json` +
   *  `<dir>/.pi/npm` installs) */
  projectDir?: string;
}

// --- pi binary location ------------------------------------------------------

/** locate the pi binary the session runs (cross-platform, best-effort,
 *  never throws): PATH scan first (incl. the Windows npm `.cmd` shim), then
 *  the global npm root. Returns null when not found. */
export function locatePi(): Promise<string | null> {
  const names = process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
  const dirs = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      try {
        const p = join(dir, name);
        if (existsSync(p) && statSync(p).isFile()) {
          return Promise.resolve(p);
        }
      } catch {
        // keep scanning
      }
    }
  }
  try {
    const r = spawnSync("npm", ["root", "-g"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const root = String(r.stdout ?? "").trim();
    if (root) {
      const p = join(root, PI_PACKAGE, "dist", "bundle", "cli.js");
      if (existsSync(p)) return Promise.resolve(p);
    }
  } catch {
    // not fatal
  }
  return Promise.resolve(null);
}

// --- version comparison -----------------------------------------------------

function cleanVersion(v: unknown): string {
  return String(v ?? "")
    .trim()
    .replace(/^[v=]+/, "");
}

/** numeric-per-part semver-ish compare: returns -1/0/1 */
export function compareVersions(a: string, b: string): number {
  const pa = cleanVersion(a)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = cleanVersion(b)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

// --- registry lookup ----------------------------------------------------------

/** the very pi binary the session runs: `pi --version` on PATH */
function currentVersion(): string | null {
  try {
    const r = spawnSync("pi", ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const v = String(r.stdout ?? "").trim();
    if (!v || r.status !== 0) return null;
    // "pi 0.85.0" style → last token that looks version-ish
    const m = v.match(/v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)/);
    return m?.[1] ?? v;
  } catch {
    return null;
  }
}

/**
 * npm view <pkg> version --json
 * run from a neutral cwd (tmpdir) so NO local package.json/.npmrc is picked
 * up: the registry comes from the user's ~/.npmrc and nothing else. `--json`
 * so the output is parseable whatever the npm major (npm 12 returns an array
 * for a single field: ["0.85.1"]).
 */
function latestVersion(pkg: string = PI_PACKAGE): string {
  try {
    // the neutral cwd MUST exist (spawnSync ENOENT otherwise) and be
    // outside any project: npm validates the local project's devEngines
    // when run inside one, and a devEngines-invalid project (like this
    // repo's, see docs/issues/pi-core/npm-devengines-ebaddevengines.md)
    // would make the lookup fail with EBADDEVENGINES
    const cwd = join(tmpdir(), "pi-webview-uc");
    mkdirSync(cwd, { recursive: true });
    const r = spawnSync("npm", ["view", pkg, "version", "--json"], {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: process.env,
      cwd,
    });
    return r.stdout ?? "";
  } catch {
    return "";
  }
}

/** `npm view ... --json` output → version string (string or array form),
 *  or null. Never throws. Candidates must look like versions (the lookup
 *  can answer garbage for unpublished/renamed packages). */
export function parseLatestVersion(raw: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const isVersion = (x: string): boolean => {
    const v = cleanVersion(x);
    return /^\d+\.\d+/.test(v);
  };
  if (typeof data === "string" && isVersion(data)) return data;
  if (Array.isArray(data)) {
    const s = data.filter((x): x is string => typeof x === "string" && isVersion(x));
    if (s.length === 0) return null;
    // single field can come as ["0.85.0"]; multiple → take the highest
    return s.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
  }
  return null;
}

// --- installed extensions (npm sources only) ---------------------------------

/** npm package names from a settings `packages` list (best-effort, never
 *  throws). Sources that are NOT `npm:<name>` (local paths, git repos) are
 *  skipped: they are not installed from the npm registry. */
export function parseNpmSources(settings: unknown): string[] {
  const raw = (settings as { packages?: unknown } | null)?.packages;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== "string" || !p.startsWith("npm:")) continue;
    const name = p.slice("npm:".length);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** read a settings.json (user or project scope) → unknown */
function readSettings(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** npm-installed extension names: user packages + project packages,
 *  deduplicated (user scope first — where the packages are usually installed) */
function npmExtensionNames(home: string, projectDir: string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const files = [join(home, ".pi", "agent", "settings.json")];
  if (projectDir) files.push(join(projectDir, ".pi", "settings.json"));
  for (const file of files) {
    for (const name of parseNpmSources(readSettings(file))) {
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

/** version declared by the INSTALLED package's own package.json
 *  (user npm prefix, then project npm prefix if present) */
function installedExtensionVersion(
  home: string,
  projectDir: string | undefined,
  name: string,
): string | null {
  const roots = [join(home, ".pi", "agent", "npm")];
  if (projectDir) roots.push(join(projectDir, ".pi", "npm"));
  for (const root of roots) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version) return pkg.version;
    } catch {
      // not installed here — try the next root
    }
  }
  return null;
}

// --- the check -----------------------------------------------------------------

/** full check, LIVE (no cache: fresh registry lookups on every call),
 *  best-effort: returns the outdated pieces (core and/or extensions) or
 *  null when everything is up-to-date / not checkable. NEVER throws. */
export async function checkPiUpdate(
  opts: CheckOptions = {},
): Promise<UpdateAvailable | null> {
  const home = opts.home ?? homedir();

  // --- pi core (LIVE lookup: no cache) ---
  const current = currentVersion();
  const coreLatest = current ? parseLatestVersion(latestVersion()) : null;
  const core: { current: string; latest: string } | null =
    current && coreLatest !== null && compareVersions(current, coreLatest) < 0
      ? { current, latest: coreLatest }
      : null;

  // --- npm-installed extensions (local/git sources skipped upstream) ---------
  const names = npmExtensionNames(home, opts.projectDir);
  const extensions: PackageUpdate[] = [];
  if (names.length > 0) {
    // LIVE per-package lookup (no cache)
    const results = await Promise.all(
      names.map(async (name): Promise<PackageUpdate & { _installed: string | null }> => {
        const installed = installedExtensionVersion(home, opts.projectDir, name);
        if (!installed) return { name, current: "", latest: "", _installed: null };
        const latest = parseLatestVersion(latestVersion(name)) ?? "";
        return { name, current: installed, latest, _installed: installed };
      }),
    );
    for (const r of results) {
      if (!r._installed) continue;
      if (r.latest !== "" && compareVersions(r.current, r.latest) < 0)
        extensions.push({ name: r.name, current: r.current, latest: r.latest });
    }
  }

  if (!core && extensions.length === 0) return null;
  return { core, extensions };
}
