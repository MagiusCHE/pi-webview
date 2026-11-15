// JSONL framing of the pi RPC protocol (docs/rpc.md):
// - split ONLY on \n (never Node's readline: it splits on U+2028/U+2029)
// - accepts \r\n discarding the trailing \r

export interface JsonlParser {
  push(chunk: string | Uint8Array): void;
  flush(): void;
}

export function createJsonlParser(onLine: (line: string) => void): JsonlParser {
  const decoder = new TextDecoder("utf-8");
  // get_entries can be a single line hundreds of MB long. Keep fragments and
  // scan only NEW text: concatenating/re-scanning the accumulated line on each
  // stdout chunk makes large histories quadratic and can exhaust RPC timeouts.
  let fragments: string[] = [];

  function emit(): void {
    let line = fragments.join("");
    fragments = [];
    if (line.endsWith("\r")) line = line.slice(0, -1);
    onLine(line);
  }

  return {
    push(chunk) {
      const text =
        typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let start = 0;
      let end: number;
      while ((end = text.indexOf("\n", start)) !== -1) {
        fragments.push(text.slice(start, end));
        emit();
        start = end + 1;
      }
      if (start < text.length) fragments.push(text.slice(start));
    },
    flush() {
      const tail = decoder.decode();
      if (tail) fragments.push(tail);
      if (fragments.length > 0) emit();
    },
  };
}

export interface WritableLike {
  write(chunk: string): boolean;
}

export function writeJsonl(stream: WritableLike, obj: unknown): boolean {
  return stream.write(JSON.stringify(obj) + "\n");
}
