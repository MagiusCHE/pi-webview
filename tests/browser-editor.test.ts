import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  browserEditorConsentOperation,
  normalizeBrowserEditorRequest,
} from "../src/ide/browser-tools.ts";
import { pageEditorOperation } from "../src/adapters/browser/chrome/page-editor.ts";
import { registerBrowserTools } from "../packages/pi-webview/lib/browser-tools.ts";

const HASH = "fnv1a32:0a1b2c3d:42";

// --- fake page -------------------------------------------------------------

interface FakeElement {
  nodeType: number;
  id: string;
  getBoundingClientRect(): { width: number; height: number };
  closest(selector: string): FakeElement | null;
  getAttribute(name: string): string | null;
  querySelectorAllSelection?: Element[];
  [key: string]: unknown;
}

interface FakeField extends FakeElement {
  value: string;
  readOnly: boolean;
  disabled: boolean;
  type: string;
  isContentEditable?: boolean;
  textContent: string;
  dispatchEvent(event: unknown): boolean;
  focus(): void;
}

function fakeElement(extra: Record<string, unknown> = {}): FakeElement {
  return {
    nodeType: 1,
    id: "",
    getBoundingClientRect: () => ({ width: 100, height: 40, right: 100, bottom: 40 }),
    closest: () => null,
    getAttribute: () => null,
    ...extra,
  };
}

function installFakePage(options: {
  elements?: FakeElement[];
  window?: Record<string, unknown>;
}): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const elements = options.elements ?? [];
  scope.window = {
    ...(options.window ?? {}),
    getSelection: () => null,
  };
  scope.document = {
    querySelectorAll: (selector: string) => (selector === "*" ? elements : []),
    querySelector: () => null,
    createRange: () => ({
      selectNodeContents: () => undefined,
    }),
    execCommand: () => false,
  };
  scope.location = { href: "https://editor.example.test/app" };
  scope.HTMLTextAreaElement = class HTMLTextAreaElement {};
  scope.HTMLInputElement = class HTMLInputElement {};
  scope.Element = class Element {};
}

function restorePage(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  for (const key of [
    "window",
    "document",
    "location",
    "HTMLTextAreaElement",
    "HTMLInputElement",
    "Element",
  ]) {
    delete scope[key];
  }
}

function valueApiEditor(initial: string): Record<string, any> {
  let text = initial;
  const doc = {
    getValue: () => text,
    setValue: (next: string) => {
      text = next;
    },
    getLine: (line: number) => text.split("\n")[line],
    lineCount: () => text.split("\n").length,
    indexFromPos: ({ line, ch }: { line: number; ch: number }) => {
      const lines = text.split("\n");
      let offset = 0;
      for (let index = 0; index < line; index += 1) {
        offset += (lines[index] ?? "").length + 1;
      }
      return offset + ch;
    },
    posFromIndex: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return {
        line: before.length - 1,
        ch: (before[before.length - 1] ?? "").length,
      };
    },
    replaceRange: (
      insert: string,
      from: { line: number; ch: number },
      to: { line: number; ch: number },
    ) => {
      const start = doc.indexFromPos(from);
      const end = doc.indexFromPos(to);
      text = text.slice(0, start) + insert + text.slice(end);
    },
  };
  return {
    getValue: () => text,
    setValue: (next: string) => {
      text = next;
    },
    getDoc: () => doc,
    readOnly: false,
  };
}

function offsetDocumentEditor(initial: string): Record<string, any> {
  const lines = () => initial.split("\n");
  const doc = {
    length: initial.length,
    lines: lines().length,
    toString: () => initial,
    line: (line: number) => {
      const all = lines();
      let from = 0;
      for (let index = 0; index < line - 1; index += 1) {
        from += (all[index] ?? "").length + 1;
      }
      return { from, length: (all[line - 1] ?? "").length };
    },
  };
  return {
    state: { doc, readOnly: false },
    dispatch: ({
      changes,
    }: {
      changes: { from: number; to: number; insert: string };
    }) => {
      initial =
        initial.slice(0, changes.from) + changes.insert + initial.slice(changes.to);
    },
  };
}

function modelRegistry(model: Record<string, any>): Record<string, any> {
  return { getModels: () => [model] };
}

