import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENTIC_COUNT_PULSE_MS,
  AgenticCountPulse,
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
  assert.deepEqual(progress, { count: 2, running: 2, errors: 0, interrupted: 0 });
  assert.equal(agenticMetricVisualState(progress), "running");

  progress = transitionAgenticMetricProgress(progress, "running", "success");
  assert.deepEqual(progress, { count: 2, running: 1, errors: 0, interrupted: 0 });
  assert.equal(agenticMetricVisualState(progress), "running");

  progress = transitionAgenticMetricProgress(progress, "running", "success");
  assert.deepEqual(progress, { count: 2, running: 0, errors: 0, interrupted: 0 });
  assert.equal(agenticMetricVisualState(progress), "complete");
});

test("a normal tool error keeps the completed counter green with a red marker", () => {
  let progress = emptyAgenticMetricProgress();
  progress = transitionAgenticMetricProgress(progress, null, "running");
  progress = transitionAgenticMetricProgress(progress, "running", "error");
  assert.deepEqual(progress, { count: 1, running: 0, errors: 1, interrupted: 0 });
  assert.equal(agenticMetricVisualState(progress), "complete");
});

test("a provider interruption turns the completed counter red", () => {
  let progress = emptyAgenticMetricProgress();
  progress = transitionAgenticMetricProgress(progress, null, "running");
  progress = transitionAgenticMetricProgress(progress, "running", "interrupted");
  assert.deepEqual(progress, { count: 1, running: 0, errors: 1, interrupted: 1 });
  assert.equal(agenticMetricVisualState(progress), "failed");

  progress = transitionAgenticMetricProgress(progress, "interrupted", null);
  assert.deepEqual(progress, { count: 0, running: 0, errors: 0, interrupted: 0 });
});

test("agentic metric ignores repeated lifecycle states", () => {
  const progress = { count: 1, running: 1, errors: 0, interrupted: 0 };
  assert.deepEqual(
    transitionAgenticMetricProgress(progress, "running", "running"),
    progress,
  );
});

interface ScheduledPulseStep {
  fn: () => void;
  delayMs: number;
  cancelled: boolean;
  fired: boolean;
}

function agenticPulseHarness(initialValue = 1) {
  const values: number[] = [];
  const pulsing: boolean[] = [];
  const steps: ScheduledPulseStep[] = [];
  const pending = () => steps.filter((step) => !step.cancelled && !step.fired);
  const pulse = new AgenticCountPulse(initialValue, {
    setValue: (value) => values.push(value),
    setPulsing: (active) => pulsing.push(active),
    schedule: (fn, delayMs) => {
      const step = { fn, delayMs, cancelled: false, fired: false };
      steps.push(step);
      return step;
    },
    cancel: (handle) => {
      (handle as ScheduledPulseStep).cancelled = true;
    },
  });
  const fire = (delayMs: number) => {
    const step = pending().find((candidate) => candidate.delayMs === delayMs);
    assert.ok(step, `missing pending pulse step at ${delayMs}ms`);
    step.fired = true;
    step.fn();
  };
  return { pulse, values, pulsing, steps, pending, fire };
}

test("agentic count pulse swaps the number only at maximum scale", () => {
  const h = agenticPulseHarness(4);
  h.pulse.set(5);
  assert.equal(h.values.at(-1), 4);
  assert.deepEqual(
    h.pending().map((step) => step.delayMs),
    [AGENTIC_COUNT_PULSE_MS / 2, AGENTIC_COUNT_PULSE_MS],
  );

  h.fire(AGENTIC_COUNT_PULSE_MS / 2);
  assert.equal(h.values.at(-1), 5);
  h.fire(AGENTIC_COUNT_PULSE_MS);
  assert.equal(h.pulsing.at(-1), false);
});

test("agentic count pulse cancels and restarts for the newest number", () => {
  const h = agenticPulseHarness(4);
  h.pulse.set(5);
  const firstSteps = [...h.steps];
  h.pulse.set(6);

  assert.equal(
    firstSteps.every((step) => step.cancelled),
    true,
  );
  assert.equal(h.values.at(-1), 4);
  assert.equal(h.pending().length, 2);
  h.fire(AGENTIC_COUNT_PULSE_MS / 2);
  assert.equal(h.values.at(-1), 6);
});

test("agentic count updates immediately when animation is disabled", () => {
  const h = agenticPulseHarness(4);
  h.pulse.set(5, false);
  assert.equal(h.values.at(-1), 5);
  assert.equal(h.pending().length, 0);
  assert.equal(h.pulsing.at(-1), false);
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
