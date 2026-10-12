import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { setLocale } from "../src/web/i18n.ts";
import {
  discardToolOutputPreviews,
  observeToolOutputPreviews,
  refreshToolOutputPreviews,
  TOOL_OUTPUT_PREVIEW_LINES,
  toolOutputNeedsExpansion,
  wrapToolOutputPreview,
} from "../src/web/tool-output-preview.ts";

// Minimal DOM and layout surface; no browser dependency is needed for unit tests.
class TestElement {
  className = "";
  id = "";
  type = "";
  hidden = false;
  textContent = "";
  clientWidth = 400;
  scrollHeight = 120;
  lineHeight = 20;
  children: TestElement[] = [];
  parent: TestElement | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();

  readonly tagName: string;

  constructor(tagName = "div") {
    this.tagName = tagName;
  }

  get isConnected(): boolean {
    return this.tagName === "body" || (this.parent?.isConnected ?? false);
  }

  classList = {
    add: (name: string) => this.classList.toggle(name, true),
    toggle: (name: string, force: boolean) => {
      const classes = new Set(this.className.split(" ").filter(Boolean));
      if (force) classes.add(name);
      else classes.delete(name);
      this.className = [...classes].join(" ");
      return force;
    },
  };

  append(...children: TestElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(name: string, action: () => void): void {
    this.listeners.set(name, action);
  }

  click(): void {
    this.listeners.get("click")?.();
  }

  querySelectorAll(selector: string): TestElement[] {
    const className = selector.slice(1);
    return this.children.flatMap((child) => [
      ...(child.className.split(" ").includes(className) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

const frames = new Map<number, () => void>();
let frameId = 0;

function flushFrames(): void {
  const scheduled = [...frames.values()];
  frames.clear();
  for (const frame of scheduled) frame();
}

class TestResizeObserver {
  static targets = new Map<TestElement, TestResizeObserver>();

  private callback: (entries: Array<{ target: TestElement }>) => void;

  constructor(callback: (entries: Array<{ target: TestElement }>) => void) {
    this.callback = callback;
  }

  observe(target: TestElement): void {
    TestResizeObserver.targets.set(target, this);
  }

  unobserve(target: TestElement): void {
    TestResizeObserver.targets.delete(target);
  }

  static deliver(target: TestElement, flush = true): void {
    TestResizeObserver.targets.get(target)?.callback([{ target }]);
    if (flush) flushFrames();
  }
}

function setup(context: TestContext, text = "one\ntwo\nthree\nfour", code = false) {
  const globals: Record<string, unknown> = {
    document: { createElement: (tag: string) => new TestElement(tag) },
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame: (frame: () => void) => {
      const id = ++frameId;
      frames.set(id, frame);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: (element: TestElement) => ({
      lineHeight: String(element.lineHeight),
    }),
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  setLocale("en");
  const root = new TestElement("body");
  const content = new TestElement(code ? "pre" : "div");
  content.className = code ? "" : "presented-output-text";
  content.textContent = text;
  const codeBlock = new TestElement();
  const header = new TestElement();
  if (code) {
    codeBlock.className = "code-block presented-output-code";
    header.className = "code-header";
    codeBlock.append(header, content);
  }
  const box = wrapToolOutputPreview(
    (code ? codeBlock : content) as unknown as HTMLElement,
    content as unknown as HTMLElement,
  ) as unknown as TestElement;
  const toggle = box.children[1]!;
  root.append(box);
  const refresh = () => refreshToolOutputPreviews(root as unknown as HTMLElement);
  const observe = () => {
    observeToolOutputPreviews(root as unknown as HTMLElement);
    TestResizeObserver.deliver(content);
  };
  context.after(() => discardToolOutputPreviews(root as unknown as HTMLElement));
  return { root, box, content, toggle, header, refresh, observe };
}

function expanded(box: TestElement): boolean {
  return box.className.split(" ").includes("is-expanded");
}

test("the preview has exactly three lines with pixel-rounding tolerance", () => {
  assert.equal(TOOL_OUTPUT_PREVIEW_LINES, 3);
  assert.equal(toolOutputNeedsExpansion(20, 20), false);
  assert.equal(toolOutputNeedsExpansion(60, 20), false);
  assert.equal(toolOutputNeedsExpansion(57, 18.75), false);
  assert.equal(toolOutputNeedsExpansion(75, 18.75), true);
  assert.equal(toolOutputNeedsExpansion(80, 20), true);
  assert.equal(toolOutputNeedsExpansion(120, 0), false);
  assert.equal(toolOutputNeedsExpansion(120, Number.NaN), false);
});

test("long output starts collapsed and preserves the complete literal text", (context) => {
  const value = "<script>literal text</script>\none\ntwo\nthree\nfour";
  const preview = setup(context, value);
  preview.observe();
  assert.equal(preview.content.textContent, value);
  assert.equal(expanded(preview.box), false);
  assert.equal(preview.toggle.hidden, false);
  assert.equal(preview.toggle.textContent, "Show all");
  assert.equal(preview.toggle.type, "button");
  assert.equal(preview.toggle.attributes.get("aria-expanded"), "false");
  assert.equal(preview.toggle.attributes.get("aria-controls"), preview.content.id);
});

test("the toggle shows everything then restores the three-line preview", (context) => {
  const preview = setup(context);
  preview.observe();
  preview.toggle.click();
  assert.equal(expanded(preview.box), true);
  assert.equal(preview.toggle.textContent, "Show less");
  assert.equal(preview.toggle.attributes.get("aria-expanded"), "true");
  preview.toggle.click();
  assert.equal(expanded(preview.box), false);
  assert.equal(preview.toggle.textContent, "Show all");
  assert.equal(preview.toggle.attributes.get("aria-expanded"), "false");
  assert.equal(preview.content.textContent, "one\ntwo\nthree\nfour");
});

test("short and exactly-three-line output keep the box without a toggle", (context) => {
  const preview = setup(context);
  preview.content.scrollHeight = 60;
  preview.observe();
  assert.equal(preview.toggle.hidden, true);
  preview.content.scrollHeight = 20;
  TestResizeObserver.deliver(preview.content);
  assert.equal(preview.toggle.hidden, true);
});

test("wrapping is measured at the actual width and reacts to resizing", (context) => {
  const preview = setup(context, "one logical line that wraps in a narrow panel");
  preview.content.scrollHeight = 60;
  preview.observe();
  assert.equal(preview.toggle.hidden, true);
  preview.content.clientWidth = 100;
  preview.content.scrollHeight = 120;
  TestResizeObserver.deliver(preview.content);
  assert.equal(preview.toggle.hidden, false);
  preview.toggle.click();
  preview.content.clientWidth = 400;
  preview.content.scrollHeight = 40;
  TestResizeObserver.deliver(preview.content);
  assert.equal(preview.toggle.hidden, true);
  preview.content.clientWidth = 100;
  preview.content.scrollHeight = 120;
  TestResizeObserver.deliver(preview.content);
  assert.equal(preview.toggle.hidden, false);
  assert.equal(preview.toggle.textContent, "Show less");
});

test("labels follow locale changes without resetting an expanded preview", (context) => {
  const preview = setup(context);
  preview.observe();
  setLocale("it");
  preview.refresh();
  assert.equal(preview.toggle.textContent, "Mostra tutto");
  preview.toggle.click();
  assert.equal(preview.toggle.textContent, "Mostra meno");
  setLocale("en");
  preview.refresh();
  assert.equal(preview.toggle.textContent, "Show less");
  assert.equal(expanded(preview.box), true);
});

test("structured output clips only its pre, leaving the Copy header intact", (context) => {
  const preview = setup(context, '{\n  "one": 1,\n  "two": 2,\n  "three": 3\n}', true);
  preview.observe();
  assert.equal(preview.box.children[0]!.children[0], preview.header);
  assert.ok(preview.content.className.includes("presented-output-preview-text"));
  assert.ok(!preview.header.className.includes("presented-output-preview-text"));
  assert.equal(preview.toggle.hidden, false);
});

test("removed previews stop observing and rebuilt history starts collapsed", (context) => {
  const preview = setup(context);
  preview.observe();
  preview.toggle.click();
  assert.ok(TestResizeObserver.targets.has(preview.content));
  discardToolOutputPreviews(preview.root as unknown as HTMLElement);
  assert.equal(TestResizeObserver.targets.has(preview.content), false);
  const rebuilt = wrapToolOutputPreview(preview.content as unknown as HTMLElement);
  assert.ok(!rebuilt.className.includes("is-expanded"));
});

test("resize updates are deferred, coalesced and cancelled when discarded", (context) => {
  const preview = setup(context);
  preview.content.scrollHeight = 20;
  preview.observe();
  preview.content.scrollHeight = 120;
  TestResizeObserver.deliver(preview.content, false);
  TestResizeObserver.deliver(preview.content, false);
  assert.equal(preview.toggle.hidden, true);
  assert.equal(frames.size, 1);
  flushFrames();
  assert.equal(preview.toggle.hidden, false);
  TestResizeObserver.deliver(preview.content, false);
  discardToolOutputPreviews(preview.root as unknown as HTMLElement);
  assert.equal(frames.size, 0);
});

test("CSS limits visual lines and both live/history renderers share the wrapper", () => {
  const css = readFileSync("src/web/style.css", "utf8");
  const main = readFileSync("src/web/main.ts", "utf8");
  assert.match(
    css,
    /\.presented-output-preview \{[^}]*border: 1px solid var\(--border\)/,
  );
  assert.match(css, /\.presented-output-preview-text \{[^}]*line-height: 1\.5/);
  assert.match(
    css,
    /\.presented-output-preview:not\(\.is-expanded\) \.presented-output-preview-text \{[^}]*max-height: 4\.5em;[^}]*overflow: hidden;/,
  );
  assert.match(main, /container\.appendChild\(wrapToolOutputPreview\(block, pre\)\)/);
  assert.match(main, /container\.appendChild\(wrapToolOutputPreview\(text\)\)/);
  assert.match(
    main,
    /if \(evt\.type === "agent_settled"\) \{\s*promoteToolOutputs\(trailingToolOutputs\.settle\(\)\)/,
  );
  assert.match(
    main,
    /finishHistoryAgenticBlock\(lastTs\);\s*promoteToolOutputs\(outputs\)/,
  );
  assert.match(main, /if \(item\.text\) appendPresentedCode\(container, item\.text,/);
});
