// Mappatura eventi RPC di pi → azioni di UI (concept 0001, piano 0001 step 6).
// Lo stato di streaming viene assemblato dai delta: message_end è lo snapshot
// autorevole (docs/rpc.md).

import type { RpcEvent, AssistantDelta } from "./protocol.ts";

export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
}

export interface FinalizedMessage {
  text: string;
  thinking: string;
  toolCalls: ToolCallInfo[];
}

export interface StreamState {
  active: boolean;
  textByIndex: Map<number, string>;
  thinkingByIndex: Map<number, string>;
  toolArgsByIndex: Map<number, string>;
  toolCallsByIndex: Map<number, ToolCallInfo>;
}

export const emptyStream = (): StreamState => ({
  active: false,
  textByIndex: new Map(),
  thinkingByIndex: new Map(),
  toolArgsByIndex: new Map(),
  toolCallsByIndex: new Map(),
});

export type UiAction =
  | { kind: "stream_start" }
  | { kind: "text_delta"; index: number; delta: string }
  | { kind: "thinking_delta"; index: number; delta: string }
  | { kind: "thinking_end"; index: number }
  | { kind: "tool_args_delta"; index: number; delta: string }
  | { kind: "tool_call_start"; index: number; toolCall: ToolCallInfo }
  | { kind: "tool_call"; index: number; toolCall: ToolCallInfo }
  | { kind: "message_end"; message: FinalizedMessage }
  | { kind: "none" };

export function handleRpcEvent(state: StreamState, evt: RpcEvent): UiAction {
  switch (evt.type) {
    case "message_start": {
      state.active = true;
      state.textByIndex.clear();
      state.thinkingByIndex.clear();
      state.toolArgsByIndex.clear();
      state.toolCallsByIndex.clear();
      return { kind: "stream_start" };
    }

    case "message_update": {
      const delta = evt.assistantMessageEvent as AssistantDelta | undefined;
      if (!delta) return { kind: "none" };
      return handleDelta(state, delta);
    }

    case "message_end": {
      if (!state.active) return { kind: "none" };
      const indexes = [
        ...new Set([
          ...state.textByIndex.keys(),
          ...state.thinkingByIndex.keys(),
          ...state.toolCallsByIndex.keys(),
        ]),
      ].sort((a, b) => a - b);
      const text = indexes.map((i) => state.textByIndex.get(i) ?? "").join("");
      const thinking = indexes.map((i) => state.thinkingByIndex.get(i) ?? "").join("");
      const toolCalls = indexes
        .map((i) => state.toolCallsByIndex.get(i))
        .filter((t): t is ToolCallInfo => t !== undefined);
      state.active = false;
      return { kind: "message_end", message: { text, thinking, toolCalls } };
    }

    case "agent_start":
    case "agent_end":
    case "agent_settled":
    case "turn_start":
    case "turn_end":
    case "queue_update":
    case "tool_execution_start":
    case "tool_execution_end":
      // Nessuna status line separata: lo stato è mostrato dal blocco
      // pensiero (loader) e dalle card dei tool.
      return { kind: "none" };

    default:
      return { kind: "none" };
  }
}

function handleDelta(state: StreamState, delta: AssistantDelta): UiAction {
  const index = delta.contentIndex ?? 0;
  switch (delta.type) {
    case "text_delta": {
      const prev = state.textByIndex.get(index) ?? "";
      state.textByIndex.set(index, prev + (delta.delta ?? ""));
      return { kind: "text_delta", index, delta: delta.delta ?? "" };
    }
    case "thinking_delta": {
      const prev = state.thinkingByIndex.get(index) ?? "";
      state.thinkingByIndex.set(index, prev + (delta.delta ?? ""));
      return { kind: "thinking_delta", index, delta: delta.delta ?? "" };
    }
    case "thinking_end":
      return { kind: "thinking_end", index };
    case "toolcall_delta": {
      const prev = state.toolArgsByIndex.get(index) ?? "";
      state.toolArgsByIndex.set(index, prev + (delta.delta ?? ""));
      return { kind: "tool_args_delta", index, delta: delta.delta ?? "" };
    }
    case "toolcall_end": {
      const tc = delta.toolCall;
      if (tc) {
        const info: ToolCallInfo = {
          id: tc.id,
          name: tc.name,
          args: JSON.stringify(tc.arguments),
        };
        state.toolCallsByIndex.set(index, info);
        return { kind: "tool_call", index, toolCall: info };
      }
      return { kind: "none" };
    }
    case "toolcall_start": {
      // il NOME del tool è già qui (partial.content[index]), non serve
      // aspettare toolcall_end: la card nasce subito col nome vero
      const partial = delta.partial as
        | { content?: Array<{ type?: string; id?: string; name?: string }> }
        | undefined;
      const content = partial?.content?.[index];
      return {
        kind: "tool_call_start",
        index,
        toolCall: {
          id: content?.id ?? "",
          name: content?.name ?? "",
          args: "",
        },
      };
    }
    case "text_start":
    case "text_end":
    case "thinking_start":
    case "thinking_end":
      return { kind: "none" };
    default:
      return { kind: "none" };
  }
}
