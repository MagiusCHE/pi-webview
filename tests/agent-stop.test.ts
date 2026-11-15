import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STOP_ENTRY_DATA,
  AGENT_STOP_ENTRY_TYPE,
  compactHistoryResponse,
  isAbortedAssistantMessage,
  isAgentStopEntry,
  isAgentStopMessage,
  stoppedHistoryMessages,
  withAgentStopEntries,
} from "../src/ide/agent-stop.ts";
import { registerAgentStopPersistence } from "../packages/pi-webview/lib/agent-stop.ts";

function message(
  id: string,
  parentId: string | null,
  role: string,
  timestamp: number,
  extra = {},
) {
  return {
    id,
    parentId,
    type: "message",
    timestamp: new Date(timestamp).toISOString(),
    message: { role, timestamp, content: [], ...extra },
  };
}

function stop(id: string, parentId: string | null, timestamp = 4000) {
  return {
    id,
    parentId,
    type: "custom",
    timestamp: new Date(timestamp).toISOString(),
    customType: AGENT_STOP_ENTRY_TYPE,
    data: AGENT_STOP_ENTRY_DATA,
  };
}

const user = message("user", null, "user", 1000);
const assistant = message("assistant", user.id, "assistant", 2000);
const tool = message("tool", assistant.id, "toolResult", 3000, { toolCallId: "call" });
const stopped = stop("stopped", tool.id);
const original = [user.message, assistant.message, tool.message];

function snapshot(entries: unknown[], leafId: string | null) {
  return { entries, leafId };
}

function stopMessage(timestamp = 4000) {
  return { role: "agentStop", timestamp };
}

test("aborted assistant snapshots are distinct from provider errors and tool failures", () => {
  assert.equal(
    isAbortedAssistantMessage({ role: "assistant", stopReason: "aborted" }),
    true,
  );
  for (const value of [
    null,
    {},
    { role: "assistant", stopReason: "error" },
    { role: "toolResult", stopReason: "aborted", isError: true },
  ]) {
    assert.equal(isAbortedAssistantMessage(value), false);
  }
});

test("stop metadata is recognized only by its entry type and schema version", () => {
  assert.equal(isAgentStopEntry(stopped), true);
  for (const value of [
    null,
    {},
    { ...stopped, type: "custom_message" },
    { ...stopped, customType: "other" },
    { ...stopped, data: { version: 2 } },
  ]) {
    assert.equal(isAgentStopEntry(value), false);
  }
  assert.equal(isAgentStopMessage(stopMessage()), true);
  assert.equal(isAgentStopMessage(tool.message), false);
});

test("the extension persists an aborted settlement without sending a model-context message", () => {
  const handlers = new Map<
    string,
    (event: unknown, ctx: unknown) => void | Promise<void>
  >();
  const appended: Array<{ customType: string; data: unknown }> = [];
  registerAgentStopPersistence({
    on: (name, handler) => {
      handlers.set(name, handler);
    },
    appendEntry: (customType, data) => {
      appended.push({ customType, data });
    },
  });
  const settled = handlers.get("agent_settled");
  assert.ok(settled);
  for (const event of [null, {}, { aborted: false }, { aborted: "true" }])
    settled(event, {});
  assert.deepEqual(appended, []);
  settled({ type: "agent_settled", aborted: true }, {});
  assert.deepEqual(appended, [
    { customType: AGENT_STOP_ENTRY_TYPE, data: AGENT_STOP_ENTRY_DATA },
  ]);
});

test("a stop during tool execution is merged after the final tool without an aborted assistant", () => {
  const result = withAgentStopEntries(
    original,
    snapshot([user, assistant, tool, stopped], stopped.id),
  );
  assert.deepEqual(result, [...original, stopMessage()]);
  assert.equal(result[0], original[0]);
  assert.equal(original.length, 3, "the authoritative model history is not mutated");
});

test("stops stay between runs rather than moving to the end of the conversation", () => {
  const next = message("next", stopped.id, "user", 5000);
  assert.deepEqual(
    withAgentStopEntries(
      [...original, next.message],
      snapshot([user, assistant, tool, stopped, next], next.id),
    ),
    [...original, stopMessage(), next.message],
  );
});

