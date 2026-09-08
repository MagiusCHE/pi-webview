import { test } from "node:test";
import assert from "node:assert/strict";
import { rpc } from "../src/ide/protocol.ts";

test("rpc.clearQueue emits the native clear_queue command", () => {
  assert.deepEqual(rpc.clearQueue(), { type: "clear_queue" });
});

test("rpc.steer preserves multimodal input", () => {
  const images = [{ type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" }];
  assert.deepEqual(rpc.steer("change direction", images), {
    type: "steer",
    message: "change direction",
    images,
  });
});
