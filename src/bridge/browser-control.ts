import { randomUUID } from "node:crypto";

export type BrowserToolOperation = "dom" | "screenshot";

export interface BrowserToolPayload {
  ok: boolean;
  operation?: BrowserToolOperation;
  url?: string;
  title?: string;
  documentId?: string;
  html?: string;
  imageDataUrl?: string;
  error?: string;
}

interface PendingRequest {
  resolve(value: BrowserToolPayload): void;
  timer: ReturnType<typeof setTimeout>;
  removeAbort?: () => void;
}

export class BrowserToolBroker {
  private readonly pending = new Map<string, PendingRequest>();

  request(
    operation: BrowserToolOperation,
    emit: (request: { requestId: string; operation: BrowserToolOperation }) => void,
    signal?: AbortSignal,
    timeoutMs = 120_000,
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
      emit({ requestId, operation });
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
