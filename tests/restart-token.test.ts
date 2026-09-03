import assert from "node:assert/strict";
import test from "node:test";
import {
  RESTART_TOKEN_ENV,
  restartTokenFromEnvironment,
} from "../src/bridge/restart-token.ts";

test("artifact restart may reuse an existing generated bridge token", () => {
  const token = "0123456789abcdef".repeat(2);
  const uppercaseToken = "ABCDEF0123456789".repeat(2);
  assert.equal(restartTokenFromEnvironment(token), token);
  assert.equal(restartTokenFromEnvironment(uppercaseToken), uppercaseToken);
});

test("normal starts keep token generation independent", () => {
  assert.equal(restartTokenFromEnvironment(undefined), undefined);
});

test("an invalid internal restart token fails instead of silently rotating", () => {
  for (const value of ["", "short", "g".repeat(32), "a".repeat(31), "a".repeat(33)]) {
    assert.throws(
      () => restartTokenFromEnvironment(value),
      new RegExp(RESTART_TOKEN_ENV),
    );
  }
});
