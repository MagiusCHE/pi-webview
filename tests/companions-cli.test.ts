// Windows `where code` selection: only CLI wrappers (or a bin-local .exe) may
// be used. The GUI Code.exe rejects every CLI flag with
// "bad option: --list-extensions", which surfaced as a VS Code companion error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWindowsCodeCli } from "../src/bridge/companions.ts";

const ROOT = "C:\\Users\\galviani\\AppData\\Local\\Programs\\Microsoft VS Code";

test("prefers the code.cmd CLI wrapper over the GUI Code.exe", () => {
  assert.equal(
    pickWindowsCodeCli([
      `${ROOT}\\Code.exe`,
      `${ROOT}\\bin\\code.cmd`,
      `${ROOT}\\bin\\code`,
    ]),
    `${ROOT}\\bin\\code.cmd`,
  );
});

test("a bare GUI Code.exe is never used as the CLI", () => {
  assert.equal(pickWindowsCodeCli([`${ROOT}\\Code.exe`]), null);
  assert.equal(pickWindowsCodeCli([`${ROOT}\\bin\\code`, ""]), null);
});

test("a bin-local code.exe stays valid, the install-root one does not", () => {
  assert.equal(pickWindowsCodeCli([`${ROOT}\\bin\\code.exe`]), `${ROOT}\\bin\\code.exe`);
  assert.equal(
    pickWindowsCodeCli([`${ROOT}\\Code.exe`, `${ROOT}\\code.bat`]),
    `${ROOT}\\code.bat`,
  );
});
