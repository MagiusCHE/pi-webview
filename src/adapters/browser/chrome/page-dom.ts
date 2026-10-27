// Compact, privacy-aware DOM view for the Chrome companion. Injected in the
// page's main world with chrome.scripting.executeScript, so it must stay
// self-contained: no imports and no outer references.
//
// The compact view lists the controls a user can actually see and operate, with
// accessible labels and stable selectors, and never serializes script, style,
// template, noscript or svg content. Attribute collection is an allowlist and
// values are redacted, so tokens, CSRF fields and prefilled secrets do not leak
// into the conversation by default. The complete serialized DOM remains
// available as an explicit mode.

export interface PageDomCompactRequest {
  /** Only serialize elements considered visible on screen. */
  visibleOnly?: boolean;
  /** Include non-interactive text blocks as context hints. */
  includeText?: boolean;
  /** Hard cap on reported nodes. */
  limit?: number;
}

export interface PageDomCompactNode {
  selector: string;
  /** True when the selector matches more than one element in the document. */
  ambiguous?: boolean;
  tag: string;
  role?: string;
  label?: string;
  kind?:
    "button" | "link" | "field" | "checkbox" | "select" | "textarea" | "heading" | "text";
  value?: string;
  state?: string;
  visible: boolean;
}

export interface PageDomCompactResult {
  ok: boolean;
  url?: string;
  title?: string;
  nodes?: PageDomCompactNode[];
  total?: number;
  omitted?: number;
  error?: string;
}

