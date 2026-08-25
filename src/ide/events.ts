// Mapping pi RPC events → UI actions (concept 0001, plan 0001 step 6).
// The streaming state is assembled from deltas: message_end is the
// authoritative snapshot (docs/rpc.md).

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
  /** provider/turn error (message stopReason "error"): shown as an error box */
  errorMessage?: string;
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
  | { kind: "system_note"; level: "error" | "warn" | "info"; text: string }
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
      // provider/turn failure: the authoritative final message carries the
      // error (message.errorMessage / stopReason "error") — surface it.
      const rawMsg = evt.message as { errorMessage?: unknown; stopReason?: unknown } | undefined;
      const errorMessage =
        typeof rawMsg?.errorMessage === "string" && rawMsg.errorMessage.length > 0
          ? rawMsg.errorMessage
          : rawMsg?.stopReason === "error"
            ? "Unknown provider error"
            : undefined;
      state.active = false;
      return {
        kind: "message_end",
        message: { text, thinking, toolCalls, errorMessage },
      };
    }

    case "agent_start":
    case "agent_end":
    case "agent_settled":
    case "turn_start":
    case "turn_end":
    case "queue_update":
    case "tool_execution_start":
    case "tool_execution_end":
      // No separate status line: the state is shown by the thinking
      // block (loader) and the tool cards.
      return { kind: "none" };

    // provider auto-retry (e.g. 503): what the terminal console shows
    case "auto_retry_start": {
      const attempt = Number(evt.attempt ?? 0);
      const max = Number(evt.maxAttempts ?? 0);
      const delay = Number(evt.delayMs ?? 0) / 1000;
      const err = String(evt.errorMessage ?? "Unknown error");
      return {
        kind: "system_note",
        level: "warn",
        text: `Retrying (${attempt}/${max}) in ${delay.toFixed(1)}s — ${err}`,
      };
    }
    case "auto_retry_end": {
      const ok = evt.success === true;
      const final = evt.finalError as string | undefined;
      return ok
        ? { kind: "none" }
        : {
            kind: "system_note",
            level: "error",
            text: final ?? "Retry exhausted — giving up",
          };
    }
    case "summarization_retry_scheduled": {
      const err = String(evt.errorMessage ?? "");
      return err
        ? { kind: "system_note", level: "warn", text: `Compaction retry: ${err}` }
        : { kind: "none" };
    }

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
      // the tool NAME is already here (partial.content[index]), no need to
      // wait for toolcall_end: the card is born right away with the real name
      const partial = delta.partial as
        | { content?: Array<{ type?: string; id?: string; name?: string }> }
        | undefined;
      const content = partial?.content?.[index];
      // pi 0.84.3+ (fix #7953): id and toolName also arrive at the TOP level
      // of the RPC event (assistantMessageEvent) — fallback for robustness
      const top = delta as { id?: string; toolName?: string };
      return {
        kind: "tool_call_start",
        index,
        toolCall: {
          id: content?.id ?? top.id ?? "",
          name: content?.name ?? top.toolName ?? "",
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
