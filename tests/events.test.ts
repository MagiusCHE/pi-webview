import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStream, handleRpcEvent } from "../src/ide/events.ts";

test("i delta di testo si accumulano e message_end finalizza", () => {
  const s = emptyStream();
  const start = handleRpcEvent(s, { type: "message_start", message: {} });
  assert.equal(start.kind, "stream_start");

  const d1 = handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Ciao " },
  });
  const d2 = handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "mondo" },
  });
  assert.deepEqual([d1.kind, d2.kind], ["text_delta", "text_delta"]);

  const end = handleRpcEvent(s, { type: "message_end", message: {} });
  assert.equal(end.kind, "message_end");
  if (end.kind === "message_end") {
    assert.equal(end.message.text, "Ciao mondo");
    assert.equal(end.message.thinking, "");
    assert.deepEqual(end.message.toolCalls, []);
  }
});

test("thinking e toolcall delta vengono bufferizzati per contentIndex", () => {
  const s = emptyStream();
  handleRpcEvent(s, { type: "message_start", message: {} });
  handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "ragiono" },
  });
  handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '{"cmd":' },
  });
  handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '"ls"}' },
  });
  const tcEnd = handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { id: "call_1", name: "bash", arguments: { cmd: "ls" } },
    },
  });
  assert.equal(tcEnd.kind, "tool_call");

  const end = handleRpcEvent(s, { type: "message_end", message: {} });
  if (end.kind === "message_end") {
    assert.equal(end.message.thinking, "ragiono");
    assert.equal(end.message.toolCalls.length, 1);
    assert.equal(end.message.toolCalls[0]?.name, "bash");
  }
});

test("eventi di stato non producono più status line (loader nel pensiero)", () => {
  const s = emptyStream();
  assert.equal(handleRpcEvent(s, { type: "agent_start" }).kind, "none");
  assert.equal(handleRpcEvent(s, { type: "agent_settled" }).kind, "none");
  assert.equal(
    handleRpcEvent(s, { type: "queue_update", steering: [], followUp: [] }).kind,
    "none",
  );
  assert.equal(
    handleRpcEvent(s, { type: "tool_execution_start", toolName: "bash" }).kind,
    "none",
  );
});

test("thinking_end produce un'azione dedicata (per togliere il loader)", () => {
  const s = emptyStream();
  handleRpcEvent(s, { type: "message_start", message: {} });
  const end = handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end", contentIndex: 0 },
  });
  assert.deepEqual(end, { kind: "thinking_end", index: 0 });
});

test("message_end senza streaming attivo è ignorato", () => {
  const s = emptyStream();
  const a = handleRpcEvent(s, { type: "message_end", message: {} });
  assert.equal(a.kind, "none");
});

test("i messaggi toolResult non aprono uno stream assistant vuoto", () => {
  const s = emptyStream();
  const start = handleRpcEvent(s, {
    type: "message_start",
    message: { role: "toolResult", content: [{ type: "text", text: "ok" }] },
  });
  const end = handleRpcEvent(s, {
    type: "message_end",
    message: { role: "toolResult", content: [{ type: "text", text: "ok" }] },
  });
  assert.equal(start.kind, "none");
  assert.equal(end.kind, "none");
  assert.equal(s.active, false);
});

test("un messaggio locale non azzera uno stream assistant attivo", () => {
  const s = emptyStream();
  handleRpcEvent(s, { type: "message_start", message: { role: "assistant" } });
  handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "testo" },
  });
  handleRpcEvent(s, { type: "message_start", message: { role: "custom" } });
  const end = handleRpcEvent(s, {
    type: "message_end",
    message: { role: "assistant" },
  });
  assert.equal(end.kind, "message_end");
  if (end.kind === "message_end") assert.equal(end.message.text, "testo");
});

test("nuovo message_start azzera lo stato precedente", () => {
  const s = emptyStream();
  handleRpcEvent(s, { type: "message_start", message: {} });
  handleRpcEvent(s, {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "primo" },
  });
  handleRpcEvent(s, { type: "message_start", message: {} });
  const end = handleRpcEvent(s, { type: "message_end", message: {} });
  if (end.kind === "message_end") assert.equal(end.message.text, "");
});
