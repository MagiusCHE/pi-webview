// Executes caller-supplied JavaScript in the page's own main world and returns a
// JSON-serializable snapshot. This is the only place in the extension where code
// from outside the package runs, and it is reachable exclusively through the
// dedicated `script` consent class (session, site or global), requested by the
// user before the first execution. It is injected with
// chrome.scripting.executeScript({ world: "MAIN" }), so it must stay
// self-contained: no imports and no outer references.

export interface PageScriptRequestInput {
  code: string;
  timeoutMs: number;
}

export interface PageScriptResult {
  ok: boolean;
  value?: string;
  type?: string;
  truncated?: boolean;
  durationMs?: number;
  error?: string;
}

export async function pageScriptExecute(
  request: PageScriptRequestInput,
): Promise<PageScriptResult> {
  const MAX_RESULT_BYTES = 32_000;
  const started = Date.now();

  const typeOf = (value: unknown): string => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  };

  const snapshot = (value: unknown): { value: string; truncated: boolean } => {
    const seen = new WeakSet<object>();
    const replacer = (_key: string, candidate: unknown): unknown => {
      if (typeof candidate === "bigint") return `${candidate.toString()}n`;
      if (typeof candidate === "function") {
        const name = (candidate as { name?: string }).name;
        return `[function ${name || "anonymous"}]`;
      }
      if (typeof candidate === "symbol") return candidate.toString();
      if (candidate instanceof Error) {
        return {
          name: candidate.name,
          message: candidate.message,
          stack: candidate.stack?.split("\n").slice(0, 6).join("\n"),
        };
      }
      if (typeof Element !== "undefined" && candidate instanceof Element) {
        return `<${candidate.tagName.toLowerCase()}${candidate.id ? `#${candidate.id}` : ""}>`;
      }
      if (candidate && typeof candidate === "object") {
        if (seen.has(candidate)) return "[circular]";
        seen.add(candidate);
      }
      if (typeof candidate === "number" && !Number.isFinite(candidate)) {
        return String(candidate);
      }
      return candidate;
    };
    let text: string;
    try {
      text = JSON.stringify(value, replacer, 2) ?? "undefined";
    } catch (error) {
      text = JSON.stringify({
        unserializable: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (text.length > MAX_RESULT_BYTES) {
      return {
        value: `${text.slice(0, MAX_RESULT_BYTES)}\n…[truncated]`,
        truncated: true,
      };
    }
    return { value: text, truncated: false };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The consent class exists precisely to allow this evaluation; the source is
    // wrapped in an async arrow so top-level await works and a returned promise
    // is awaited by the caller.
    const factory = new Function(
      `"use strict"; return (async () => {\n${request.code}\n})();`,
    ) as () => Promise<unknown>;
    const execution = Promise.resolve().then(factory);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Script timed out after ${request.timeoutMs} ms.`)),
        request.timeoutMs,
      );
    });
    const value = await Promise.race([execution, timeout]);
    const serialized = snapshot(value);
    return {
      ok: true,
      value: serialized.value,
      type: typeOf(value),
      truncated: serialized.truncated,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      type: typeOf(error),
      durationMs: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
