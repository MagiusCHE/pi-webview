import assert from "node:assert/strict";
import test from "node:test";

import { redactDebugFrame } from "../src/bridge/debug-log.ts";

test("bridge debug frames redact handoff tickets and credentials", () => {
  const output = redactDebugFrame({
    channel: "ide",
    payload: {
      ticket: "private-handoff-ticket",
      controlCapability: "private-capability",
      serverUrl: "http://127.0.0.1:7361/?token=private-token&s=session-id",
      content: "private page DOM or screenshot bytes",
      actions: [{ type: "type", selector: "#secret", text: "private draft" }],
      ordinary: "visible",
    },
  });

  assert.doesNotMatch(
    output,
    /private-handoff-ticket|private-capability|private-token|private page DOM|private draft|#secret/,
  );
  assert.match(output, /<redacted>/);
  assert.match(output, /visible/);
  assert.match(output, /session-id/);
});
