import { t, tpl } from "./i18n.ts";
import { searchIcon } from "./icons.ts";

export interface ChatSearchMatch {
  start: number;
  end: number;
}

/** Literal, case-insensitive search; rendered line wrapping is not significant. */
export function findChatSearchMatches(text: string, query: string): ChatSearchMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped.replace(/\s+/g, "\\s+"), "giu");
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function nextChatSearchIndex(
  current: number,
  count: number,
  step: number,
): number {
  if (count === 0) return -1;
  if (current < 0) return step < 0 ? count - 1 : 0;
  return (current + step + count) % count;
}

interface TextPart {
  node: Text;
  start: number;
  end: number;
}

/** Keep inline markdown contiguous, but never join separate messages. */
export function collectChatSearchRanges(root: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  if (!query.trim()) return ranges;
  for (const message of root.children) {
    let text = "";
    const parts: TextPart[] = [];
    const visit = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent ?? "";
        parts.push({
          node: node as Text,
          start: text.length,
          end: text.length + value.length,
        });
        text += value;
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (
        node.matches(
          "button, input, textarea, select, script, style, template, .collapse-footer, [hidden], [aria-hidden='true']",
        )
      )
        return;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return;
      const block = !["inline", "inline-block", "contents"].includes(style.display);
      if (block || node.tagName === "BR") text += "\n";
      for (const child of node.childNodes) {
        // Closed details and lazy thinking bodies are searched once expanded.
        if (
          node instanceof HTMLDetailsElement &&
          !node.open &&
          child !== node.querySelector(":scope > summary")
        )
          continue;
        visit(child);
      }
      if (block) text += "\n";
    };
    visit(message);
    let partIndex = 0;
    for (const match of findChatSearchMatches(text, query)) {
      while (parts[partIndex] && parts[partIndex]!.end <= match.start) partIndex++;
      const first = parts[partIndex];
      let endIndex = partIndex;
      while (parts[endIndex] && parts[endIndex]!.end < match.end) endIndex++;
      const last = parts[endIndex];
      if (!first || !last) continue;
      const range = document.createRange();
      range.setStart(first.node, Math.max(0, match.start - first.start));
      range.setEnd(last.node, match.end - last.start);
      ranges.push(range);
    }
  }
  return ranges;
}

interface ChatSearchOptions {
  root: HTMLElement;
  viewport: HTMLElement;
  canOpen: () => boolean;
  onNavigate: () => void;
}

/** UI-only find: no RPC, transcript mutation, or model-context changes. */
export class ChatSearch {
  private readonly trigger = document.getElementById(
    "btn-chat-search",
  ) as HTMLButtonElement;
  private readonly label = document.getElementById(
    "chat-search-label",
  ) as HTMLSpanElement;
  private readonly bar = document.getElementById("chat-search") as HTMLDivElement;
  private readonly input = document.getElementById(
    "chat-search-input",
  ) as HTMLInputElement;
  private readonly count = document.getElementById(
    "chat-search-count",
  ) as HTMLSpanElement;
  private readonly hint = document.getElementById("chat-search-hint") as HTMLDivElement;
  private readonly previous = document.getElementById(
    "chat-search-prev",
  ) as HTMLButtonElement;
  private readonly next = document.getElementById(
    "chat-search-next",
  ) as HTMLButtonElement;
  private readonly closeButton = document.getElementById(
    "chat-search-close",
  ) as HTMLButtonElement;
  private readonly observer: MutationObserver;
  private ranges: Range[] = [];
  private index = -1;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private previousFocus: HTMLElement | null = null;
  private fallbackRange: Range | null = null;

  private readonly options: ChatSearchOptions;

