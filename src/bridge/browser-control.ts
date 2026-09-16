import { randomUUID } from "node:crypto";
import type {
  BrowserPageAction,
  BrowserToolOperation,
  BrowserToolPayload,
  BrowserToolRequest,
} from "../ide/browser-tools.ts";

export type { BrowserToolOperation, BrowserToolPayload } from "../ide/browser-tools.ts";

interface PendingRequest {
  resolve(value: BrowserToolPayload): void;
  timer: ReturnType<typeof setTimeout>;
  removeAbort?: () => void;
}

export class BrowserToolBroker {
  private readonly pending = new Map<string, PendingRequest>();

  request(
    operation: BrowserToolOperation,
    emit: (request: BrowserToolRequest) => void,
    signal?: AbortSignal,
    timeoutMs = 120_000,
    actions?: BrowserPageAction[],
  ): Promise<BrowserToolPayload> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const finish = (value: BrowserToolPayload): void => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.removeAbort?.();
        resolve(value);
      };
      const timer = setTimeout(
        () => finish({ ok: false, operation, error: "Browser tool timed out." }),
        timeoutMs,
      );
      const pending: PendingRequest = { resolve: finish, timer };
      if (signal) {
        const onAbort = () =>
          finish({ ok: false, operation, error: "Browser tool was aborted." });
        signal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbort = () => signal.removeEventListener("abort", onAbort);
      }
      this.pending.set(requestId, pending);
      if (signal?.aborted) {
        finish({ ok: false, operation, error: "Browser tool was aborted." });
        return;
      }
      emit({ requestId, operation, ...(actions ? { actions } : {}) });
    });
  }

  resolve(requestId: string, payload: BrowserToolPayload): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    pending.resolve(payload);
    return true;
  }

  dispose(): void {
    for (const pending of [...this.pending.values()]) {
      pending.resolve({ ok: false, error: "Browser session disconnected." });
    }
  }
}
