export const SESSION_RECOVERY_INTERVAL_MS = 5_000;

interface RecoveryOptions {
  attempt: (isCurrent: () => boolean) => Promise<boolean>;
  isActive: () => boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (timer: unknown) => void;
}

/** Read-only recovery. A reset invalidates every outstanding async result. */
export class SessionRecovery {
  private readonly options: RecoveryOptions;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (timer: unknown) => void;
  private timer: unknown = null;
  private generation = 0;
  private running = false;
  private attempting = false;

  constructor(options: RecoveryOptions) {
    this.options = options;
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel =
      options.cancel ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.attempting) this.arm();
  }

  reset(): void {
    this.generation++;
    this.running = false;
    this.clearTimer();
  }

  retryNow(): void {
    this.start();
    this.clearTimer();
    if (!this.attempting) void this.tick();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  private arm(): void {
    if (this.timer !== null || !this.running) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.tick();
    }, SESSION_RECOVERY_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.attempting) return;
    if (!this.options.isActive()) {
      this.arm();
      return;
    }
    const generation = this.generation;
    const isCurrent = () => this.running && generation === this.generation;
    this.attempting = true;
    try {
      if (await this.options.attempt(isCurrent)) {
        if (isCurrent()) this.running = false;
      }
    } catch {
      // Timeouts and transient host errors keep the read-only retry alive.
    } finally {
      this.attempting = false;
      this.arm();
    }
  }
}
