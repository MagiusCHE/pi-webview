import assert from "node:assert/strict";
import test from "node:test";
import {
  agenticHeaderLabelKey,
  agenticMetricVisualState,
  agenticToolMetric,
  emptyAgenticCounts,
  emptyAgenticMetricProgress,
  transitionAgenticMetricProgress,
  WAITING_RESPONSE_DELAY_MS,
  waitingResponseDelayRemaining,
  waitingResponseRestartAt,
  visibleThinkingContent,
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

test("agentic metric stays yellow while one item runs, then turns green", () => {
  let progress = emptyAgenticMetricProgress();
  progress = transitionAgenticMetricProgress(progress, null, "running");
  progress = transitionAgenticMetricProgress(progress, null, "running");
  assert.deepEqual(progress, { count: 2, running: 2, errors: 0 });
  assert.equal(agenticMetricVisualState(progress), "running");

  progress = transitionAgenticMetricProgress(progress, "running", "success");
  assert.deepEqual(progress, { count: 2, running: 1, errors: 0 });
  assert.equal(agenticMetricVisualState(progress), "running");

  progress = transitionAgenticMetricProgress(progress, "running", "success");
  assert.deepEqual(progress, { count: 2, running: 0, errors: 0 });
  assert.equal(agenticMetricVisualState(progress), "complete");
});

test("agentic metric keeps a red error marker independently from completion", () => {
  let progress = emptyAgenticMetricProgress();
  progress = transitionAgenticMetricProgress(progress, null, "running");
  progress = transitionAgenticMetricProgress(progress, null, "running");
  progress = transitionAgenticMetricProgress(progress, "running", "error");
  assert.deepEqual(progress, { count: 2, running: 1, errors: 1 });
  assert.equal(agenticMetricVisualState(progress), "running");

  progress = transitionAgenticMetricProgress(progress, "running", "success");
  assert.deepEqual(progress, { count: 2, running: 0, errors: 1 });
  assert.equal(agenticMetricVisualState(progress), "complete");

  progress = transitionAgenticMetricProgress(progress, "error", null);
  assert.deepEqual(progress, { count: 1, running: 0, errors: 0 });
});

test("agentic metric ignores repeated lifecycle states", () => {
  const progress = { count: 1, running: 1, errors: 0 };
  assert.deepEqual(
    transitionAgenticMetricProgress(progress, "running", "running"),
    progress,
  );
});

test("agentic live shell exposes waiting before real internal activity", () => {
  assert.equal(agenticHeaderLabelKey(true), "waitingResponse");
  assert.equal(agenticHeaderLabelKey(false), "agenticThinking");
});

test("waiting starts one second after agent_start without adding turn latency", () => {
  assert.equal(WAITING_RESPONSE_DELAY_MS, 1000);
  assert.equal(waitingResponseDelayRemaining(100, 600), 500);
  assert.equal(waitingResponseDelayRemaining(100, 1200), 0);
});

test("an accepted user message restarts the provider waiting clock", () => {
  const restartedAt = waitingResponseRestartAt(true, 600);
  assert.equal(restartedAt, 600);
  assert.equal(waitingResponseDelayRemaining(restartedAt!, 1100), 500);
  assert.equal(waitingResponseRestartAt(false, 600), null);
});

test("empty persisted thinking blocks stay invisible when history is rebuilt", () => {
  assert.equal(visibleThinkingContent(""), null);
  assert.equal(visibleThinkingContent("  \n\t"), null);
  assert.equal(visibleThinkingContent(undefined), null);
  assert.equal(visibleThinkingContent("  actual thought  "), "actual thought");
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
