import assert from "node:assert/strict";
import test from "node:test";
import {
  isModelConfigError,
  ModelConfigFallback,
} from "../src/bridge/pi-config-errors.ts";

test("pi startup configuration errors are recognized", () => {
  assert.equal(
    isModelConfigError(
      'Error: Unknown provider "ds4-magius". Use --list-models to see available providers/models.',
    ),
    true,
  );
  assert.equal(
    isModelConfigError(
      'Error: Unknown model "qwen3.8-flash-next". Use --list-models to see available providers/models.',
    ),
    true,
  );
  assert.equal(
    isModelConfigError("Use --list-models to see available providers/models."),
    true,
  );
});

test("runtime failures are not mistaken for model configuration errors", () => {
  assert.equal(isModelConfigError(""), false);
  assert.equal(isModelConfigError("spawn pi ENOENT"), false);
  assert.equal(isModelConfigError("Error: 503 Service Unavailable"), false);
  assert.equal(isModelConfigError("pi is unresponsive: no output in 45s"), false);
});

test("the model fallback is allowed once per launch cycle", () => {
  const fallback = new ModelConfigFallback();
  assert.equal(fallback.used, false);
  assert.equal(fallback.use(), true);
  assert.equal(fallback.use(), false);
  assert.equal(fallback.used, true);
  // a successful boot resets the allowance for the next failure
  fallback.reset();
  assert.equal(fallback.used, false);
  assert.equal(fallback.use(), true);
});
