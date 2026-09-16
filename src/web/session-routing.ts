import type { RuntimeMode } from "./environment.ts";

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
