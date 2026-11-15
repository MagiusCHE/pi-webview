import type { RpcEvent } from "./protocol.ts";

// Stop events are session metadata, not messages sent to the model.
export const AGENT_STOP_ENTRY_TYPE = "pi-webview-agent-stop";
export const AGENT_STOP_ENTRY_DATA = { version: 1 } as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isAbortedAssistantMessage(value: unknown): boolean {
  const message = record(value);
  return message?.role === "assistant" && message.stopReason === "aborted";
}

export function isAgentStopEntry(value: unknown): boolean {
  const entry = record(value);
  return (
    entry?.type === "custom" &&
    entry.customType === AGENT_STOP_ENTRY_TYPE &&
    record(entry.data)?.version === AGENT_STOP_ENTRY_DATA.version
  );
}

export function isAgentStopMessage(value: unknown): boolean {
  return record(value)?.role === "agentStop";
}

/** Mark interrupted history segments before any tool output can be promoted. */
export function stoppedHistoryMessages(messages: unknown[]): Set<unknown> {
  const stopped = new Set<unknown>();
  let interrupted = false;
  for (const message of messages.toReversed()) {
    if (isAgentStopMessage(message) || isAbortedAssistantMessage(message))
      interrupted = true;
    if (interrupted) stopped.add(message);
    if (record(message)?.role === "user") interrupted = false;
  }
  return stopped;
}

function messageKey(value: unknown): string | undefined {
  const message = record(value);
  if (!message || typeof message.role !== "string") return undefined;
  if (typeof message.timestamp !== "number") return undefined;
  return JSON.stringify([
    message.role,
    message.timestamp,
    message.toolCallId,
    message.customType,
  ]);
}

function entryMessageKeys(entry: Record<string, unknown>): string[] {
  if (entry.type === "message") {
    const key = messageKey(entry.message);
    return key ? [key] : [];
  }
  const role =
    entry.type === "custom_message"
      ? "custom"
      : entry.type === "compaction"
        ? "compactionSummary"
        : entry.type === "branch_summary"
          ? "branchSummary"
          : undefined;
  if (!role) return [];
  const key = messageKey({
    role,
    timestamp: Date.parse(String(entry.timestamp)),
    customType: entry.type === "custom_message" ? entry.customType : undefined,
  });
  const systemKey =
    entry.type === "compaction" ? messageKey(entry.systemMessage) : undefined;
  return [systemKey, key].filter((value): value is string => !!value);
}

function messageIdentity(value: unknown): unknown {
  const message = record(value);
  if (!message) return undefined;
  return {
    role: message.role,
    timestamp: message.timestamp,
    toolCallId: message.toolCallId,
    customType: message.customType,
  };
}

/**
 * The UI reads get_entries only to place stop markers in get_messages history.
 * Keep the entry graph and message identities, not a second copy of every tool
 * result/image/thought on every branch (potentially hundreds of MB). Hosts must
 * apply this before serializing across WebSocket or VS Code postMessage.
 * get_messages remains Pi's complete, authoritative conversation.
 */
export function compactHistoryResponse(event: RpcEvent): RpcEvent {
  if (event.type !== "response" || event.command !== "get_entries") return event;
  const data = record(event.data);
  if (event.success !== true || !Array.isArray(data?.entries)) return event;
  return {
    ...event,
    data: {
      ...data,
      entries: data.entries.map((value) => {
        const entry = record(value);
        if (!entry) return null;
        return {
          id: entry.id,
          parentId: entry.parentId,
          type: entry.type,
          timestamp: entry.timestamp,
          ...(entry.type === "message"
            ? { message: messageIdentity(entry.message) }
            : {}),
          ...(entry.type === "custom" || entry.type === "custom_message"
            ? { customType: entry.customType }
            : {}),
          ...(isAgentStopEntry(entry) ? { data: AGENT_STOP_ENTRY_DATA } : {}),
          ...(entry.type === "compaction"
            ? {
                firstKeptEntryId: entry.firstKeptEntryId,
                systemMessage: messageIdentity(entry.systemMessage),
              }
            : {}),
        };
      }),
    },
  };
}

/** Merge UI-only stop events into Pi's authoritative, compaction-aware history. */
export function withAgentStopEntries(messages: unknown[], snapshot: unknown): unknown[] {
  const data = record(snapshot);
  if (!Array.isArray(data?.entries) || typeof data.leafId !== "string") return messages;
  const byId = new Map<string, Record<string, unknown>>();
  for (const value of data.entries) {
    const entry = record(value);
    if (entry && typeof entry.id === "string") byId.set(entry.id, entry);
  }
  const branch: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let id: unknown = data.leafId;
  while (typeof id === "string" && !seen.has(id)) {
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) break;
    branch.push(entry);
    id = entry.parentId;
  }
  branch.reverse();

  // Do not resurrect stop events from another branch or a summarized prefix.
  const compactAt = branch.findLastIndex((entry) => entry.type === "compaction");
  const compaction = branch[compactAt];
  const firstKept = compaction
    ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId)
    : -1;
  const entries = compaction
    ? [
        compaction,
        ...(firstKept >= 0 && firstKept < compactAt
          ? branch.slice(firstKept, compactAt)
          : []),
        ...branch.slice(compactAt + 1),
      ]
    : branch;
  const indexes = new Map<string, number[]>();
  messages.forEach((message, index) => {
    const key = messageKey(message);
    if (!key) return;
    const positions = indexes.get(key) ?? [];
    positions.push(index);
    indexes.set(key, positions);
  });
  const stops = new Map<number, unknown[]>();
  let cursor = -1;
  for (const entry of entries) {
    for (const key of entryMessageKeys(entry)) {
      const index = indexes.get(key)?.shift();
      if (index !== undefined) cursor = Math.max(cursor, index);
    }
    if (!isAgentStopEntry(entry) || (cursor < 0 && messages.length > 0)) continue;
    const after = stops.get(cursor) ?? [];
    after.push({
      role: "agentStop",
      timestamp: Date.parse(String(entry.timestamp)) || 0,
    });
    stops.set(cursor, after);
  }
  if (stops.size === 0) return messages;
  return [
    ...(stops.get(-1) ?? []),
    ...messages.flatMap((message, index) => [message, ...(stops.get(index) ?? [])]),
  ];
}
