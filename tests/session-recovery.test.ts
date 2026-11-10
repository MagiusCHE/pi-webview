import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionRecovery,
  SESSION_RECOVERY_INTERVAL_MS,
} from "../src/web/session-recovery.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(attempt: (current: () => boolean) => Promise<boolean>) {
  let active = true;
  const timers: Array<{ run: () => void; delay: number; canceled: boolean }> = [];
  const recovery = new SessionRecovery({
    attempt,
    isActive: () => active,
    schedule(run, delay) {
      const timer = { run, delay, canceled: false };
      timers.push(timer);
      return timer;
    },
    cancel(timer) {
      (timer as (typeof timers)[number]).canceled = true;
    },
  });
  const pending = () => timers.filter((timer) => !timer.canceled);
  return {
    recovery,
    pending,
    setActive(value: boolean) {
      active = value;
    },
    fire() {
      const timer = pending()[0];
      assert.ok(timer);
      timer.canceled = true;
      timer.run();
    },
  };
}

test("recovery retries failed readiness after the initial deadline and stops on success", async () => {
  let calls = 0;
  const h = harness(async () => ++calls >= 3);
  h.recovery.start();
  h.recovery.start();
  assert.equal(h.pending().length, 1);
  assert.equal(h.pending()[0]?.delay, SESSION_RECOVERY_INTERVAL_MS);
  for (let i = 0; i < 3; i++) {
    h.fire();
    await flush();
  }
  assert.equal(calls, 3);
  assert.equal(h.pending().length, 0);
});

test("hidden panels do not poll and becoming visible can retry immediately", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return true;
  });
  h.setActive(false);
  h.recovery.start();
  h.fire();
  await flush();
  assert.equal(calls, 0);
  h.setActive(true);
  h.recovery.retryNow();
  await flush();
  assert.equal(calls, 1);
  assert.equal(h.pending().length, 0);
});

test("recovery never overlaps attempts, including manual Retry now", async () => {
  let calls = 0;
  let finish!: (ready: boolean) => void;
  const h = harness(
    () =>
      new Promise((resolve) => {
        calls++;
        finish = resolve;
      }),
  );
  h.recovery.retryNow();
  h.recovery.retryNow();
  h.recovery.start();
  assert.equal(calls, 1);
  finish(false);
  await flush();
  assert.equal(h.pending().length, 1);
});

test("session switches invalidate late replies without letting them stop a newer recovery", async () => {
  let valid!: () => boolean;
  let finish!: (ready: boolean) => void;
  let calls = 0;
  const h = harness(
    (current) =>
      new Promise((resolve) => {
        calls++;
        valid = current;
        finish = resolve;
      }),
  );
  h.recovery.retryNow();
  assert.equal(valid(), true);
  h.recovery.reset();
  assert.equal(valid(), false);
  h.recovery.retryNow();
  assert.equal(calls, 1);
  finish(true);
  await flush();
  assert.equal(h.pending().length, 1);
  h.fire();
  assert.equal(calls, 2);
  finish(true);
  await flush();
  assert.equal(h.pending().length, 0);
});

test("an exception is recoverable, and reset cancels all future work", async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    throw new Error("timeout");
  });
  h.recovery.retryNow();
  await flush();
  assert.equal(h.pending().length, 1);
  h.recovery.reset();
  assert.equal(h.pending().length, 0);
  assert.equal(calls, 1);
});
