import type { RuntimeMode } from "./environment.ts";

// Switching can reload a large session and its extensions, especially on
// Windows. The default 10s RPC timeout is too short for this operation.
export const SESSION_SWITCH_TIMEOUT_MS = 90_000;
export const SESSION_HISTORY_TIMEOUT_MS = 90_000;

export function sessionSwitchOutcome(response: {
  type?: unknown;
  success?: unknown;
  data?: unknown;
  error?: unknown;
}): "switched" | "cancelled" | "failed" {
  if (response.success !== true) return "failed";
  const data = response.data;
  if (
    data &&
    typeof data === "object" &&
    "cancelled" in data &&
    data.cancelled === true
  ) {
    return "cancelled";
  }
  return "switched";
}

export type SessionPickStrategy =
  "switch" | "reload-original" | "choose-standalone-action" | "confirm-ide-fork";

export function sessionPickStrategy(
  mode: RuntimeMode,
  crossWorkspace: boolean,
): SessionPickStrategy {
  if (!crossWorkspace) return "switch";
  if (mode === "browser-extension") return "reload-original";
  if (mode === "standalone") return "choose-standalone-action";
  return "confirm-ide-fork";
}
