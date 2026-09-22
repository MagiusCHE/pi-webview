// Startup configuration errors reported by pi itself (its own stderr):
//
//   Error: Unknown provider "ds4-magius". Use --list-models to see available
//   providers/models.
//
// These are not crashes: every retry fails identically because the saved model
// no longer exists in models.json. They must stop the restart loop and let the
// host fall back to the default model used for new sessions.

const MODEL_CONFIG_ERROR = /unknown (provider|model)\b|use --list-models/i;

/** True when pi's output reports a missing provider or model. */
export function isModelConfigError(text: string): boolean {
  return MODEL_CONFIG_ERROR.test(text);
}

/**
 * Allows exactly one fallback attempt per launch cycle: the first configuration
 * failure replaces the broken session model with the default one, a second
 * failure is final (the UI must stay usable so the user can fix the model).
 * A successful boot resets the allowance for the next cycle.
 */
export class ModelConfigFallback {
  private applied = false;

  /** Consumes the fallback allowance: true only on the first failure. */
  use(): boolean {
    if (this.applied) return false;
    this.applied = true;
    return true;
  }

  get used(): boolean {
    return this.applied;
  }

  reset(): void {
    this.applied = false;
  }
}
