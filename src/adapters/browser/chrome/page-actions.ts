// Structured page actions executed in the page's own main world. The whole
// module is bundled by the Chrome companion and injected with
// chrome.scripting.executeScript({ world: "MAIN" }), so executePageActions must
// stay self-contained: no imports at runtime and no outer references.

import type {
  BrowserPageAction,
  BrowserPageActionResult,
} from "../../../ide/browser-tools.ts";

export async function executePageActions(
  actions: BrowserPageAction[],
): Promise<BrowserPageActionResult[]> {
  const results: BrowserPageActionResult[] = [];
  // Synthetic events must be cancelable: with the MouseEvent/PointerEvent
  // constructor default (cancelable: false) a page preventDefault() is a no-op
  // and the browser still runs the activation behavior (form submit, hash
  // change, navigation), duplicating or forcing the default action.
  const eventOptions = { bubbles: true, composed: true, cancelable: true };
  const hoverOptions = { bubbles: true, composed: true };
  const enterOptions = { composed: true };
  // requestAnimationFrame is paused for background or occluded tabs, so waiting
  // for two frames before dispatching can hang forever (and turn into a bridge
  // timeout even though the page is fine). The wait is bounded: after the budget
  // the action proceeds with the current layout.
  const SETTLE_BUDGET_MS = 250;
  const settlePageFrames = () =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (framesRendered: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(framesRendered);
      };
      const timer = setTimeout(() => finish(false), SETTLE_BUDGET_MS);
      requestAnimationFrame(() => requestAnimationFrame(() => finish(true)));
    });
  const normalizedEditableText = (value: string) =>
    value.replace(/[\u200b\u2060]/g, "").replace(/\u00a0/g, " ");
  const describeElement = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    for (let depth = 0; depth < 3 && current; depth += 1) {
      const tag = current.tagName.toLowerCase();
      const id = current.id ? `#${current.id}` : "";
      const type = current.getAttribute("type");
      const role = current.getAttribute("role");
      const classes = (current.getAttribute("class") ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((token) => `.${token}`)
        .join("");
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(
            (sibling) => sibling.tagName === current?.tagName,
          )
        : [];
      const index =
        siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
      parts.unshift(
        `${tag}${id}${classes}${type ? `[type=${type}]` : ""}${role ? `[role=${role}]` : ""}${index}`,
      );
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const dispatchPointerClick = (
    target: Element,
    clientX: number,
    clientY: number,
    suppressDefault: boolean,
  ): { defaultPrevented: boolean; suppressed: boolean } => {
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    const pointer = {
      ...eventOptions,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      clientX,
      clientY,
      button: 0,
    };
    const hover = { ...hoverOptions, clientX, clientY, pointerId: 1, isPrimary: true };
    const mouse = {
      ...eventOptions,
      clientX,
      clientY,
      button: 0,
      detail: 1,
      view: window,
    };
    target.dispatchEvent(new PointerEvent("pointerover", hover));
    target.dispatchEvent(new MouseEvent("mouseover", hover));
    target.dispatchEvent(new PointerEvent("pointerenter", { ...enterOptions, ...hover }));
    target.dispatchEvent(new MouseEvent("mouseenter", { ...enterOptions, ...hover }));
    target.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    target.dispatchEvent(new MouseEvent("mousedown", { ...mouse, buttons: 1 }));
    target.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...mouse, buttons: 0 }));
    const click = new MouseEvent("click", { ...mouse, buttons: 0 });
    // dispatchEvent resets the canceled flag, so a requested suppression must be
    // applied during propagation; the capture listener runs before page handlers
    // and only for this exact event object.
    const suppress = (event: Event): void => {
      if (event === click) click.preventDefault();
    };
    if (suppressDefault) window.addEventListener("click", suppress, true);
    try {
      target.dispatchEvent(click);
    } finally {
      if (suppressDefault) window.removeEventListener("click", suppress, true);
    }
    // defaultPrevented is true when the page canceled the activation or when the
    // suppression was requested: no submit, hash change or navigation will run
    return { defaultPrevented: click.defaultPrevented, suppressed: suppressDefault };
  };

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]!;
    let defaultPrevented: boolean | undefined;
    let defaultActionSuppressed: boolean | undefined;
    let clickedTarget: string | undefined;
    let requestedTarget: string | undefined;
    let rafTimedOut: boolean | undefined;
    let visualHitMismatch: boolean | undefined;
    try {
      if (action.type === "reload" || action.type === "navigate") {
        throw new Error("Navigation actions must be handled by the browser host.");
      }
      const selector = "selector" in action ? action.selector : undefined;
      const allowAmbiguous = "allowAmbiguous" in action && action.allowAmbiguous === true;
      if (selector && !allowAmbiguous) {
        let matches = 0;
        try {
          matches = document.querySelectorAll(selector).length;
        } catch {
          throw new Error(`The selector ${selector} is not valid CSS.`);
        }
        if (matches > 1) {
          throw new Error(
            `${selector} matches ${matches} elements: refusing an ambiguous target. ` +
              "Use a unique selector from browser_page_dom (it reports `ambiguous: true` when it cannot build one) " +
              "or pass allowAmbiguous to act on the first match on purpose.",
          );
        }
      }
      const element = selector ? document.querySelector(selector) : undefined;
      if (selector && !(element instanceof HTMLElement)) {
        throw new Error(`No HTML element matches ${selector}`);
      }
      if (element instanceof Element) requestedTarget = describeElement(element);
      if (action.type === "click") {
        const selected = element as HTMLElement;
        selected.scrollIntoView({ block: "center", inline: "center" });
        if (!(await settlePageFrames())) rafTimedOut = true;
        const rect = selected.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          throw new Error("The target element is not visible.");
        }
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(clientX, clientY);
        const target =
          hit instanceof Element && (action.target === "visual" || selected.contains(hit))
            ? hit
            : selected;
        const clickResult = dispatchPointerClick(
          target,
          clientX,
          clientY,
          action.defaultAction === "suppress",
        );
        defaultPrevented = clickResult.defaultPrevented;
        defaultActionSuppressed = clickResult.suppressed;
        clickedTarget = describeElement(target);
        visualHitMismatch = Boolean(
          element instanceof Element && target !== element && !element.contains(target),
        );
      } else if (action.type === "click_at") {
        if (action.x >= window.innerWidth || action.y >= window.innerHeight) {
          throw new Error("The click coordinates are outside the current viewport.");
        }
        const target = document.elementFromPoint(action.x, action.y);
        if (!(target instanceof Element)) {
          throw new Error("No page element exists at the requested coordinates.");
        }
        const clickResult = dispatchPointerClick(
          target,
          action.x,
          action.y,
          action.defaultAction === "suppress",
        );
        defaultPrevented = clickResult.defaultPrevented;
        defaultActionSuppressed = clickResult.suppressed;
        clickedTarget = describeElement(target);
      } else if (action.type === "focus") {
        (element as HTMLElement).focus();
      } else if (action.type === "type") {
        const target = element as HTMLElement;
        const clear = action.clear !== false;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const current = clear ? "" : target.value;
          const prototype =
            target instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (!setter) throw new Error("The field value cannot be changed.");
          target.focus();
          setter.call(target, current + action.text);
          target.dispatchEvent(
            new InputEvent("input", { ...eventOptions, data: action.text }),
          );
          target.dispatchEvent(new Event("change", eventOptions));
        } else if (target.isContentEditable) {
          const editable = target.closest<HTMLElement>('[contenteditable="true"]');
          if (!editable) throw new Error("The editable root cannot be found.");
          const beforeText = normalizedEditableText(editable.textContent ?? "");
          const range = document.createRange();
          range.selectNodeContents(clear ? editable : target);
          if (!clear) range.collapse(false);
          editable.focus({ preventScroll: true });
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange", eventOptions));

          const beforeInput = new InputEvent("beforeinput", {
            ...eventOptions,
            cancelable: true,
            data: action.text,
            inputType: "insertText",
          });
          if (typeof StaticRange === "function") {
            const targetRange = new StaticRange({
              startContainer: range.startContainer,
              startOffset: range.startOffset,
              endContainer: range.endContainer,
              endOffset: range.endOffset,
            });
            Object.defineProperty(beforeInput, "getTargetRanges", {
              value: () => [targetRange],
            });
          }
          editable.dispatchEvent(beforeInput);

          if (!beforeInput.defaultPrevented) {
            const inserted = document.execCommand("insertText", false, action.text);
            if (!inserted) {
              range.deleteContents();
              const text = document.createTextNode(action.text);
              range.insertNode(text);
              range.setStartAfter(text);
              range.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(range);
              editable.dispatchEvent(
                new InputEvent("input", {
                  ...eventOptions,
                  data: action.text,
                  inputType: "insertText",
                }),
              );
            }
          }

          await settlePageFrames();
          const afterText = normalizedEditableText(editable.textContent ?? "");
          const expectedText = normalizedEditableText(action.text);
          const changed = afterText !== beforeText;
          const retained = clear
            ? expectedText.length === 0
              ? afterText.trim().length === 0
              : afterText.includes(expectedText)
            : expectedText.length === 0 ||
              (changed && afterText.length >= beforeText.length + expectedText.length);
          if (!retained) {
            throw new Error("The contenteditable editor rejected the text insertion.");
          }
        } else {
          throw new Error("The target is not an editable field.");
        }
      } else if (action.type === "select") {
        if (!(element instanceof HTMLSelectElement)) {
          throw new Error("The target is not a select element.");
        }
        if (![...element.options].some((option) => option.value === action.value)) {
          throw new Error(`The select has no option with value ${action.value}`);
        }
        element.focus();
        element.value = action.value;
        element.dispatchEvent(new Event("input", eventOptions));
        element.dispatchEvent(new Event("change", eventOptions));
      } else if (action.type === "class") {
        const target = element as HTMLElement;
        if (action.remove?.length) target.classList.remove(...action.remove);
        if (action.add?.length) target.classList.add(...action.add);
      } else if (action.type === "style") {
        const target = element as HTMLElement;
        for (const property of action.remove ?? []) {
          target.style.removeProperty(property);
        }
        for (const value of action.set ?? []) {
          target.style.setProperty(value.property, value.value, value.priority ?? "");
        }
      } else {
        const deltaX = action.deltaX;
        const deltaY = action.deltaY;
        if (element && deltaX === undefined && deltaY === undefined) {
          element.scrollIntoView({
            behavior: "auto",
            block: action.block ?? "center",
            inline: action.inline ?? "nearest",
          });
        } else if (element) {
          element.scrollBy({
            left: deltaX ?? 0,
            top: deltaY ?? 0,
            behavior: "auto",
          });
        } else {
          window.scrollBy({
            left: deltaX ?? 0,
            top: deltaY ?? 0,
            behavior: "auto",
          });
        }
      }
      results.push({
        index,
        type: action.type,
        ...(selector ? { selector } : {}),
        ...(action.type === "click_at" ? { x: action.x, y: action.y } : {}),
        ...(defaultPrevented === undefined ? {} : { defaultPrevented }),
        ...(defaultActionSuppressed ? { defaultActionSuppressed } : {}),
        ...(clickedTarget ? { target: clickedTarget } : {}),
        ...(requestedTarget ? { requestedTarget } : {}),
        ...(visualHitMismatch === undefined ? {} : { visualHitMismatch }),
        ...(rafTimedOut ? { rafTimedOut: true } : {}),
        ...(clickedTarget
          ? {
              hash: location.hash,
              outcome: defaultActionSuppressed
                ? "suppressed"
                : defaultPrevented
                  ? "canceled"
                  : "dispatched",
            }
          : {}),
        ok: true,
      });
    } catch (error) {
      const selector = "selector" in action ? action.selector : undefined;
      results.push({
        index,
        type: action.type,
        ...(selector ? { selector } : {}),
        ...(action.type === "click_at" ? { x: action.x, y: action.y } : {}),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  return results;
}
