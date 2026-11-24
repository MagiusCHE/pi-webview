import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  checkLauncherPath,
  launcherPathMessage,
} from "../packages/pi-webview/lib/launcher-path.ts";

function fixture(context: TestContext) {
  mkdirSync(".tmp", { recursive: true });
  const root = mkdtempSync(resolve(".tmp", "launcher-path-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "local bin");
  const alternate = join(root, "npm-bin");
  mkdirSync(dir);
  mkdirSync(alternate);
  const launchers = ["piw", "piw-public"].map((name) => {
    const target = join(root, `${name}.js`);
    const link = join(dir, name);
    writeFileSync(target, "", { mode: 0o755 });
    symlinkSync(target, link);
    return { name, target, link };
  });
  return { dir, alternate, launchers };
}

for (const platform of ["linux", "darwin"] as const) {
  test(
    `checks both standalone launchers on ${platform}`,
    { skip: process.platform === "win32" },
    (context) => {
      const { dir, alternate, launchers } = fixture(context);
      const check = (path?: string) => checkLauncherPath(launchers, { platform, path });
      assert.deepEqual(check(), { kind: "path", dir, names: ["piw", "piw-public"] });
      assert.equal(check(`${alternate}:${dir}`), undefined);

      const piw = launchers[0]!;
      symlinkSync(piw.target, join(alternate, piw.name));
      assert.deepEqual(check(alternate), { kind: "path", dir, names: ["piw-public"] });

      const otherPiw = join(alternate, piw.name);
      rmSync(otherPiw);
      writeFileSync(otherPiw, "", { mode: 0o755 });
      assert.deepEqual(check(`${alternate}:${dir}`), {
        kind: "path",
        dir,
        names: ["piw"],
      });
      assert.equal(check(`${dir}:${alternate}`), undefined);

      const publicLauncher = launchers[1]!;
      rmSync(publicLauncher.target);
      assert.deepEqual(check(dir), { kind: "unavailable", dir, names: ["piw-public"] });
    },
  );
}

test("does not diagnose Windows PATH with Unix lookup rules", () => {
  assert.equal(
    checkLauncherPath([{ name: "piw", link: "", target: "" }], {
      platform: "win32",
      path: "",
    }),
    undefined,
  );
});

test("offers localized shell instructions without relying on the npm bin directory", () => {
  const issue = {
    kind: "path",
    dir: "/Users/O'Neil/.local/bin",
    names: ["piw", "piw-public"],
  } as const;
  const input = { ...issue, names: [...issue.names] };
  const zsh = launcherPathMessage(input, "/bin/zsh", "en");
  assert.ok(zsh.includes(`export PATH='/Users/O'\\''Neil/.local/bin'"\${PATH:+:$PATH}"`));
  assert.match(zsh, /command -v piw; command -v piw-public/);
  const fish = launcherPathMessage(input, "/usr/bin/fish", "it");
  assert.match(fish, /il PATH corrente di Pi/);
  assert.ok(fish.includes("fish_add_path --move '/Users/O\\'Neil/.local/bin'"));
});