  constructor(options: ChatSearchOptions) {
    this.options = options;
    this.trigger.insertAdjacentHTML("afterbegin", searchIcon());
    this.observer = new MutationObserver(() => {
      if (this.refreshTimer !== null) return;
      // Throttle rather than debounce so continuous streaming cannot starve find.
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.refresh(false);
      }, 100);
    });
    this.trigger.addEventListener("click", () => this.open());
    this.closeButton.addEventListener("click", () => this.close(true));
    this.previous.addEventListener("click", () => this.navigate(-1));
    this.next.addEventListener("click", () => this.navigate(1));
    this.input.addEventListener("input", () => this.refresh(true));
    document.addEventListener("keydown", (event) => this.onKeyDown(event), true);
  }

  get isOpen(): boolean {
    return !this.bar.hidden;
  }

  private modalOpen(): boolean {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".modal-backdrop, dialog[open]"),
    ).some((element) => !element.hidden && getComputedStyle(element).display !== "none");
  }

  open(): void {
    if (!this.options.canOpen() || this.modalOpen()) return;
    if (!this.isOpen) {
      this.previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const selection = window.getSelection();
      if (
        selection?.rangeCount &&
        this.options.root.contains(selection.getRangeAt(0).commonAncestorContainer)
      ) {
        const selected = selection.toString().trim();
        if (selected && selected.length <= 500) this.input.value = selected;
      }
      this.bar.hidden = false;
      this.trigger.setAttribute("aria-expanded", "true");
      this.observer.observe(this.options.root, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "open", "class", "style"],
      });
      this.refresh(true);
    }
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  close(restoreFocus = false): void {
    if (!this.isOpen) return;
    this.bar.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
    this.observer.disconnect();
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.ranges = [];
    this.index = -1;
    this.clearHighlights();
    if (restoreFocus) {
      const target = this.previousFocus?.isConnected
        ? this.previousFocus
        : this.options.viewport;
      target.focus({ preventScroll: true });
    }
  }

  refreshLocale(): void {
    this.label.textContent = t("chatSearch");
    this.trigger.title = `${t("chatSearch")} (Ctrl+F / ⌘F)`;
    this.trigger.setAttribute("aria-label", this.trigger.title);
    this.bar.setAttribute("aria-label", t("chatSearch"));
    this.input.placeholder = t("chatSearchPlaceholder");
    this.input.setAttribute("aria-label", t("chatSearch"));
    this.hint.textContent = t("chatSearchScope");
    for (const [button, key] of [
      [this.previous, "chatSearchPrevious"],
      [this.next, "chatSearchNext"],
      [this.closeButton, "chatSearchClose"],
    ] as const) {
      button.title = t(key);
      button.setAttribute("aria-label", t(key));
    }
    this.updateCount();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const find =
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "f";
    const close = this.isOpen && event.key === "Escape";
    const navigate = this.isOpen && event.target === this.input && event.key === "Enter";
    if ((!find && !close && !navigate) || this.modalOpen()) return;
    event.preventDefault();
    // Escape must close find, never reach the global agent STOP handler.
    event.stopImmediatePropagation();
    if (find) this.open();
    else if (close) this.close(true);
    else this.navigate(event.shiftKey ? -1 : 1);
  }

  private refresh(reset: boolean): void {
    if (!this.isOpen) return;
    const previous = this.ranges[this.index];
    const oldIndex = this.index;
    this.ranges = collectChatSearchRanges(this.options.root, this.input.value);
    const preserved =
      !reset && previous
        ? this.ranges.findIndex(
            (range) =>
              range.startContainer === previous.startContainer &&
              range.startOffset === previous.startOffset,
          )
        : -1;
    this.index =
      this.ranges.length === 0
        ? -1
        : reset
          ? 0
          : preserved >= 0
            ? preserved
            : Math.max(0, Math.min(oldIndex, this.ranges.length - 1));
    this.paintHighlights();
    this.updateCount();
    if (reset) this.revealCurrent();
  }

  private navigate(step: number): void {
    // Flush pending mutations before navigating stale ranges.
    this.refresh(false);
    this.index = nextChatSearchIndex(this.index, this.ranges.length, step);
    this.paintHighlights();
    this.updateCount();
    this.revealCurrent();
  }

  private updateCount(): void {
    this.count.textContent = !this.input.value.trim()
      ? ""
      : this.ranges.length === 0
        ? t("chatSearchNoResults")
        : tpl(t("chatSearchCount"), {
            current: String(this.index + 1),
            total: String(this.ranges.length),
          });
    this.previous.disabled = this.next.disabled = this.ranges.length === 0;
  }

  private clearHighlights(): void {
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      CSS.highlights.delete("chat-search-matches");
      CSS.highlights.delete("chat-search-current");
    }
    const selection = window.getSelection();
    if (
      this.fallbackRange &&
      selection?.rangeCount &&
      selection.getRangeAt(0) === this.fallbackRange
    )
      selection.removeAllRanges();
    this.fallbackRange = null;
  }

  private paintHighlights(): void {
    this.clearHighlights();
    if (
      typeof Highlight === "undefined" ||
      typeof CSS === "undefined" ||
      !("highlights" in CSS)
    )
      return;
    const all = new Highlight();
    for (const range of this.ranges) all.add(range);
    CSS.highlights.set("chat-search-matches", all);
    const current = this.ranges[this.index];
    if (current) {
      const active = new Highlight(current);
      active.priority = 1;
      CSS.highlights.set("chat-search-current", active);
    }
  }

  private revealCurrent(): void {
    const range = this.ranges[this.index];
    if (!range) return;
    this.options.onNavigate();
    // Promoted tool outputs can be clipped to three lines without being hidden.
    range.startContainer.parentElement
      ?.closest(".presented-output-preview:not(.is-expanded)")
      ?.querySelector<HTMLButtonElement>(".presented-output-toggle")
      ?.click();
    if (
      typeof Highlight === "undefined" ||
      typeof CSS === "undefined" ||
      !("highlights" in CSS)
    ) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.fallbackRange = range;
    }
    const rect = range.getClientRects()[0];
    if (!rect) return;
    const viewport = this.options.viewport;
    viewport.scrollTop +=
      rect.top - viewport.getBoundingClientRect().top - viewport.clientHeight / 2;
    const pre = range.startContainer.parentElement?.closest("pre");
    if (pre && pre.scrollWidth > pre.clientWidth) {
      pre.scrollLeft +=
        rect.left - pre.getBoundingClientRect().left - pre.clientWidth / 2;
    }
  }
}
