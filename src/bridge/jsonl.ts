// Framing JSONL del protocollo RPC di pi (docs/rpc.md):
// - split SOLO su \n (mai readline di Node: spezza su U+2028/U+2029)
// - accetta \r\n scartando il \r finale

export interface JsonlParser {
  push(chunk: string | Uint8Array): void;
  flush(): void;
}

export function createJsonlParser(onLine: (line: string) => void): JsonlParser {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  return {
    push(chunk) {
      buffer +=
        typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        onLine(line);
      }
    },
    flush() {
      buffer += decoder.decode();
      if (buffer.length === 0) return;
      let line = buffer;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      buffer = "";
      onLine(line);
    },
  };
}

export interface WritableLike {
  write(chunk: string): boolean;
}

export function writeJsonl(stream: WritableLike, obj: unknown): boolean {
  return stream.write(JSON.stringify(obj) + "\n");
}
