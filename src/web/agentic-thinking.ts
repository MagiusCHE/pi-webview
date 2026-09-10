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

export type AgenticItemState = "running" | "success" | "error";

export interface AgenticMetricProgress {
  count: number;
  running: number;
  errors: number;
}

export const emptyAgenticMetricProgress = (): AgenticMetricProgress => ({
  count: 0,
  running: 0,
  errors: 0,
});

/** Applies one item lifecycle transition to a category aggregate. */
export function transitionAgenticMetricProgress(
  progress: AgenticMetricProgress,
  previous: AgenticItemState | null,
  next: AgenticItemState | null,
): AgenticMetricProgress {
  if (previous === next) return { ...progress };
  const count = Math.max(0, progress.count - (previous ? 1 : 0) + (next ? 1 : 0));
  const running = Math.min(
    count,
    Math.max(
      0,
      progress.running - (previous === "running" ? 1 : 0) + (next === "running" ? 1 : 0),
    ),
  );
  const errors = Math.min(
    count,
    Math.max(
      0,
      progress.errors - (previous === "error" ? 1 : 0) + (next === "error" ? 1 : 0),
    ),
  );
  return { count, running, errors };
}

export function agenticMetricVisualState(
  progress: AgenticMetricProgress,
): "running" | "complete" {
  return progress.running > 0 ? "running" : "complete";
}

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
