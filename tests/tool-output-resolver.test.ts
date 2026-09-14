import assert from "node:assert/strict";
import test from "node:test";

import { TrailingToolOutputResolver } from "../src/web/tool-output-resolver.ts";

type Output = { id: string; value: string };

function resolver(): TrailingToolOutputResolver<Output> {
  const value = new TrailingToolOutputResolver<Output>();
  value.beginRun();
  return value;
}

test("a final tool result becomes the response when the agent settles", () => {
  const value = resolver();
  value.record({ id: "tool-1", value: '{"status":"ok"}' });
  assert.deepEqual(value.settle(), [{ id: "tool-1", value: '{"status":"ok"}' }]);
  assert.deepEqual(value.settle(), []);
});

test("a later visible assistant response consumes trailing tool results", () => {
  const value = resolver();
  value.record({ id: "tool-1", value: "technical result" });
  value.assistantVisible();
  assert.deepEqual(value.settle(), []);
});

test("a later tool call makes the previous result intermediate", () => {
  const value = resolver();
  value.record({ id: "first", value: "intermediate" });
  value.assistantToolCall();
  value.record({ id: "second", value: "final" });
  assert.deepEqual(value.settle(), [{ id: "second", value: "final" }]);
});

test("parallel results in the final tool batch retain their order", () => {
  const value = resolver();
  value.record({ id: "first", value: "one" });
  value.record({ id: "second", value: "two" });
  assert.deepEqual(value.settle(), [
    { id: "first", value: "one" },
    { id: "second", value: "two" },
  ]);
});

test("a repeated execution end replaces rather than duplicates its result", () => {
  const value = resolver();
  value.record({ id: "tool-1", value: "partial" });
  value.record({ id: "tool-1", value: "authoritative" });
  assert.deepEqual(value.settle(), [{ id: "tool-1", value: "authoritative" }]);
});
