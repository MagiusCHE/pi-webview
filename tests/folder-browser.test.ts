import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import type { DirectoryListing } from "../src/ide/protocol.ts";
import { openFolderBrowser } from "../src/web/folder-browser.ts";
import { setLocale, t } from "../src/web/i18n.ts";

interface TestEvent {
  target: TestElement;
  key?: string;
  preventDefault(): void;
}

// Minimal DOM surface used by the modal, without adding a browser dependency.
class TestElement {
  className = "";
  value = "";
  disabled = false;
  hidden = false;
  selected = false;
  focused = false;
  type = "";
  spellcheck = true;
  innerHTML = "";
  children: TestElement[] = [];
  parent: TestElement | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<(event: TestEvent) => void>>();
  private text = "";

  readonly tagName: string;

  constructor(tagName = "div") {
    this.tagName = tagName;
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.text = value;
    for (const child of this.children) child.parent = null;
    this.children = [];
  }

  append(...children: TestElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child: TestElement): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
  }

  setAttribute(key: string, value: string): void {
    this.attributes.set(key, value);
  }

  addEventListener(type: string, listener: (event: TestEvent) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: TestEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, details: Partial<TestEvent> = {}): void {
    if (type === "click" && this.disabled) return;
    const event = { target: this, preventDefault() {}, ...details };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {
    this.selected = true;
  }

  find(className: string): TestElement {
    if (this.className.split(" ").includes(className)) return this;
    for (const child of this.children) {
      try {
        return child.find(className);
      } catch {
        // Search the next branch.
      }
    }
    throw new Error(`Element not found: ${className}`);
  }
}

class TestDocument extends TestElement {
  body = new TestElement("body");

  createElement(tag: string): TestElement {
    return new TestElement(tag);
  }
}

function listing(path: string): DirectoryListing {
  return { path, parent: null, dirs: [] };
}