function registryModel(initial: string): Record<string, any> {
  let text = initial;
  const api = {
    uri: { toString: () => "inmemory://document/1" },
    getValue: () => text,
    setValue: (next: string) => {
      text = next;
    },
    getLineCount: () => text.split("\n").length,
    getLineMaxColumn: (line: number) => (text.split("\n")[line - 1] ?? "").length + 1,
    getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) => {
      const lines = text.split("\n");
      let offset = 0;
      for (let index = 0; index < lineNumber - 1; index += 1) {
        offset += (lines[index] ?? "").length + 1;
      }
      return offset + column - 1;
    },
    getPositionAt: (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return {
        lineNumber: before.length,
        column: (before[before.length - 1] ?? "").length + 1,
      };
    },
    isReadOnly: () => false,
    getLanguageId: () => "javascript",
    pushEditOperations: (
      _selections: unknown,
      edits: Array<{
        range: {
          startPosition: { lineNumber: number; column: number };
          endPosition: { lineNumber: number; column: number };
        };
        text: string;
      }>,
    ) => {
      const offset = (position: { lineNumber: number; column: number }) =>
        api.getOffsetAt(position);
      const sorted = [...edits].sort(
        (left, right) =>
          offset(right.range.startPosition) - offset(left.range.startPosition),
      );
      for (const edit of sorted) {
        const from = offset(edit.range.startPosition);
        const to = offset(edit.range.endPosition);
        text = text.slice(0, from) + edit.text + text.slice(to);
      }
      return null;
    },
  };
  return api;
}

// --- request normalization -------------------------------------------------

test("editor request: list and read need no hash", () => {
  assert.deepEqual(normalizeBrowserEditorRequest({ action: "list" }), {
    action: "list",
  });
  assert.deepEqual(
    normalizeBrowserEditorRequest({ action: "read", editorId: "f0:value-api:0" }),
    { action: "read", editorId: "f0:value-api:0" },
  );
});

test("editor request: writes require an editor id and the previous hash", () => {
  assert.throws(
    () =>
      normalizeBrowserEditorRequest({
        action: "replace",
        text: "next",
        expectedHash: HASH,
      }),
    /editorId/,
  );
  assert.throws(
    () =>
      normalizeBrowserEditorRequest({
        action: "replace",
        editorId: "f0:value-api:0",
        text: "next",
      }),
    /expectedHash/,
  );
  assert.throws(
    () =>
      normalizeBrowserEditorRequest({
        action: "replace",
        editorId: "f0:value-api:0",
        text: "next",
        expectedHash: "not-a-hash",
      }),
    /hash/,
  );
  assert.throws(
    () =>
      normalizeBrowserEditorRequest({
        action: "replace",
        editorId: "f0:codemirror5:0",
        text: "next",
        expectedHash: HASH,
      }),
    /editorId/,
  );
});

test("editor consent reuses the existing DOM and action grants", () => {
  assert.equal(browserEditorConsentOperation({ action: "list" }), "dom");
  assert.equal(
    browserEditorConsentOperation({ action: "read", editorId: "f0:value-api:0" }),
    "dom",
  );
  assert.equal(
    browserEditorConsentOperation({
      action: "replace",
      editorId: "f0:value-api:0",
      text: "",
      expectedHash: HASH,
    }),
    "action",
  );
});

// --- capability discovery --------------------------------------------------

