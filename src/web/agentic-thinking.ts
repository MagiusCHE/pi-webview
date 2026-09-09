export type AgenticMetric = "thought" | "read" | "write" | "bash" | "tools";

export const WAITING_RESPONSE_DELAY_MS = 1000;

export function waitingResponseDelayRemaining(startedAt: number, now: number): number {
  return Math.max(0, WAITING_RESPONSE_DELAY_MS - (now - startedAt));
}

export function waitingResponseRestartAt(working: boolean, now: number): number | null {
  return working ? now : null;
}

export function visibleThinkingContent(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface AgenticCounts {
  thought: number;
  read: number;
  write: number;
  bash: number;
  tools: number;
}

export const emptyAgenticCounts = (): AgenticCounts => ({
  thought: 0,
  read: 0,
  write: 0,
  bash: 0,
  tools: 0,
});

/** The live shell must identify an initial provider wait before real activity. */
export function agenticHeaderLabelKey(
  waitingOnly: boolean,
): "waitingResponse" | "agenticThinking" {
  return waitingOnly ? "waitingResponse" : "agenticThinking";
}

/** Maps concrete tool names to the compact categories shown in the header. */
export function agenticToolMetric(name: string): Exclude<AgenticMetric, "thought"> {
  switch (name.toLowerCase()) {
    case "read":
      return "read";
    case "write":
    case "edit":
    case "edit-diff":
      return "write";
    case "bash":
      return "bash";
    default:
      return "tools";
  }
}
