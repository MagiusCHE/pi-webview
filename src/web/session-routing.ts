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
  | "switch"
  | "reload-original"
  | "resume-original"
  | "choose-standalone-action"
  | "confirm-ide-fork";

// crossWorkspace picks need a strategy only when the picked session lives in
// another folder. An UNSTARTED current session (nothing written yet) has no
// conversation to fork or preserve, so the picked session is resumed in its
// own workspace with no question; the fixed-workspace IDE hosts keep their
// fork confirmation because they cannot move pi to another folder.
export function sessionPickStrategy(
  mode: RuntimeMode,
  crossWorkspace: boolean,
  currentSessionEmpty = false,
): SessionPickStrategy {
  if (!crossWorkspace) return "switch";
  if (mode === "browser-extension") return "reload-original";
  if (mode === "standalone")
    return currentSessionEmpty ? "resume-original" : "choose-standalone-action";
  return "confirm-ide-fork";
}
