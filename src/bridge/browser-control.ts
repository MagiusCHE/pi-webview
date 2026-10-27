import { randomUUID } from "node:crypto";
import type {
  BrowserDomMode,
  BrowserEditorRequest,
  BrowserPageAction,
  BrowserPageToolOperation,
  BrowserScriptRequest,
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
    operation: BrowserPageToolOperation,
    emit: (request: BrowserToolRequest) => void,
    signal?: AbortSignal,
    timeoutMs = 120_000,
    actions?: BrowserPageAction[],
    selector?: string,
    editor?: BrowserEditorRequest,
    script?: BrowserScriptRequest,
    domMode?: BrowserDomMode,
    onCancel?: (requestId: string) => void,
    expectedHost?: string,
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
      const timer = setTimeout(() => {
        onCancel?.(requestId);
        finish({
          ok: false,
          operation,
          outcome: "unknown",
          error:
            "Browser tool timed out: the page may have applied the request anyway. Check the current page state before retrying.",
        });
      }, timeoutMs);
      const pending: PendingRequest = { resolve: finish, timer };
      if (signal) {
        const onAbort = () => {
          onCancel?.(requestId);
          finish({
            ok: false,
            operation,
            outcome: "unknown",
            error:
              "Browser tool was aborted: the page may have applied the request anyway. Check the current page state before retrying.",
          });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbort = () => signal.removeEventListener("abort", onAbort);
      }
      this.pending.set(requestId, pending);
      if (signal?.aborted) {
        finish({ ok: false, operation, error: "Browser tool was aborted." });
        return;
      }
      emit({
        requestId,
        operation,
        ...(actions ? { actions } : {}),
        ...(selector ? { selector } : {}),
        ...(editor ? { editor } : {}),
        ...(script ? { script } : {}),
        ...(domMode ? { domMode } : {}),
        ...(expectedHost ? { expectedHost } : {}),
      });
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
