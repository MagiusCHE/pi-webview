import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("VS Code passes the resolved absolute executable to PiProcess, not the bare Windows shim", () => {
  const host = readFileSync("src/adapters/vscode/host.ts", "utf8");
  // resolveDirectNode reads the shim file. A bare pi.cmd cannot be read from
  // an arbitrary workspace and silently falls back to cmd /c, breaking RPC
  // stdin and making startup-info address the launcher rather than Pi itself.
  assert.match(host, /new PiProcess\(\s*piCmd\.path \?\? piCmd\.command,/);
});
