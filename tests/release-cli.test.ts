import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runRelease = (args: string[]) =>
  spawnSync(process.execPath, ["tools/release.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

test("release CLI rejects unsafe argument combinations before release work starts", () => {
  const combined = runRelease(["--version", "0.5.0", "--publish"]);
  assert.notEqual(combined.status, 0);
  assert.match(
    `${combined.stdout}\n${combined.stderr}`,
    /--version cannot be combined with --publish/,
  );

  const tagWithoutPublish = runRelease(["--version", "0.5.0", "--tag", "next"]);
  assert.notEqual(tagWithoutPublish.status, 0);
  assert.match(
    `${tagWithoutPublish.stdout}\n${tagWithoutPublish.stderr}`,
    /--tag requires --publish/,
  );

  const unknown = runRelease(["--not-a-release-option"]);
  assert.notEqual(unknown.status, 0);
  assert.match(`${unknown.stdout}\n${unknown.stderr}`, /unknown release argument/);
});
