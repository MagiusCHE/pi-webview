import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canFinishSessionLoading,
  isUnanswerableStartupRequest,
} from "../src/web/session-loading.ts";

test("interactive startup keeps normal session interaction locked until history is ready", () => {
  assert.equal(canFinishSessionLoading(false, false, false, false), false);
  assert.equal(canFinishSessionLoading(true, false, true, false), false);
  assert.equal(canFinishSessionLoading(true, false, false, true), false);
  assert.equal(canFinishSessionLoading(true, true, false, false), false);
  assert.equal(canFinishSessionLoading(true, false, false, false), true);
});

test("only interactive requests before the first RPC reply need terminal intervention", () => {
  for (const method of ["select", "confirm", "input", "editor"]) {
    assert.equal(isUnanswerableStartupRequest(false, method), true);
    assert.equal(isUnanswerableStartupRequest(true, method), false);
  }
  for (const method of ["notify", "setStatus", undefined]) {
    assert.equal(isUnanswerableStartupRequest(false, method), false);
  }
});

test("startup UI questions expose the chat without unlocking the session", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  for (const method of ["select", "confirm", "input", "editor"]) {
    assert.match(
      web,
      new RegExp(`case "${method}": \\{\\s*revealInteractiveDuringLoading\\(id\\)`),
    );
  }
  assert.match(
    web,
    /function revealInteractiveDuringLoading\([\s\S]*?hideBootLoader\(\)/,
  );
  assert.match(
    web,
    /function revealInteractiveDuringLoading\([\s\S]*?loadingInteractivePending = true/,
  );
  assert.match(
    web,
    /function answerStartupInteraction\([\s\S]*?loadingInteractiveRequestId !== id/,
  );
  assert.match(
    web,
    /function loadingMaxTick\([\s\S]*?if \(loadingInteractivePending \|\| startupRpcBlocked\) return/,
  );
  assert.match(
    web,
    /function answerStartupInteraction\([\s\S]*?SESSION_HISTORY_TIMEOUT_MS \+ LOADING_MAX_MS/,
  );
  assert.match(web, /function updateSendButton\([\s\S]*?\|\| sessionLoading/);
  assert.match(
    web,
    /function beginSessionLoading\([\s\S]*?els\.bootLoader\.hidden = awaitingInteractive \|\| blockedAtStart/,
  );
});

test("blocked startup questions show terminal instructions, remain inert, and keep normal RPC dialogs working", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  const it = JSON.parse(readFileSync("src/web/locale/it.json", "utf8")).ui;
  const en = JSON.parse(readFileSync("src/web/locale/en.json", "utf8")).ui;
  for (const locale of [it, en]) {
    for (const key of [
      "startupRpcQuestionTitle",
      "startupRpcQuestionUnavailable",
      "startupRpcQuestionInstructions",
      "startupRpcQuestionOptions",
    ])
      assert.ok(locale[key]);
  }
  assert.match(
    web,
    /if \(isUnanswerableStartupRequest\(rpcInputReady, method\)\) \{\s*showBlockedStartupQuestion\(evt\);\s*return/,
  );
  assert.match(
    web,
    /function showBlockedStartupQuestion\([\s\S]*?startupRpcBlocked = true;[\s\S]*?hideBootLoader\(\);\s*updateSendButton\(\)/,
  );
  assert.match(
    web,
    /function showBlockedStartupQuestion\([\s\S]*?heading\.textContent = t\("startupRpcQuestionTitle"\)/,
  );
  assert.match(
    web,
    /function showBlockedStartupQuestion\([\s\S]*?instructions\.textContent = t\("startupRpcQuestionInstructions"\)/,
  );
  const notice =
    /function showBlockedStartupQuestion\([\s\S]*?\n}\n\n\/\/ Extension UI requests are answerable/.exec(
      web,
    )?.[0];
  assert.ok(notice);
  assert.doesNotMatch(notice, /extension_ui_response|inlineConfirm|inlineSelect/);
  assert.match(notice, /startupRpcQuestionIds\.has\(id\)/);
  assert.match(notice, /evt\.options/);
  assert.match(web, /function loadingMaxTick\([\s\S]*?startupRpcBlocked\) return/);
  assert.match(
    web,
    /for \(let attempt = 0; attempt < 6; attempt\+\+\) \{\s*if \(startupRpcBlocked\) return false/,
  );
  assert.match(web, /if \(state\.success\) \{\s*rpcInputReady = true/);
  assert.match(web, /els\.newChat\.disabled = interactionLocked/);
  assert.match(
    web,
    /if \(payload\.type === "response" && !piRestarting\) rpcInputReady = true/,
  );
  assert.match(
    web,
    /const blockedAtStart = startupRpcBlocked;[\s\S]*?els\.bootLoader\.hidden = awaitingInteractive \|\| blockedAtStart/,
  );
});

test("history rebuild retains unanswered dialogs and retries a timed-out startup RPC", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  assert.match(
    web,
    /function renderHistory\([\s\S]*?const pendingDialog = inlineDialog\?\.el/,
  );
  assert.match(
    web,
    /if \(pendingDialog && inlineDialog\?\.el === pendingDialog\) \{\s*els\.thread\.appendChild\(pendingDialog\)/,
  );
  assert.match(
    web,
    /function scheduleInteractiveHistoryRetry\([\s\S]*?void refreshSessions\(true\)\.finally/,
  );
  assert.match(
    web,
    /interactiveHistoryRetryInFlight = true;[\s\S]*?interactiveHistoryRetryInFlight = false/,
  );
  assert.match(
    web,
    /if \(!loaded && loadingHadInteractiveRequest\) scheduleInteractiveHistoryRetry\(\)/,
  );
  assert.match(web, /answerStartupInteraction\(id\)/);
  assert.match(
    web,
    /if \(loadingInteractivePending && inlineDialog\?\.el\) \{\s*els\.thread\.appendChild\(inlineDialog\.el\)/,
  );
});
