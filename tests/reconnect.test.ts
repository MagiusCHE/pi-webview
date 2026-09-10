import { test } from "node:test";
import assert from "node:assert/strict";
import { ReconnectLoop, RECONNECT_INTERVAL_MS } from "../src/web/reconnect.ts";

interface Scheduled {
  fn: () => void;
  ms: number;
  cancelled: boolean;
  fired: boolean;
}

/** manual clock: the test decides when a pending timer fires */
function makeHarness(
  options: {
    attempt?: () => Promise<void>;
    active?: boolean;
  } = {},
) {
  const scheduled: Scheduled[] = [];
  const states: boolean[] = [];
  let attempts = 0;
  let active = options.active ?? true;
  const loop = new ReconnectLoop({
    intervalMs: RECONNECT_INTERVAL_MS,
    isActive: () => active,
    attempt:
      options.attempt ??
      (async () => {
        attempts++;
      }),
    onStateChange: (value) => states.push(value),
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms, cancelled: false, fired: false });
      return scheduled.length - 1;
    },
    cancel: (handle) => {
      const entry = scheduled[handle as number];
      if (entry) entry.cancelled = true;
    },
  });
  /** timers waiting to fire (a fired or cancelled one is not pending) */
  const pending = () => scheduled.filter((s) => !s.cancelled && !s.fired);
  return {
    loop,
    scheduled,
    states,
    attempts: () => attempts,
    pending,
    /** fire the oldest pending timer (like the browser clock) */
    fire: () => {
      const entry = pending()[0];
      assert.ok(entry, "nessun timer pendente da eseguire");
      entry.fired = true;
      entry.fn();
    },
    setActive: (value: boolean) => {
      active = value;
    },
  };
}

/** flush the microtask queue of the async tick */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("reconnect: il primo tentativo è pianificato a 5 secondi", () => {
  const h = makeHarness();
  h.loop.start();
  assert.equal(h.loop.isReconnecting(), true);
  assert.deepEqual(h.states, [true]);
  assert.equal(h.pending().length, 1);
  assert.equal(h.pending()[0]?.ms, RECONNECT_INTERVAL_MS);
  // idempotent: a second start does not add a timer
  h.loop.start();
  assert.equal(h.pending().length, 1);
});

test("reconnect: la finestra attiva tenta e riprogramma", async () => {
  const h = makeHarness();
  h.loop.start();
  h.fire();
  await flush();
  assert.equal(h.attempts(), 1);
  // the loop keeps retrying every interval until stop()
  assert.equal(h.pending().length, 1);
  assert.equal(h.pending()[0]?.ms, RECONNECT_INTERVAL_MS);
});

test("reconnect: la finestra non attiva non contatta il bridge", async () => {
  const h = makeHarness({ active: false });
  h.loop.start();
  h.fire();
  await flush();
  assert.equal(h.attempts(), 0);
  // it keeps waiting: the next attempt is tried when the window is active
  assert.equal(h.pending().length, 1);
  h.setActive(true);
  h.fire();
  await flush();
  assert.equal(h.attempts(), 1);
});

test("reconnect: tornare attivi tenta subito senza aspettare l'intervallo", async () => {
  const h = makeHarness({ active: false });
  h.loop.start();
  h.loop.retryNow();
  await flush();
  assert.equal(h.attempts(), 0); // still hidden: nothing to do
  h.setActive(true);
  h.loop.retryNow();
  await flush();
  assert.equal(h.attempts(), 1);
  // the pending timer was replaced (not doubled)
  assert.equal(h.pending().length, 1);
});

test("reconnect: stop ferma il ciclo (connessione tornata)", async () => {
  const h = makeHarness();
  h.loop.start();
  h.loop.stop();
  assert.equal(h.loop.isReconnecting(), false);
  assert.deepEqual(h.states, [true, false]);
  assert.equal(h.pending().length, 0);
  // a cancelled timer that fires anyway must not attempt anything
  h.scheduled[0]?.fn();
  await flush();
  assert.equal(h.attempts(), 0);
  // and retryNow is inert while stopped
  h.loop.retryNow();
  await flush();
  assert.equal(h.attempts(), 0);
});

test("reconnect: un tentativo fallito non uccide il ciclo", async () => {
  let calls = 0;
  const h = makeHarness({
    attempt: async () => {
      calls++;
      if (calls === 1) throw new Error("ECONNREFUSED");
    },
  });
  h.loop.start();
  h.fire();
  await flush();
  assert.equal(calls, 1);
  assert.equal(h.loop.isReconnecting(), true);
  assert.equal(h.pending().length, 1);
  h.fire();
  await flush();
  assert.equal(calls, 2);
});

test("reconnect: due tentativi non si sovrappongono", async () => {
  let release: () => void = () => {};
  let calls = 0;
  const h = makeHarness({
    attempt: () =>
      new Promise<void>((resolve) => {
        calls++;
        release = resolve;
      }),
  });
  h.loop.start();
  h.fire();
  await flush();
  assert.equal(calls, 1);
  // a second tick arrives while the first attempt is in flight
  h.loop.retryNow();
  await flush();
  assert.equal(calls, 1);
  release();
  await flush();
  // once settled, the loop is armed again
  assert.equal(h.pending().length, 1);
});