export function serializePageDomCompact(
  request: PageDomCompactRequest,
): PageDomCompactResult {
  const MAX_NODES = Math.min(Math.max(request.limit ?? 400, 1), 2_000);
  const MAX_LABEL = 160;
  const MAX_VALUE = 80;
  const SKIP_TAGS = new Set([
    "script",
    "style",
    "template",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "link",
    "meta",
    "head",
  ]);
  const SECRET_HINT =
    /(passw|passwd|secret|token|csrf|xsrf|auth|session|cookie|apikey|api[_-]key|otp|mfa|credit|card|cvv)/i;
  const SECRET_TEXT =
    /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

  // An element is hidden when its own computed style blocks rendering. This is
  // the only safe prune: `display: contents` wrappers have no box of their own
  // but their children do render, so their subtree must never be skipped.
  const isBlocked = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    );
  };

  const hiddenByAncestor = (element: Element): boolean =>
    Boolean(element.closest("[hidden], [aria-hidden='true'], [inert]"));

  const hasRenderedBox = (element: Element): boolean => {
    if (element.getClientRects().length > 0) return true;
    if (getComputedStyle(element).display !== "contents") return false;
    return Array.from(element.children).some(
      (child) => child.getClientRects().length > 0,
    );
  };

  const isOnScreen = (element: Element): boolean => {
    const rects = Array.from(element.getClientRects());
    if (rects.length === 0) {
      const box = element.getBoundingClientRect();
      return box.right > 0 && box.bottom > 0;
    }
    return rects.some((rect) => rect.right > 0 && rect.bottom > 0);
  };

  const isVisible = (element: Element): boolean =>
    !isBlocked(element) &&
    !hiddenByAncestor(element) &&
    hasRenderedBox(element) &&
    isOnScreen(element);

  const clean = (value: string | null | undefined): string | undefined => {
    if (!value) return undefined;
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    if (SECRET_TEXT.test(text)) return "[redacted]";
    return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL)}…` : text;
  };

  const labelOf = (element: Element): string | undefined => {
    const aria = clean(element.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => clean(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ");
      if (text) return text;
    }
    const id = element.id;
    if (id) {
      const explicit = Array.from(document.querySelectorAll("label")).find(
        (label) => label.htmlFor === id,
      );
      const text = clean(explicit?.textContent);
      if (text) return text;
    }
    const wrapping = element.closest("label");
    const wrappingText = clean(wrapping?.textContent);
    if (wrappingText) return wrappingText;
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return (
        clean(element.getAttribute("placeholder")) ??
        clean(element.getAttribute("title")) ??
        clean(element.getAttribute("name"))
      );
    }
    const title = clean(element.getAttribute("title"));
    if (title) return title;
    const alt = clean(element.getAttribute("alt"));
    if (alt) return alt;
    return clean(element.textContent);
  };

  interface SelectorInfo {
    selector: string;
    ambiguous: boolean;
  }

  const matchesOf = (selector: string): number => {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return -1;
    }
  };

  // Deterministic and stable between calls: verified CSS paths only. The page is
  // never mutated to describe it, and no generated attribute is reused (an id
  // from a previous call can collide with a node still kept in the DOM).
  const selectorOf = (element: Element): SelectorInfo => {
    if (element.id) {
      const candidate = `#${CSS.escape(element.id)}`;
      if (matchesOf(candidate) === 1) return { selector: candidate, ambiguous: false };
    }
    const testId = element.getAttribute("data-testid");
    if (testId) {
      const candidate = `${element.tagName.toLowerCase()}[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      if (matchesOf(candidate) === 1) return { selector: candidate, ambiguous: false };
    }
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      const tag = current.tagName.toLowerCase();
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === current?.tagName,
      );
      const index =
        siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
      parts.unshift(`${tag}${index}`);
      const candidate = parts.join(" > ");
      if (matchesOf(candidate) === 1) return { selector: candidate, ambiguous: false };
      // prefer anchoring to the nearest uniquely identified ancestor
      if (parent.id && matchesOf(`#${CSS.escape(parent.id)}`) === 1) {
        const anchored = `#${CSS.escape(parent.id)} > ${parts.join(" > ")}`;
        if (matchesOf(anchored) === 1) {
          return { selector: anchored, ambiguous: false };
        }
      }
      current = parent;
    }
    const candidate = parts.join(" > ") || element.tagName.toLowerCase();
    return { selector: candidate, ambiguous: matchesOf(candidate) !== 1 };
  };

  const stateOf = (element: Element): string | undefined => {
    const states: string[] = [];
    if (element.matches(":disabled, [aria-disabled='true']")) states.push("disabled");
    if (element instanceof HTMLInputElement) {
      if (element.readOnly) states.push("readonly");
      if (element.required) states.push("required");
      if (element.type === "checkbox" || element.type === "radio") {
        states.push(element.checked ? "checked" : "unchecked");
      }
    }
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      if (element.disabled) states.push("disabled");
    }
    if (element.getAttribute("aria-expanded")) {
      states.push(`expanded=${element.getAttribute("aria-expanded")}`);
    }
    if (element.getAttribute("aria-selected")) {
      states.push(`selected=${element.getAttribute("aria-selected")}`);
    }
    return states.length > 0 ? states.join(",") : undefined;
  };

  const valueOf = (element: Element): string | undefined => {
    if (element instanceof HTMLInputElement) {
      const type = element.type;
      if (type === "password" || type === "hidden" || SECRET_HINT.test(element.name)) {
        return element.value ? "[redacted]" : undefined;
      }
      if (type === "checkbox" || type === "radio") return undefined;
      if (element.value) return `"${element.value.slice(0, MAX_VALUE)}"`;
      return undefined;
    }
    if (element instanceof HTMLTextAreaElement) {
      if (!element.value) return undefined;
      return SECRET_HINT.test(element.name)
        ? "[redacted]"
        : `"${element.value.slice(0, MAX_VALUE)}"`;
    }
    if (element instanceof HTMLSelectElement) {
      const option = element.selectedOptions[0];
      return option
        ? `"${option.textContent?.trim().slice(0, MAX_VALUE) ?? ""}"`
        : undefined;
    }
    return undefined;
  };

  const kindOf = (element: Element): PageDomCompactNode["kind"] => {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") ?? "";
    if (tag === "a") return "link";
    if (tag === "button" || role === "button") return "button";
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "input") {
      const type = (element as HTMLInputElement).type;
      if (type === "checkbox" || type === "radio") return "checkbox";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      if (type === "hidden") return undefined;
      return "field";
    }
    if (role === "checkbox" || role === "switch") return "checkbox";
    if (role === "textbox" || role === "searchbox" || role === "combobox") return "field";
    if (role === "link") return "link";
    if (/^h[1-6]$/.test(tag) || role === "heading") return "heading";
    if (element.hasAttribute("contenteditable")) return "textarea";
    return undefined;
  };

  const collect = (): PageDomCompactNode[] => {
    const nodes: PageDomCompactNode[] = [];
    let total = 0;
    const walk = (element: Element): void => {
      for (const child of Array.from(element.children)) {
        const tag = child.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) continue;
        total += 1;
        const kind = kindOf(child);
        const visible = isVisible(child);
        const wanted =
          kind !== undefined || (request.includeText && clean(child.textContent));
        if (wanted && (!request.visibleOnly || visible)) {
          const located = selectorOf(child);
          const node: PageDomCompactNode = {
            selector: located.selector,
            tag,
            visible,
            ...(located.ambiguous ? { ambiguous: true } : {}),
          };
          const role = child.getAttribute("role");
          if (role) node.role = role;
          const label = labelOf(child);
          if (label) node.label = label;
          if (kind) node.kind = kind;
          const value = valueOf(child);
          if (value) node.value = value;
          const state = stateOf(child);
          if (state) node.state = state;
          nodes.push(node);
        }
        // prune only what cannot render: `display: contents` wrappers and
        // off-screen boxes still contain the visible controls we must report
        if (!isBlocked(child)) walk(child);
        if (nodes.length >= MAX_NODES) return;
      }
    };
    walk(document.body ?? document.documentElement);
    return nodes;
  };

  try {
    const nodes = collect();
    return {
      ok: true,
      url: location.href,
      title: document.title,
      nodes: nodes.slice(0, MAX_NODES),
      total: nodes.length,
      ...(nodes.length > MAX_NODES ? { omitted: nodes.length - MAX_NODES } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
