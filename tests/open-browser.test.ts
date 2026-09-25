import { test } from "node:test";
import assert from "node:assert/strict";
import { browserOpenCommand } from "../src/bridge/open-browser.ts";

test("Windows opens the complete piw launch URL, including the workspace intent", () => {
  const url = "http://127.0.0.1:7361/?new=1&launch=opaque-id";
  assert.deepEqual(browserOpenCommand(url, "win32"), {
    command: "cmd",
    args: ["/d", "/c", "start", '""', `"${url}"`],
    windowsVerbatimArguments: true,
  });
});

test("Windows quotes session URLs without allowing embedded quotes into cmd", () => {
  const command = browserOpenCommand('http://127.0.0.1:7361/?s=some"id&new=1', "win32");
  assert.equal(command.args[4], '"http://127.0.0.1:7361/?s=some%22id&new=1"');
});

test("other platforms pass the launch URL as one argument", () => {
  const url = "http://127.0.0.1:7361/?new=1&launch=opaque-id";
  assert.deepEqual(browserOpenCommand(url, "linux"), {
    command: "xdg-open",
    args: [url],
  });
  assert.deepEqual(browserOpenCommand(url, "darwin"), {
    command: "open",
    args: [url],
  });
});
