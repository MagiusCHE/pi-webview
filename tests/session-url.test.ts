import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bridgeUrlWithPageIntent,
  pageUrlForSession,
  sessionIdFromPageSearch,
} from "../src/web/session-url.ts";

test("browser session URL exposes only the session id and preserves unrelated params", () => {
  const result = new URL(
    pageUrlForSession(
      "http://127.0.0.1:7361/?new=1&theme=dark#thread",
      "8fe2f268-226f-47fd-a5b2-d29da0c33963",
    ),
  );
  assert.equal(result.searchParams.get("s"), "8fe2f268-226f-47fd-a5b2-d29da0c33963");
  assert.equal(result.searchParams.get("new"), null);
  assert.equal(result.searchParams.get("session"), null);
  assert.equal(result.searchParams.get("theme"), "dark");
  assert.equal(result.hash, "#thread");
});

test("page session id becomes an internal websocket id intent", () => {
  const result = new URL(
    bridgeUrlWithPageIntent(
      "ws://127.0.0.1:7361/?token=secret",
      "?s=8fe2f268-226f-47fd-a5b2-d29da0c33963",
    ),
  );
  assert.equal(result.searchParams.get("token"), "secret");
  assert.equal(
    result.searchParams.get("sessionId"),
    "8fe2f268-226f-47fd-a5b2-d29da0c33963",
  );
  assert.equal(result.searchParams.get("session"), null);
  assert.equal(result.searchParams.get("new"), null);
  assert.equal(
    sessionIdFromPageSearch("?s=8fe2f268-226f-47fd-a5b2-d29da0c33963"),
    "8fe2f268-226f-47fd-a5b2-d29da0c33963",
  );
});

test("legacy page paths still become internal websocket path intents", () => {
  const result = new URL(
    bridgeUrlWithPageIntent(
      "ws://127.0.0.1:7361/?token=secret",
      "?session=%2Fhome%2Fuser%2Fsession.jsonl",
    ),
  );
  assert.equal(result.searchParams.get("session"), "/home/user/session.jsonl");
  assert.equal(result.searchParams.get("sessionId"), null);
});

test("new browser tabs retain their opaque launch context", () => {
  const result = new URL(
    bridgeUrlWithPageIntent(
      "ws://127.0.0.1:7361/?token=secret",
      "?new=1&launch=opaque-launch-id",
    ),
  );
  assert.equal(result.searchParams.get("new"), "1");
  assert.equal(result.searchParams.get("launchId"), "opaque-launch-id");
  assert.equal(result.searchParams.get("session"), null);
  assert.equal(result.searchParams.get("sessionId"), null);
});