test("value-API editors are detected without any library name", () => {
  installFakePage({
    elements: [fakeElement({ editorInstance: valueApiEditor("one\ntwo\n") })],
  });
  try {
    const list = pageEditorOperation({ action: "list" });
    assert.equal(list.ok, true);
    const editor = list.editors![0]!;
    assert.equal(editor.kind, "value-api");
    assert.equal(editor.verificationLevel, "model");
    assert.equal(editor.lines, 3);

    const read = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(read.content, "one\ntwo\n");
    assert.equal(read.verificationLevel, "model");

    const replaced = pageEditorOperation({
      action: "replace",
      editorId: editor.editorId,
      text: "three\n",
      expectedHash: read.contentHash!,
    });
    assert.equal(replaced.ok, true);
    assert.equal(replaced.verified, true);
    assert.equal(replaced.verificationLevel, "model");

    const applied = pageEditorOperation({
      action: "apply",
      editorId: editor.editorId,
      expectedHash: replaced.contentHash!,
      edits: [{ fromLine: 1, fromColumn: 1, toLine: 1, toColumn: 6, text: "THREE" }],
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.verified, true);
    const after = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(after.content, "THREE\n");
  } finally {
    restorePage();
  }
});

test("offset-document editors are detected through their doc and dispatch", () => {
  installFakePage({
    elements: [fakeElement({ viewInstance: offsetDocumentEditor("alpha\nbeta\n") })],
  });
  try {
    const list = pageEditorOperation({ action: "list" });
    const editor = list.editors![0]!;
    assert.equal(editor.kind, "offset-document");
    assert.equal(editor.verificationLevel, "model");

    const read = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(read.content, "alpha\nbeta\n");

    const applied = pageEditorOperation({
      action: "apply",
      editorId: editor.editorId,
      expectedHash: read.contentHash!,
      edits: [{ fromLine: 1, fromColumn: 1, toLine: 1, toColumn: 1, text: "// " }],
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.verified, true);
    const after = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(after.content, "// alpha\nbeta\n");
  } finally {
    restorePage();
  }
});

test("model registries are detected without a brand-specific global", () => {
  installFakePage({
    window: { someEditorRegistry: modelRegistry(registryModel("fn main() {}\n")) },
  });
  try {
    const list = pageEditorOperation({ action: "list" });
    const editor = list.editors![0]!;
    assert.equal(editor.kind, "model-registry");
    assert.equal(editor.verificationLevel, "model");
    assert.equal(editor.modelUri, "inmemory://document/1");
    assert.equal(editor.language, "javascript");

    const read = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(read.content, "fn main() {}\n");

    const stale = pageEditorOperation({
      action: "replace",
      editorId: editor.editorId,
      text: "x",
      expectedHash: "fnv1a32:00000000:1",
    });
    assert.equal(stale.ok, false);
    assert.match(stale.error ?? "", /changed since it was read/);
  } finally {
    restorePage();
  }
});

test("DOM fields are exposed as DOM-verified only", () => {
  const field: FakeField = Object.assign(fakeElement(), {
    value: "initial",
    readOnly: false,
    disabled: false,
    type: "text",
    textContent: "initial",
    dispatchEvent: () => true,
    focus: () => undefined,
  });
  const HTMLTextAreaElement = globalThis.HTMLTextAreaElement;
  installFakePage({ elements: [] });
  const scope = globalThis as unknown as Record<string, unknown>;
  // one textarea-like element, resolved by the fallback selector
  scope.document = {
    querySelectorAll: (selector: string) => (selector === "textarea" ? [field] : []),
    querySelector: () => null,
    createRange: () => ({ selectNodeContents: () => undefined }),
    execCommand: () => false,
  };
  // native value setter, like the real HTMLTextAreaElement.prototype
  class FakeTextAreaElement {
    static [Symbol.hasInstance](value: unknown) {
      return value === field;
    }
    get value(): string {
      return String((this as unknown as FakeField).value ?? "");
    }
    set value(next: string) {
      (this as unknown as FakeField).value = next;
    }
  }
  scope.HTMLTextAreaElement = FakeTextAreaElement;
  scope.HTMLInputElement = class {
    static [Symbol.hasInstance]() {
      return false;
    }
  };
  try {
    const list = pageEditorOperation({ action: "list" });
    assert.equal(list.ok, true);
    const editor = list.editors![0]!;
    assert.equal(editor.kind, "dom-field");
    assert.equal(editor.verificationLevel, "dom-only");

    const read = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(read.content, "initial");
    assert.equal(read.verificationLevel, "dom-only");
    assert.match(read.warning ?? "", /DOM/);

    const replaced = pageEditorOperation({
      action: "replace",
      editorId: editor.editorId,
      text: "typed",
      expectedHash: read.contentHash!,
    });
    assert.equal(replaced.ok, true);
    assert.equal(replaced.verificationLevel, "dom-only");
    assert.equal(field.value, "typed");
  } finally {
    scope.HTMLTextAreaElement = HTMLTextAreaElement;
    restorePage();
  }
});

// --- guards ---------------------------------------------------------------

test("editor tool is registered with the structured schema only", () => {
  const definitions: Array<{ name: string }> = [];
  registerBrowserTools({
    registerTool(definition) {
      definitions.push(definition);
    },
  });
  const names = definitions.map((definition) => definition.name);
  assert.ok(names.includes("browser_page_editor"));
  assert.deepEqual(
    names.filter((name) => /script|eval|exec|code/.test(name)),
    ["browser_page_script"],
  );
});

test("the editor module is capability-based and brand-free", () => {
  const source = readFileSync("src/adapters/browser/chrome/page-editor.ts", "utf8");
  // word boundaries: "surface" or "replace" must not trip the guard
  assert.doesNotMatch(source.toLowerCase(), /\b(?:codemirror|monaco|ace)\b/);
  for (const shape of ["value-api", "offset-document", "model-registry", "dom-field"]) {
    assert.match(source, new RegExp(shape));
  }
  // packaged function: no dynamic evaluation, no chrome API use
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\beval\(|new Function\(|chrome\./);
  // writes stay hash-guarded and re-read
  assert.match(code, /request\.expectedHash !== currentHash/);
  assert.match(code, /const verified = updated === expected/);
});

test("DOM field ids are unique inside the frame", () => {
  const makeField = (value: string, readOnly: boolean, visible: boolean): FakeField =>
    Object.assign(fakeElement({ hiddenNode: !visible }), {
      value,
      readOnly,
      disabled: false,
      type: "text",
      textContent: value,
      dispatchEvent: () => true,
      focus: () => undefined,
      getBoundingClientRect: () => ({
        width: visible ? 100 : 0,
        height: visible ? 30 : 0,
        right: visible ? 100 : -9000,
        bottom: visible ? 30 : 0,
      }),
    });
  const first = makeField("", false, false);
  const second = makeField("user@example.test", true, false);
  const third = makeField("visible", false, true);
  const scope = globalThis as unknown as Record<string, unknown>;
  const previousTextArea = scope.HTMLTextAreaElement;
  installFakePage({ elements: [] });
  scope.document = {
    querySelectorAll: (selector: string) =>
      selector === "textarea" ? [first, second, third] : [],
    querySelector: () => null,
    createRange: () => ({ selectNodeContents: () => undefined }),
    execCommand: () => false,
  };
  class FakeTextAreaElement {
    static [Symbol.hasInstance](value: unknown) {
      return value === first || value === second || value === third;
    }
  }
  scope.HTMLTextAreaElement = FakeTextAreaElement;
  try {
    const list = pageEditorOperation({ action: "list" });
    const ids = (list.editors ?? []).map((editor) => editor.editorId);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(", ")}`);
    assert.deepEqual(ids, ["dom-field:0", "dom-field:1", "dom-field:2"]);

    // read resolves exactly one target and reports its own content
    const read = pageEditorOperation({ action: "read", editorId: "dom-field:1" });
    assert.equal(read.content, "user@example.test");

    // filters keep hidden and read-only fields out of the way
    const visible = pageEditorOperation({
      action: "list",
      filters: { visibleOnly: true },
    });
    assert.deepEqual(
      (visible.editors ?? []).map((editor) => editor.editorId),
      ["dom-field:2"],
    );
    const editable = pageEditorOperation({
      action: "list",
      filters: { editableOnly: true },
    });
    assert.deepEqual(
      (editable.editors ?? []).map((editor) => editor.editorId),
      ["dom-field:0", "dom-field:2"],
    );
    const hiddenOnly = pageEditorOperation({
      action: "list",
      filters: { visibleOnly: true, editableOnly: true },
    });
    assert.deepEqual(
      (hiddenOnly.editors ?? []).map((editor) => editor.editorId),
      ["dom-field:2"],
    );
  } finally {
    scope.HTMLTextAreaElement = previousTextArea;
    restorePage();
  }
});

test("editor request validates the optional list filters", () => {
  assert.deepEqual(normalizeBrowserEditorRequest({ action: "list" }), {
    action: "list",
  });
  assert.deepEqual(
    normalizeBrowserEditorRequest({
      action: "list",
      filters: { visibleOnly: true },
    }),
    { action: "list", filters: { visibleOnly: true } },
  );
  assert.throws(
    () =>
      normalizeBrowserEditorRequest({
        action: "list",
        filters: { visibleOnly: "yes" },
      }),
    /visibleOnly/,
  );
  assert.throws(
    () => normalizeBrowserEditorRequest({ action: "list", filters: 3 }),
    /filters/,
  );
});

test("a late editor wrapper is found on a large page with framework expandos", () => {
  // reported case: ~3000 elements, editor handle on its own expando at the end.
  // The previous discovery used a global 4000-object budget and stopped early.
  const filler: FakeElement[] = [];
  for (let index = 0; index < 3000; index += 1) {
    filler.push(
      fakeElement({
        id: `row-${index}`,
        className: "row",
        __reactFiber$1234: { tag: 5, index, child: { memoizedProps: { index } } },
        __reactProps$1234: { className: "row" },
      }),
    );
  }
  const wrapper = fakeElement({
    id: "code-area",
    tagName: "TEXTAREA",
    sgiaEditorHandle: valueApiEditor("function sgia() {}\n"),
  });
  installFakePage({ elements: [...filler, wrapper] });
  try {
    const list = pageEditorOperation({ action: "list" });
    assert.equal(list.ok, true, list.error);
    const kinds = (list.editors ?? []).map((editor) => editor.kind);
    assert.ok(kinds.includes("value-api"), `kinds: ${kinds.join(", ")}`);
    const editor = (list.editors ?? []).find((item) => item.kind === "value-api")!;
    const read = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(read.content, "function sgia() {}\n");
    const replaced = pageEditorOperation({
      action: "replace",
      editorId: editor.editorId,
      text: "// patched\n",
      expectedHash: read.contentHash!,
    });
    assert.equal(replaced.verified, true);
  } finally {
    restorePage();
  }
});

test("framework internals are ignored instead of consuming the scan", () => {
  const source = readFileSync("src/adapters/browser/chrome/page-editor.ts", "utf8");
  assert.match(source, /const FRAMEWORK_KEY =/);
  assert.match(source, /__react\|__vue\|__ngContext\|__svelte/);
  // no global object budget that a large DOM can exhaust
  assert.doesNotMatch(source, /MAX_OBJECTS/);
  assert.match(source, /const MAX_SCAN_ELEMENTS = 50_000;/);
});

test("an editor handle whose accessors throw cannot abort the scan", () => {
  // reported case: getDoc/getMode/getOption raise on the real handle, which used
  // to kill the whole injected function and surface as "no supported editor"
  const thrower = {
    getValue: () => "// real content\n",
    setValue: () => undefined,
    getDoc: () => {
      throw new Error("getDoc requires an active session");
    },
    getMode: () => {
      throw new Error("mode unavailable");
    },
    getOption: () => {
      throw new Error("option unavailable");
    },
    getReadOnly: () => {
      throw new Error("readOnly unavailable");
    },
  };
  const filler: FakeElement[] = [];
  for (let index = 0; index < 2100; index += 1) {
    filler.push(fakeElement({ id: `row-${index}` }));
  }
  const wrapper = fakeElement({ id: "code", sgiaHandle: thrower });
  installFakePage({ elements: [...filler, wrapper] });
  try {
    const list = pageEditorOperation({ action: "list" });
    assert.equal(list.ok, true, list.error);
    const editor = (list.editors ?? []).find((item) => item.kind === "value-api");
    assert.ok(editor, `kinds: ${(list.editors ?? []).map((e) => e.kind).join(", ")}`);
    const read = pageEditorOperation({ action: "read", editorId: editor!.editorId });
    assert.equal(read.ok, true, read.error);
    assert.equal(read.content, "// real content\n");
    assert.equal(read.verificationLevel, "model");
  } finally {
    restorePage();
  }
});

test("editor probes are guarded and the empty scan reports what it inspected", () => {
  const source = readFileSync("src/adapters/browser/chrome/page-editor.ts", "utf8");
  assert.match(source, /const safe = <T>\(label: string, probe: \(\) => T\)/);
  assert.match(source, /safe\("getDoc"/);
  assert.match(source, /safe\("option", \(\) => object\.getOption\?\.\("readOnly"\)\)/);
  assert.match(source, /safe\("getReadOnly", \(\) => object\.getReadOnly\?\.\(\)\)/);
  assert.match(source, /safe\("modelLanguage"/);
  assert.match(source, /Inspected \$\{scannedElements\} element\(s\)/);
  const worker = readFileSync("src/adapters/browser/chrome/service-worker.ts", "utf8");
  assert.match(worker, /returned no result from \$\{frames\} frame\(s\)/);
});

test("a throwing getReadOnly never breaks detection and readOnly stays accurate", () => {
  // real Zoho Creator handle: getOption("readOnly") returns false, getReadOnly()
  // raises TypeError, doc/session/state all resolve
  let text = "// 8276 chars\n".repeat(120);
  const handle = {
    getValue: () => text,
    setValue: (next: string) => {
      text = next;
    },
    getDoc: () => ({
      getValue: () => text,
      setValue: (next: string) => {
        text = next;
      },
      getLine: (line: number) => text.split("\n")[line],
      lineCount: () => text.split("\n").length,
      indexFromPos: ({ line, ch }: { line: number; ch: number }) =>
        text
          .split("\n")
          .slice(0, line)
          .reduce((total, current) => total + current.length + 1, 0) + ch,
      posFromIndex: (index: number) => {
        const before = text.slice(0, index).split("\n");
        return {
          line: before.length - 1,
          ch: (before[before.length - 1] ?? "").length,
        };
      },
      replaceRange: (insert: string) => {
        text = insert;
      },
    }),
    getOption: (name: string) => (name === "readOnly" ? false : null),
    getReadOnly: () => {
      throw new TypeError("Illegal invocation");
    },
  };
  const wrapper = fakeElement({ id: "code", sgiaHandle: handle });
  installFakePage({ elements: [wrapper] });
  try {
    const list = pageEditorOperation({ action: "list" });
    assert.equal(list.ok, true, list.error);
    const editor = (list.editors ?? []).find((item) => item.kind === "value-api");
    assert.ok(editor, `kinds: ${(list.editors ?? []).map((e) => e.kind).join(", ")}`);
    assert.equal(editor!.readOnly, false);
    assert.equal(editor!.verificationLevel, "model");
    // no probe failure is reported: the throwing accessor was never needed
    assert.equal(list.warning ?? "", "");
    const read = pageEditorOperation({ action: "read", editorId: editor!.editorId });
    assert.equal(read.ok, true, read.error);
    assert.ok((read.contentLength ?? 0) > 1000);
  } finally {
    restorePage();
  }
});

test("a cross-origin Window expando cannot abort the scan", () => {
  // real page: an iframe's window is reachable as an expando; reading nodeType on
  // a cross-origin Window throws SecurityError and used to kill the injection
  const crossOriginWindow = {
    get nodeType() {
      throw new DOMException(
        "Failed to read a named property 'nodeType' from 'Window'",
        "SecurityError",
      );
    },
    alsoThrows: true,
  };
  const wrapper = fakeElement({
    id: "code",
    editorHandle: valueApiEditor("function real() {}\n"),
    iframeWindow: crossOriginWindow,
  });
  installFakePage({
    elements: [fakeElement({ id: "host", iframeWindow: crossOriginWindow }), wrapper],
  });
  try {
    const list = pageEditorOperation({ action: "list" });
    assert.equal(list.ok, true, list.error);
    const kinds = (list.editors ?? []).map((editor) => editor.kind);
    assert.ok(kinds.includes("value-api"), `kinds: ${kinds.join(", ")}`);
    const editor = (list.editors ?? []).find((item) => item.kind === "value-api")!;
    const read = pageEditorOperation({ action: "read", editorId: editor.editorId });
    assert.equal(read.content, "function real() {}\n");
  } finally {
    restorePage();
  }
});

test("hot-path probes are guarded against throwing property reads", () => {
  const source = readFileSync("src/adapters/browser/chrome/page-editor.ts", "utf8");
  assert.match(source, /const guarded = <T>\(probe: \(\) => T\)/);
  assert.match(
    source,
    /const nodeType = guarded\(\(\) => \(value as \{ nodeType\?: unknown \}\)\.nodeType \?\? null\)/,
  );
  assert.match(source, /if \(nodeType === undefined\) return false;/);
});
