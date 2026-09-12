export type UpdateShieldTone = "ok" | "warn";
export type UpdateShieldTooltip =
  "checking" | "available" | "upToDate" | "restartRequired";

export interface UpdateShieldVisualState {
  disabled: boolean;
  tone: UpdateShieldTone;
  tooltip: UpdateShieldTooltip;
}

/** Pure presentation state for the update shield. The warn tone owns its CSS pulse. */
export function updateShieldVisualState(input: {
  checking: boolean;
  hasUpdate: boolean;
  restartRequired: boolean;
}): UpdateShieldVisualState {
  if (input.restartRequired) {
    return { disabled: true, tone: "ok", tooltip: "restartRequired" };
  }
  if (input.checking) {
    return {
      disabled: true,
      tone: input.hasUpdate ? "warn" : "ok",
      tooltip: "checking",
    };
  }
  return input.hasUpdate
    ? { disabled: false, tone: "warn", tooltip: "available" }
    : { disabled: false, tone: "ok", tooltip: "upToDate" };
}
