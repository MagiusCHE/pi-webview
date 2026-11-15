import { test } from "node:test";
import assert from "node:assert/strict";
import { createJsonlParser, writeJsonl } from "../src/bridge/jsonl.ts";

test("splitta solo su \\n, non su U+2028/U+2029", () => {
  const lines: string[] = [];
  const p = createJsonlParser((l) => lines.push(l));
  p.push('{"a":"one\u2028two\u2029three"}\n{"b":2}\n');
  assert.deepEqual(lines, ['{"a":"one\u2028two\u2029three"}', '{"b":2}']);
});

test("gestisce \\r\\n e chunk parziali", () => {
  const lines: string[] = [];
  const p = createJsonlParser((l) => lines.push(l));
  p.push('{"x":1}\r\n{"y":');
  p.push('2}\n{"z":3}');
  assert.deepEqual(lines, ['{"x":1}', '{"y":2}']);
  p.flush();
  assert.deepEqual(lines, ['{"x":1}', '{"y":2}', '{"z":3}']);
});

test("una riga molto lunga con JSON su più righe resta unita", () => {
  const lines: string[] = [];
  const p = createJsonlParser((l) => lines.push(l));
  // \n inside a JSON string is NOT a line separator in the protocol,
  // but here we test that the parser handles arbitrary bytes without breaking
  p.push('{"multi":"line\\ninside"}\n{"done":true}\n');
  assert.deepEqual(lines, ['{"multi":"line\\ninside"}', '{"done":true}']);
});

test("preserves UTF-8 code points split across byte chunks", () => {
  const line = JSON.stringify({ text: "caffè 漢字 🎮\u2028\u2029" });
  const bytes = Buffer.from(line + "\r\n");
  const lines: string[] = [];
  const parser = createJsonlParser((value) => lines.push(value));
  for (const byte of bytes) parser.push(Uint8Array.of(byte));
  parser.flush();
  assert.deepEqual(lines, [line]);
});

test("flush emits an unterminated line once, including incomplete UTF-8", () => {
  const lines: string[] = [];
  const parser = createJsonlParser((value) => lines.push(value));
  parser.push("first\n\nlast");
  parser.push(Uint8Array.of(0xe2, 0x82));
  parser.flush();
  parser.flush();
  assert.deepEqual(lines, ["first", "", "last\ufffd"]);
});

test("large chunked RPC lines are scanned linearly, not from the start on every chunk", () => {
  const chunk = "x".repeat(64 * 1024);
  const chunks = 128;
  let received = "";
  const parser = createJsonlParser((line) => {
    received = line;
  });
  // Count searched characters instead of relying on machine-dependent timings.
  // Re-scanning the accumulated buffer would inspect over 500 MB for this 8 MB line.
  const indexOf = String.prototype.indexOf;
  let searched = 0;
  String.prototype.indexOf = function (search: string, position?: number): number {
    if (search === "\n") searched += this.length - (position ?? 0);
    return indexOf.call(this, search, position);
  };
  try {
    for (let i = 0; i < chunks; i++) parser.push(chunk);
    parser.push("\n");
  } finally {
    String.prototype.indexOf = indexOf;
  }
  assert.equal(received.length, chunk.length * chunks);
  assert.ok(searched <= received.length * 2, `searched ${searched} characters`);
});

test("writeJsonl aggiunge il newline finale", () => {
  const out: string[] = [];
  const fake = {
    write: (s: string) => {
      out.push(s);
      return true;
    },
  };
  writeJsonl(fake, { type: "abort" });
  assert.equal(out[0], '{"type":"abort"}\n');
});
