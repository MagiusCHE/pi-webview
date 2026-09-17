export interface ComposerDraftSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface ComposerDraftUpdate {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Owns only the temporary speech segment. Existing text is restored after an
 * automatic voice send, so a typed draft can never be submitted by accident.
 */
export class SpeechDraft {
  private original: ComposerDraftSnapshot | null = null;
  private spoken = "";

  get active(): boolean {
    return this.original !== null;
  }

  get text(): string {
    return this.spoken;
  }

  begin(snapshot: ComposerDraftSnapshot): void {
    this.original = {
      value: snapshot.value,
      selectionStart: Math.max(
        0,
        Math.min(snapshot.selectionStart, snapshot.value.length),
      ),
      selectionEnd: Math.max(0, Math.min(snapshot.selectionEnd, snapshot.value.length)),
    };
    this.spoken = "";
  }

  update(text: string): ComposerDraftUpdate | null {
    if (!this.original) return null;
    this.spoken = text;
    const before = this.original.value.slice(0, this.original.selectionStart);
    const after = this.original.value.slice(this.original.selectionEnd);
    const cursor = before.length + text.length;
    return { value: before + text + after, selectionStart: cursor, selectionEnd: cursor };
  }

  /** Keeps the final spoken text in the composer after a cancelled/error run. */
  commit(): ComposerDraftUpdate | null {
    const update = this.update(this.spoken);
    this.original = null;
    return update;
  }

  /** Restores the pre-existing composer draft after a voice segment was sent. */
  restore(): ComposerDraftSnapshot | null {
    const snapshot = this.original;
    this.original = null;
    this.spoken = "";
    return snapshot;
  }

  cancel(): ComposerDraftSnapshot | null {
    return this.restore();
  }
}
