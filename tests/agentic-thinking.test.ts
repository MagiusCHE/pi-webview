import assert from "node:assert/strict";
import test from "node:test";
import {
  agenticHeaderLabelKey,
  agenticToolMetric,
  emptyAgenticCounts,
} from "../src/web/agentic-thinking.ts";

test("agentic thinking starts with no visible counters", () => {
  assert.deepEqual(emptyAgenticCounts(), {
    thought: 0,
    read: 0,
    write: 0,
    bash: 0,
    tools: 0,
  });
});

test("agentic live shell exposes waiting before real internal activity", () => {
  assert.equal(agenticHeaderLabelKey(true), "waitingResponse");
  assert.equal(agenticHeaderLabelKey(false), "agenticThinking");
});

test("agentic tool categories merge write/edit and keep dedicated tools", () => {
  assert.equal(agenticToolMetric("read"), "read");
  assert.equal(agenticToolMetric("READ"), "read");
  assert.equal(agenticToolMetric("write"), "write");
  assert.equal(agenticToolMetric("edit"), "write");
  assert.equal(agenticToolMetric("edit-diff"), "write");
  assert.equal(agenticToolMetric("bash"), "bash");
});

test("agentic tool categories collapse every other tool into tools", () => {
  assert.equal(agenticToolMetric("ask_user"), "tools");
  assert.equal(agenticToolMetric("web_explore"), "tools");
  assert.equal(agenticToolMetric("custom-extension-tool"), "tools");
});