test("parallel tool results with identical timestamps use their tool call IDs as anchors", () => {
  const other = message("other", tool.id, "toolResult", 3000, {
    toolCallId: "other-call",
  });
  const end = stop("end", other.id);
  const messages = [...original, other.message];
  assert.deepEqual(
    withAgentStopEntries(messages, snapshot([user, assistant, tool, other, end], end.id)),
    [...messages, stopMessage()],
  );
});

test("stop entries from a different session branch are ignored", () => {
  const next = message("next", tool.id, "user", 5000);
  const entries = [user, assistant, tool, stopped, next];
  const messages = [...original, next.message];
  assert.equal(withAgentStopEntries(messages, snapshot(entries, next.id)), messages);
  assert.deepEqual(withAgentStopEntries(original, snapshot(entries, stopped.id)), [
    ...original,
    stopMessage(),
  ]);
});

test("missing entries and an empty active branch leave message history unchanged", () => {
  for (const data of [
    undefined,
    {},
    { entries: [] },
    snapshot([user, assistant, tool, stopped], null),
    snapshot([stopped], "missing"),
  ]) {
    assert.equal(withAgentStopEntries(original, data), original);
  }
});

test("compaction does not resurrect a stop from the summarized prefix", () => {
  const compact = {
    id: "compact",
    parentId: stopped.id,
    type: "compaction",
    firstKeptEntryId: null,
    timestamp: new Date(5000).toISOString(),
  };
  const summary = { role: "compactionSummary", timestamp: 5000, summary: "Earlier work" };
  const next = message("next", compact.id, "user", 6000);
  const messages = [summary, next.message];
  assert.equal(
    withAgentStopEntries(
      messages,
      snapshot([user, assistant, tool, stopped, compact, next], next.id),
    ),
    messages,
  );
});

test("compaction retains stops inside its kept range in the correct message order", () => {
  const compact = {
    id: "compact",
    parentId: stopped.id,
    type: "compaction",
    firstKeptEntryId: assistant.id,
    timestamp: new Date(5000).toISOString(),
  };
  const summary = { role: "compactionSummary", timestamp: 5000, summary: "Earlier work" };
  const next = message("next", compact.id, "user", 6000);
  const messages = [summary, assistant.message, tool.message, next.message];
  assert.deepEqual(
    withAgentStopEntries(
      messages,
      snapshot([user, assistant, tool, stopped, compact, next], next.id),
    ),
    [summary, assistant.message, tool.message, stopMessage(), next.message],
  );
});

test("a stop immediately after compaction follows both the summary and the kept messages", () => {
  const compact = {
    id: "compact",
    parentId: tool.id,
    type: "compaction",
    firstKeptEntryId: assistant.id,
    timestamp: new Date(4000).toISOString(),
  };
  const end = stop("end", compact.id, 5000);
  const summary = { role: "compactionSummary", timestamp: 4000, summary: "Earlier work" };
  const messages = [summary, assistant.message, tool.message];
  assert.deepEqual(
    withAgentStopEntries(
      messages,
      snapshot([user, assistant, tool, compact, end], end.id),
    ),
    [...messages, stopMessage(5000)],
  );
});

test("context-edited message content remains authoritative while stop metadata is inserted", () => {
  const edited = { ...tool.message, content: [{ type: "text", text: "edited context" }] };
  const messages = [user.message, assistant.message, edited];
  assert.deepEqual(
    withAgentStopEntries(
      messages,
      snapshot([user, assistant, tool, stopped], stopped.id),
    ),
    [...messages, stopMessage()],
  );
});

test("a metadata-only stopped run can still render its interruption event", () => {
  const end = stop("end", null);
  assert.deepEqual(withAgentStopEntries([], snapshot([end], end.id)), [stopMessage()]);
});

test("identical assistant timestamps keep stop insertion at the correct occurrence", () => {
  const end = stop("end", assistant.id);
  const next = message("next", end.id, "assistant", 2000);
  const messages = [user.message, assistant.message, next.message];
  assert.deepEqual(
    withAgentStopEntries(messages, snapshot([user, assistant, end, next], next.id)),
    [user.message, assistant.message, stopMessage(), next.message],
  );
});

