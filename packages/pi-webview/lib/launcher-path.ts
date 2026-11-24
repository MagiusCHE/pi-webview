import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import en from "../locale/en.json" with { type: "json" };
import it from "../locale/it.json" with { type: "json" };

type Launcher = { name: string; link: string; target: string };
type PathIssue = { kind: "path" | "unavailable"; dir: string; names: string[] };

function executableTarget(file: string): string | undefined {
  try {
    if (!statSync(file).isFile()) return undefined;
    accessSync(file, constants.X_OK);
    return realpathSync(file);
  } catch {
    return undefined;
  }
}

export function checkLauncherPath(
  launchers: readonly Launcher[],
  { platform, path }: { platform: NodeJS.Platform; path: string | undefined },
): PathIssue | undefined {
  if (platform !== "darwin" && platform !== "linux") return;
  const dirs = path?.split(":") ?? [];
  const missing: string[] = [];
  const unavailable: string[] = [];
  for (const { name, link, target } of launchers) {
    const expected = executableTarget(target);
    // Match the first executable, as the shell does. An npm-provided symlink
    // is fine if it already points to this package's launcher.
    if (expected && firstExecutableTarget(dirs, name) === expected) continue;
    if (expected && executableTarget(link) === expected) missing.push(name);
    else unavailable.push(name);
  }
  const first = launchers[0];
  if (!first) return;
  const dir = resolve(dirname(first.link));
  if (unavailable.length > 0) return { kind: "unavailable", dir, names: unavailable };
  if (missing.length > 0) return { kind: "path", dir, names: missing };
}

function firstExecutableTarget(
  dirs: readonly string[],
  name: string,
): string | undefined {
  for (const dir of dirs) {
    const found = executableTarget(join(dir, name));
    if (found) return found;
  }
}

export function launcherPathMessage(
  issue: PathIssue,
  shell: string,
  locale?: string,
): string {
  const messages = locale === "en" ? en : it;
  const args = {
    names: issue.names.join(", "),
    dir: issue.dir,
    checks: issue.names.map((name) => `command -v ${name}`).join("; "),
  };
  const text = (key: keyof typeof en) =>
    messages[key].replace(
      /\{(names|dir|checks)\}/g,
      (_, arg: keyof typeof args) => args[arg],
    );
  if (issue.kind === "unavailable") return text("unavailable");
  const lines = [text("path")];
  const shellName = basename(shell);
  if (shellName === "fish") {
    const quoted = `'${issue.dir.replace(/[\\']/g, "\\$&")}'`;
    lines.push(`fish_add_path --move ${quoted}`);
  } else if (["bash", "zsh", "sh", "dash", "ksh"].includes(shellName)) {
    const quoted = `'${issue.dir.replace(/'/g, "'\\''")}'`;
    lines.push(`export PATH=${quoted}"\${PATH:+:$PATH}"`, text("persist"));
  }
  lines.push(text("verify"));
  return lines.join("\n");
}
