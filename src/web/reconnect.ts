// Standalone bridge reconnection (concept 0002, D5): the bridge can be
// restarted at any time (piw -k + piw, artifact update, crash). Instead of
// forcing a page reload the page retries the connection every INTERVAL while
// the window is ACTIVE: a hidden tab must not poll the bridge forever, it
// tries again as soon as it becomes visible.
//
// The loop only schedules attempts: resolving an attempt does NOT mean
// "connected". The caller stops the loop when the connection really opens.

export const RECONNECT_INTERVAL_MS = 5_000;

export interface ReconnectLoopOptions {
  /** one connection attempt (a failure must be handled, not thrown) */
  attempt: () => Promise<void>;
  /** the window is active (a visible page, not a background tab) */
  isActive: () => boolean;
  /** retry interval, default RECONNECT_INTERVAL_MS */
  intervalMs?: number;
  /** reconnecting changed (drives the connection dot) */
  onStateChange?: (reconnecting: boolean) => void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class ReconnectLoop {
  private readonly attempt: () => Promise<void>;
  private readonly isActive: () => boolean;
  private readonly intervalMs: number;
  private readonly onStateChange: ((reconnecting: boolean) => void) | undefined;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private timer: unknown = null;
  private running = false;
  private attempting = false;

  constructor(options: ReconnectLoopOptions) {
    this.attempt = options.attempt;
    this.isActive = options.isActive;
    this.intervalMs = options.intervalMs ?? RECONNECT_INTERVAL_MS;
    this.onStateChange = options.onStateChange;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel =
      options.cancel ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  isReconnecting(): boolean {
    return this.running;
  }

  /** the connection was lost: start retrying (idempotent) */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.onStateChange?.(true);
    this.arm();
  }

  /** connected again (or the page is going away): stop retrying */
  stop(): void {
    this.clearTimer();
    if (!this.running) return;
    this.running = false;
    this.onStateChange?.(false);
  }

  /** the window became active again: try NOW instead of waiting an interval */
  retryNow(): void {
    if (!this.running) return;
    this.clearTimer();
    void this.tick();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
  }

  private arm(): void {
    this.timer = this.schedule(() => void this.tick(), this.intervalMs);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.running) return;
    if (this.attempting) {
      // never overlap two connections: the in-flight attempt re-arms the loop
      // by itself when it settles (arming here would double the retries)
      return;
    }
    if (!this.isActive()) {
      this.arm();
      return;
    }
    this.attempting = true;
    try {
      await this.attempt();
    } catch {
      // a failed attempt must never kill the loop
    } finally {
      this.attempting = false;
    }
    // still reconnecting (the caller stops the loop when it actually opens)
    if (this.running) this.arm();
  }
}