test("history preclassifies interrupted activity across injected custom-message boundaries", () => {
  const priorUser = { role: "user", content: "A previous run" };
  const priorTool = { role: "toolResult", content: [] };
  const currentUser = { role: "user", content: "Current run" };
  const currentTool = { role: "toolResult", content: [] };
  const injected = { role: "custom", content: "Message from another session" };
  const aborted = { role: "assistant", stopReason: "aborted", content: [] };
  const nextUser = { role: "user", content: "The next run" };
  const marker = stopMessage();
  const stopped = stoppedHistoryMessages([
    priorUser,
    priorTool,
    currentUser,
    currentTool,
    injected,
    aborted,
    marker,
    nextUser,
  ]);
  assert.equal(stopped.has(priorUser), false);
  assert.equal(stopped.has(priorTool), false);
  assert.equal(stopped.has(nextUser), false);
  for (const value of [currentUser, currentTool, injected, aborted, marker]) {
    assert.equal(stopped.has(value), true);
  }
  assert.equal(stoppedHistoryMessages([priorUser, priorTool]).size, 0);
});

test("history transport keeps only identities and stop metadata, without mutating Pi data", () => {
  const large = "not needed to place a stop marker".repeat(65_536);
  const heavyTool = {
    ...tool,
    message: { ...tool.message, content: [{ type: "image", data: large }] },
    details: large,
  };
  const entries = [user, assistant, heavyTool, stopped];
  const event = {
    type: "response",
    command: "get_entries",
    id: "history-1",
    success: true,
    data: snapshot(entries, stopped.id),
  };
  const compact = compactHistoryResponse(event);
  assert.notEqual(compact, event);
  assert.equal(compact.id, event.id);
  assert.equal(compact.success, true);
  const wire = JSON.stringify(compact);
  assert.ok(wire.length < 2000, `compacted metadata is ${wire.length} characters`);
  assert.doesNotMatch(wire, /content|details|not needed/);
  assert.deepEqual(withAgentStopEntries(original, JSON.parse(wire).data), [
    ...original,
    stopMessage(),
  ]);
  assert.equal(event.data.entries[2], heavyTool);
  assert.equal(heavyTool.message.content[0]?.data, large);
});

test("compacted history preserves branches, compaction ranges, custom anchors and duplicate times", () => {
  const other = message("other", tool.id, "toolResult", 3000, {
    toolCallId: "other-call",
  });
  const end = stop("end", other.id);
  const next = message("next", end.id, "assistant", 2000);
  const compact = {
    id: "compact",
    parentId: stopped.id,
    type: "compaction",
    firstKeptEntryId: assistant.id,
    timestamp: new Date(5000).toISOString(),
    systemMessage: { role: "custom", timestamp: 5000, customType: "compact-info" },
    summary: "The summary is already in get_messages",
  };
  const custom = {
    id: "custom",
    parentId: compact.id,
    type: "custom_message",
    timestamp: new Date(6000).toISOString(),
    customType: "injected",
    content: "A message from another session",
  };
  const customMessage = { role: "custom", timestamp: 6000, customType: "injected" };
  const cases = [
    {
      messages: [...original, other.message, next.message],
      entries: [user, assistant, tool, other, end, next],
      leaf: next.id,
    },
    {
      messages: original,
      entries: [user, assistant, tool, stopped, other],
      leaf: tool.id,
    },
    {
      messages: [...original, compact.systemMessage, customMessage],
      entries: [
        user,
        assistant,
        tool,
        stopped,
        compact,
        custom,
        stop("after", custom.id, 7000),
      ],
      leaf: "after",
    },
    { messages: [], entries: [stop("alone", null)], leaf: "alone" },
  ];
  for (const item of cases) {
    const raw = snapshot(item.entries, item.leaf);
    const projected = compactHistoryResponse({
      type: "response",
      command: "get_entries",
      success: true,
      data: raw,
    });
    assert.deepEqual(
      withAgentStopEntries(item.messages, JSON.parse(JSON.stringify(projected)).data),
      withAgentStopEntries(item.messages, raw),
    );
  }
});

test("ordinary messages, failed reads and unrelated RPC responses are never projected", () => {
  for (const event of [
    { type: "message_end", message: assistant.message },
    {
      type: "response",
      command: "get_messages",
      success: true,
      data: { messages: original },
    },
    { type: "response", command: "get_entries", success: false, error: "unavailable" },
    { type: "response", command: "get_entries", success: true, data: null },
  ]) {
    assert.equal(compactHistoryResponse(event), event);
  }
});

test("malformed cyclic session entries cannot hang history loading", () => {
  const end = { ...stopped, parentId: stopped.id };
  assert.deepEqual(withAgentStopEntries([], snapshot([end], end.id)), [stopMessage()]);
});
