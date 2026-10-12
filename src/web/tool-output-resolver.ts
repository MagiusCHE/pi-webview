export interface TrailingToolOutput {
  id: string;
}

export function assistantOnlyReferencesToolOutput(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 240) return false;
  return /^(?:ecco(?:ti|vi)?\b|qui\s+(?:c['’]è|trovi|è)\b|il\s+risultato\s+(?:è|si\s+trova|è\s+riportato)\b|ho\s+(?:allegato|incluso|mostrato|riportato)\b|here(?:'s|\s+is|\s+are)\b|the\s+result\s+(?:is|appears)\b|i(?:'ve|\s+have)\s+(?:attached|included|shown|provided)\b)/i.test(
    normalized,
  );
}

/**
 * Tracks the final batch of tool results in an agent run. A later visible
 * assistant response consumes the batch; a later tool call makes it an
 * intermediate batch. What remains at successful settlement is the response;
 * an interrupted run never promotes tool results, including late arrivals.
 */
export class TrailingToolOutputResolver<T extends TrailingToolOutput> {
  private outputs: T[] = [];
  private interrupted = false;

  get wasStopped(): boolean {
    return this.interrupted;
  }

  beginRun(): void {
    this.clear();
  }

  stop(): void {
    this.interrupted = true;
    this.outputs = [];
  }

  record(output: T): void {
    if (this.interrupted) return;
    const existing = this.outputs.findIndex((item) => item.id === output.id);
    if (existing >= 0) this.outputs[existing] = output;
    else this.outputs.push(output);
  }

  assistantVisible(text = "", hasImages = false): void {
    if (hasImages || !assistantOnlyReferencesToolOutput(text)) this.outputs = [];
  }

  assistantToolCall(): void {
    this.outputs = [];
  }

  settle(): T[] {
    const outputs = this.outputs;
    this.outputs = [];
    return outputs;
  }

  clear(): void {
    this.outputs = [];
    this.interrupted = false;
  }
}
