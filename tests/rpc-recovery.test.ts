import assert from "node:assert/strict";
import test from "node:test";
import { shouldRestartPiForNewSession } from "../src/bridge/rpc-recovery.ts";

test("New session restarts a stopped pi RPC process", () => {
  assert.equal(shouldRestartPiForNewSession("new_session", false), true);
});

test("New session reuses a running pi RPC process", () => {
  assert.equal(shouldRestartPiForNewSession("new_session", true), false);
});

test("Other RPC commands never trigger dead-process recovery", () => {
  assert.equal(shouldRestartPiForNewSession("switch_session", false), false);
  assert.equal(shouldRestartPiForNewSession(undefined, false), false);
});