function open(
  context: TestContext,
  listDirs: (path: string) => Promise<DirectoryListing | null> = async (path) =>
    listing(path),
) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = new TestDocument();
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  setLocale("en");
  context.after(() => {
    document.emit("keydown", { key: "Escape" });
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const result = openFolderBrowser("/workspace/current", listDirs);
  const backdrop = document.body.find("modal-backdrop");
  const input = backdrop.find("folder-path");
  const go = backdrop.find("folder-path-row").children[1]!;
  const select = backdrop.find("primary");
  const error = backdrop.find("folder-error");
  const dirs = backdrop.find("folder-dirs");
  const edit = (value: string) => {
    input.value = value;
    input.emit("input");
  };
  return { document, result, backdrop, input, go, select, error, dirs, edit };
}

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferredListing() {
  let resolve!: (value: DirectoryListing | null) => void;
  const promise = new Promise<DirectoryListing | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("the picker starts with an editable, selected full path", async (context) => {
  const modal = open(context);
  assert.equal(modal.input.tagName, "input");
  assert.equal(modal.input.type, "text");
  assert.equal(modal.input.value, "/workspace/current");
  assert.equal(modal.input.selected, true);
  assert.equal(modal.input.spellcheck, false);
  assert.equal(modal.select.disabled, true);
  await settled();
  modal.select.emit("click");
  assert.equal(await modal.result, "/workspace/current");
});

test("Select validates the pasted path, not the previously browsed folder", async (context) => {
  const calls: string[] = [];
  const modal = open(context, async (path) => {
    calls.push(path);
    return listing(path);
  });
  await settled();
  const pasted = "C:\\Projects\\Folder with spaces";
  modal.edit(pasted);
  modal.select.emit("click");
  assert.equal(await modal.result, pasted);
  assert.deepEqual(calls, ["/workspace/current", pasted]);
});

test("Go and Enter browse typed paths and show the full bridge-resolved path", async (context) => {
  const modal = open(context, async (path) =>
    listing(path === "relative" ? "/workspace/current/relative" : path),
  );
  await settled();
  modal.edit("relative");
  modal.go.emit("click");
  await settled();
  assert.equal(modal.input.value, "/workspace/current/relative");
  assert.equal(modal.document.body.children.length, 1);
  modal.edit("/another/folder");
  let prevented = false;
  modal.input.emit("keydown", {
    key: "Enter",
    preventDefault() {
      prevented = true;
    },
  });
  await settled();
  assert.equal(prevented, true);
  assert.equal(modal.input.value, "/another/folder");
  modal.select.emit("click");
  assert.equal(await modal.result, "/another/folder");
});

test("an invalid pasted path shows an inline error and can be corrected", async (context) => {
  const modal = open(context, async (path) =>
    path === "/missing" ? null : listing(path),
  );
  await settled();
  modal.edit("/missing");
  modal.select.emit("click");
  await settled();
  assert.equal(modal.input.value, "/missing");
  assert.equal(modal.error.hidden, false);
  assert.equal(modal.error.textContent, t("folderUnavailable"));
  assert.equal(modal.error.attributes.get("role"), "alert");
  assert.equal(modal.input.attributes.get("aria-invalid"), "true");
  assert.equal(modal.document.body.children.length, 1);
  modal.edit("/valid");
  assert.equal(modal.error.hidden, true);
  modal.select.emit("click");
  assert.equal(await modal.result, "/valid");
});

test("lookup failures do not reject the modal or fall back to its old folder", async (context) => {
  const modal = open(context, async () => {
    throw new Error("disconnected");
  });
  await settled();
  assert.equal(modal.error.hidden, false);
  assert.equal(modal.document.body.children.length, 1);
  modal.document.emit("keydown", { key: "Escape" });
  assert.equal(await modal.result, null);
});

test("blank paths disable confirmation and show a required-path error on Enter", async (context) => {
  const calls: string[] = [];
  const modal = open(context, async (path) => {
    calls.push(path);
    return listing(path);
  });
  await settled();
  modal.edit("   ");
  assert.equal(modal.select.disabled, true);
  assert.equal(modal.go.disabled, true);
  modal.input.emit("keydown", { key: "Enter" });
  await settled();
  assert.equal(modal.error.textContent, t("folderPathRequired"));
  assert.deepEqual(calls, ["/workspace/current"]);
});

test("folder clicks keep the full path in sync and render names as text", async (context) => {
  const name = "Folder & <b>name</b>";
  const modal = open(context, async (path) => ({
    path,
    parent: path === "/workspace" ? null : "/workspace",
    dirs: [{ name, path: "/workspace/child" }],
  }));
  await settled();
  const child = modal.dirs.children[1]!;
  assert.equal(child.children[0]!.textContent, name);
  assert.ok(!child.innerHTML.includes(name));
  child.emit("click");
  await settled();
  assert.equal(modal.input.value, "/workspace/child");
  modal.dirs.find("folder-up").emit("click");
  await settled();
  assert.equal(modal.input.value, "/workspace");
});

test("a late initial listing never overwrites a pasted path", async (context) => {
  const initial = deferredListing();
  const modal = open(context, () => initial.promise);
  modal.edit("/pasted");
  initial.resolve(listing("/workspace/current"));
  await settled();
  assert.equal(modal.input.value, "/pasted");
  assert.equal(modal.dirs.children.length, 0);
  assert.equal(modal.select.disabled, false);
});

test("an edit supersedes a pending selection and cannot accept the old path", async (context) => {
  const old = deferredListing();
  const modal = open(context, async (path) =>
    path === "/old" ? old.promise : listing(path),
  );
  await settled();
  modal.edit("/old");
  modal.select.emit("click");
  assert.equal(modal.select.disabled, true);
  modal.edit("/new");
  old.resolve(listing("/old"));
  await settled();
  assert.equal(modal.input.value, "/new");
  assert.equal(modal.document.body.children.length, 1);
  modal.select.emit("click");
  assert.equal(await modal.result, "/new");
});

test("only the newest navigation response can update the picker", async (context) => {
  const old = deferredListing();
  const modal = open(context, async (path) =>
    path === "/old" ? old.promise : listing(path),
  );
  await settled();
  modal.edit("/old");
  modal.go.emit("click");
  modal.edit("/new");
  modal.go.emit("click");
  await settled();
  old.resolve(null);
  await settled();
  assert.equal(modal.input.value, "/new");
  assert.equal(modal.error.hidden, true);
});

test("closing while a lookup is pending returns null and ignores the late result", async (context) => {
  const initial = deferredListing();
  const modal = open(context, () => initial.promise);
  modal.backdrop.emit("click");
  assert.equal(await modal.result, null);
  initial.resolve(listing("/workspace/current"));
  await settled();
  assert.equal(modal.document.body.children.length, 0);
  assert.equal(modal.document.listeners.get("keydown")?.size, 0);
});

test("the folder picker stays outside IDE hosts and bridge validation precedes side effects", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  assert.match(
    web,
    /if \(!runtime\.isVsCode && !runtime\.isIDE\) \{[\s\S]*?void changeWorkspace\(\)/,
  );
  assert.match(web, /await openFolderBrowser\(workspacePath, listDirs\)/);
  const bridge = readFileSync("src/bridge/index.ts", "utf8");
  const change = bridge.slice(bridge.indexOf('if (req.type === "setWorkspace")'));
  const validation = change.indexOf(
    "targetPath = listDirectory(req.path, workspaceDir).path",
  );
  assert.ok(validation >= 0);
  for (const effect of [
    "pi.dispose()",
    "forkSession(",
    "moveSession(",
    "switchWorkspace(",
  ]) {
    assert.ok(change.indexOf(effect) > validation, `${effect} must follow validation`);
  }
});
