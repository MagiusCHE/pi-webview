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
  // \n dentro una stringa JSON NON è un separatore di riga nel protocollo,
  // ma qui testiamo che il parser gestisca byte arbitrari senza rompersi
  p.push('{"multi":"line\\ninside"}\n{"done":true}\n');
  assert.deepEqual(lines, ['{"multi":"line\\ninside"}', '{"done":true}']);
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
