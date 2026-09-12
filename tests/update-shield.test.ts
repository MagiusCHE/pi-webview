import assert from "node:assert/strict";
import test from "node:test";
import { updateShieldVisualState } from "../src/web/update-shield.ts";

test("a failed update can restore the enabled yellow retry shield", () => {
  assert.deepEqual(
    updateShieldVisualState({
      checking: false,
      hasUpdate: true,
      restartRequired: false,
    }),
    { disabled: false, tone: "warn", tooltip: "available" },
  );
});

test("a successful update leaves a disabled blue shield without the warn pulse", () => {
  assert.deepEqual(
    updateShieldVisualState({
      checking: false,
      hasUpdate: false,
      restartRequired: true,
    }),
    { disabled: true, tone: "ok", tooltip: "restartRequired" },
  );
});

test("an update in progress remains disabled and yellow", () => {
  assert.deepEqual(
    updateShieldVisualState({
      checking: true,
      hasUpdate: true,
      restartRequired: false,
    }),
    { disabled: true, tone: "warn", tooltip: "checking" },
  );
});
