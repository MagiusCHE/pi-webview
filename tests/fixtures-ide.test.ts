// Shared IDE bridge protocol fixtures (concept 0005 D3): the files in
// tests/fixtures/ide-protocol/ are consumed both by these tests (frame shape
// from the UI side) and by the Visual Studio adapter C# tests (deserialized
// into the same DTOs) — mitigation of the TS↔C# drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "fixtures", "ide-protocol");

function fixtures(): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

test("fixtures ide-protocol: ogni file è un frame JSON valido", () => {
  for (const f of fixtures()) {
    const raw = readFileSync(join(dir, f), "utf-8");
    let frame: unknown;
    assert.doesNotThrow(() => {
      frame = JSON.parse(raw);
    }, `fixture non-JSON: ${f}`);
    const fr = frame as { channel?: unknown; payload?: { type?: unknown } };
    assert.ok(
      fr.channel === "rpc" || fr.channel === "ide",
      `${f}: channel deve essere rpc|ide`,
    );
    assert.ok(fr.payload && typeof fr.payload === "object", `${f}: payload assente`);
    const payload = fr.payload as { type?: unknown; ok?: unknown };
    // ide responses ({id, ok, …}) have no type: required on all the other payloads
    assert.ok(
      typeof payload.type === "string" || typeof payload.ok === "boolean",
      `${f}: payload.type string (o risposta ide con ok)`,
    );
  }
});

test("fixtures ide-protocol: le richieste ide hanno id", () => {
  for (const f of fixtures().filter((f) => f.includes("request"))) {
    const frame = JSON.parse(readFileSync(join(dir, f), "utf-8")) as {
      channel: string;
      payload: { type: string; id?: string };
    };
    assert.equal(frame.channel, "ide", f);
    assert.equal(typeof frame.payload.id, "string", `${f}: id mancante`);
  }
});

test("fixtures ide-protocol: le risposte ide hanno id + ok", () => {
  for (const f of fixtures().filter((f) => f.includes("response"))) {
    const frame = JSON.parse(readFileSync(join(dir, f), "utf-8")) as {
      channel: string;
      payload: { id?: string; ok?: boolean; error?: string };
    };
    assert.equal(frame.channel, "ide", f);
    assert.equal(typeof frame.payload.id, "string", `${f}: id mancante`);
    assert.equal(typeof frame.payload.ok, "boolean", `${f}: ok mancante`);
    if (!frame.payload.ok) {
      assert.equal(typeof frame.payload.error, "string", `${f}: error mancante`);
    }
  }
});

test("fixtures ide-protocol: selection_changed ha ranges validi", () => {
  const f = "frame-ide-event-selection.json";
  const frame = JSON.parse(readFileSync(join(dir, f), "utf-8")) as {
    channel: string;
    payload: {
      type: string;
      filePath?: string;
      ranges?: Array<{
        text: string;
        selection: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      }>;
    };
  };
  assert.equal(frame.payload.type, "selection_changed");
  assert.ok(frame.payload.filePath);
  assert.ok(frame.payload.ranges && frame.payload.ranges.length > 0);
  for (const r of frame.payload.ranges) {
    assert.equal(typeof r.text, "string");
    assert.ok(Number.isInteger(r.selection.start.line));
    assert.ok(Number.isInteger(r.selection.end.character));
  }
});
