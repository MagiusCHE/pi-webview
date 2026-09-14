export interface TrailingToolOutput {
  id: string;
}

/**
 * Tracks the final batch of tool results in an agent run. A later visible
 * assistant response consumes the batch; a later tool call makes it an
 * intermediate batch. Whatever remains at agent settlement is the response.
 */
export class TrailingToolOutputResolver<T extends TrailingToolOutput> {
  private outputs: T[] = [];

  beginRun(): void {
    this.outputs = [];
  }

  record(output: T): void {
    const existing = this.outputs.findIndex((item) => item.id === output.id);
    if (existing >= 0) this.outputs[existing] = output;
    else this.outputs.push(output);
  }

  assistantVisible(): void {
    this.outputs = [];
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
  }
}
