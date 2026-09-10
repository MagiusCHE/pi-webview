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

export const AGENTIC_COUNT_PULSE_MS = 360;

export interface AgenticCountPulseOptions {
  setValue: (value: number) => void;
  setPulsing: (active: boolean) => void;
  schedule?: (fn: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** Keeps the old value until the pulse peak and restarts on newer updates. */
export class AgenticCountPulse {
  private displayed: number;
  private target: number;
  private swapTimer: unknown = null;
  private finishTimer: unknown = null;
  private readonly schedule: (fn: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly options: AgenticCountPulseOptions;

  constructor(initialValue: number, options: AgenticCountPulseOptions) {
    this.displayed = initialValue;
    this.target = initialValue;
    this.options = options;
    this.schedule = options.schedule ?? ((fn, delayMs) => setTimeout(fn, delayMs));
    this.cancel =
      options.cancel ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    options.setValue(initialValue);
  }

  set(nextValue: number, animated = true): void {
    if (nextValue === this.target) return;
    this.clearTimers();
    this.target = nextValue;
    this.options.setPulsing(false);
    if (!animated) {
      this.displayed = nextValue;
      this.options.setValue(nextValue);
      return;
    }

    this.options.setPulsing(true);
    this.swapTimer = this.schedule(() => {
      this.swapTimer = null;
      this.displayed = this.target;
      this.options.setValue(this.displayed);
    }, AGENTIC_COUNT_PULSE_MS / 2);
    this.finishTimer = this.schedule(() => {
      this.finishTimer = null;
      if (this.displayed !== this.target) {
        this.displayed = this.target;
        this.options.setValue(this.displayed);
      }
      this.options.setPulsing(false);
    }, AGENTIC_COUNT_PULSE_MS);
  }

  dispose(): void {
    this.clearTimers();
    this.options.setPulsing(false);
  }

  private clearTimers(): void {
    if (this.swapTimer !== null) this.cancel(this.swapTimer);
    if (this.finishTimer !== null) this.cancel(this.finishTimer);
    this.swapTimer = null;
    this.finishTimer = null;
  }
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
