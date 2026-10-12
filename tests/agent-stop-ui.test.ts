import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  AGENT_STOP_ENTRY_DATA,
  AGENT_STOP_ENTRY_TYPE,
  isAbortedAssistantMessage,
  isAgentStopEntry,
} from "../src/ide/agent-stop.ts";
import { emptyStream, handleRpcEvent } from "../src/ide/events.ts";
import { rpc, type RpcEvent } from "../src/ide/protocol.ts";
import { TrailingToolOutputResolver } from "../src/web/tool-output-resolver.ts";

// Exercise the actual STOP and settlement handlers, including synchronous
// late tool results during abort delivery, without booting the full Webview.
const source = ts.createSourceFile(
  "main.ts",
  readFileSync("src/web/main.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const handlers = source.statements.filter(
  (statement) =>
    ts.isFunctionDeclaration(statement) &&
    ["stopWorking", "renderRpcEvent"].includes(statement.name?.text ?? ""),
);
assert.equal(handlers.length, 2);
const code = ts.transpileModule(
  handlers.map((statement) => statement.getFullText(source)).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

type Output = { id: string; value: string };
function harness(options: { idle?: boolean; lateResultOnAbort?: boolean } = {}) {
  const outputs = new TrailingToolOutputResolver<Output>();
  outputs.beginRun();
  const promoted: Output[] = [];
  const toolCards: Output[] = [];
  const commands: string[] = [];
  const stopEvents: string[] = [];
  const state = {
    trailingToolOutputs: outputs,
    runStopEventShown: false,
    working: !options.idle,
    rpc,
    isAbortedAssistantMessage,
    isAgentStopEntry,
    stream: emptyStream(),
    handleRpcEvent,
    activeAgenticBlock: null,
    agenticThinking: true,
    agenticRunStartedAt: 0,
    performance,
    trackWorking: (event: RpcEvent) => {
      if (event.type === "agent_start") state.working = true;
      if (event.type === "agent_settled") state.working = false;
    },
    setComposerActivity: () => {
      state.working = false;
    },
    finishRunningAgenticBlocks: () => {},
    interruptThinking: () => {},
    removeEmptyActiveAgenticBlock: () => {},
    disarmWaitingResponse: () => {},
    updateSendButton: () => {},
    updateSteerPlaceholder: () => {},
    updateThinkingStopBtn: () => {},
    appendAgentStopEvent: () => {
      stopEvents.push("stop");
    },
    promoteToolOutputs: (values: Output[]) => {
      promoted.push(...values);
    },
    handleToolExecution: (event: RpcEvent) => {
      if (event.type !== "tool_execution_end") return;
      const output = { id: String(event.toolCallId), value: String(event.result) };
      toolCards.push(output);
      outputs.record(output);
    },
    dequeueSteering: () => {
      commands.push("clear_queue");
      return Promise.resolve();
    },
    transport: {
      send: (frame: { payload: { type: string } }) => {
        commands.push(frame.payload.type);
        if (frame.payload.type === "abort" && options.lateResultOnAbort) {
          assert.equal(
            outputs.wasStopped,
            true,
            "promotion must already be blocked when abort is sent",
          );
          api.renderRpcEvent({
            type: "tool_execution_end",
            toolCallId: "late",
            result: "late output",
          });
        }
      },
    },
  };
  const api = runInNewContext(`${code}\n({ stopWorking, renderRpcEvent });`, state) as {
    stopWorking(): Promise<void>;
    renderRpcEvent(event: RpcEvent): void;
  };
  return { ...api, outputs, promoted, toolCards, commands, stopEvents };
}

function result(value: ReturnType<typeof harness>, id = "tool") {
  value.renderRpcEvent({
    type: "tool_execution_end",
    toolCallId: id,
    result: "tool output",
  });
}

test("STOP suppresses existing and synchronously late tool results before sending abort", async () => {
  const value = harness({ lateResultOnAbort: true });
  result(value);
  await value.stopWorking();
  assert.deepEqual(value.commands, ["clear_queue", "abort"]);
  value.renderRpcEvent({ type: "agent_end" });
  assert.deepEqual(value.promoted, []);
  assert.deepEqual(value.stopEvents, []);
  value.renderRpcEvent({ type: "agent_settled" });
  assert.deepEqual(value.promoted, []);
  assert.deepEqual(value.stopEvents, ["stop"]);
  assert.equal(
    value.toolCards.length,
    2,
    "both tool results remain available in their cards",
  );
});

test("an authoritative aborted settlement works without a local STOP click or assistant snapshot", () => {
  const value = harness();
  result(value);
  value.renderRpcEvent({ type: "agent_settled", aborted: true });
  assert.deepEqual(value.promoted, []);
  assert.deepEqual(value.stopEvents, ["stop"]);
});

test("an aborted assistant suppresses promotion even if no stream was active", () => {
  const value = harness();
  result(value);
  value.renderRpcEvent({
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "aborted" },
  });
  value.renderRpcEvent({ type: "agent_settled" });
  assert.deepEqual(value.promoted, []);
  assert.deepEqual(value.stopEvents, ["stop"]);
});

test("a persisted stop notification suppresses promotion before final settlement", () => {
  const value = harness();
  result(value);
  value.renderRpcEvent({
    type: "entry_appended",
    entry: {
      type: "custom",
      customType: AGENT_STOP_ENTRY_TYPE,
      data: AGENT_STOP_ENTRY_DATA,
    },
  });
  result(value, "late");
  value.renderRpcEvent({ type: "agent_settled", aborted: true });
  value.renderRpcEvent({ type: "agent_settled", aborted: true });
  assert.deepEqual(value.promoted, []);
  assert.deepEqual(
    value.stopEvents,
    ["stop"],
    "multiple abort signals must not duplicate the event",
  );
});

test("a stopped run without any tool still shows an interruption event", async () => {
  const value = harness();
  await value.stopWorking();
  value.renderRpcEvent({ type: "agent_settled", aborted: true });
  assert.deepEqual(value.promoted, []);
  assert.deepEqual(value.stopEvents, ["stop"]);
});

test("the next successful run can promote its own tool results normally", async () => {
  const value = harness();
  result(value);
  await value.stopWorking();
  value.renderRpcEvent({ type: "agent_settled", aborted: true });
  value.renderRpcEvent({ type: "agent_start" });
  result(value, "next");
  value.renderRpcEvent({ type: "agent_settled", aborted: false });
  assert.deepEqual(value.promoted, [{ id: "next", value: "tool output" }]);
  assert.deepEqual(value.stopEvents, ["stop"]);
});

test("STOP while idle is a no-op and normal completion still promotes tool output", async () => {
  const value = harness({ idle: true });
  await value.stopWorking();
  assert.deepEqual(value.commands, []);
  assert.equal(value.outputs.wasStopped, false);
  result(value);
  value.renderRpcEvent({ type: "agent_settled", aborted: false });
  assert.equal(value.promoted.length, 1);
  assert.deepEqual(value.stopEvents, []);
});
