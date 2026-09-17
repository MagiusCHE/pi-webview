export type BrowserToolOperation = "dom" | "screenshot" | "action";

export interface BrowserPersistentPermissions {
  global?: BrowserToolOperation[];
  sites?: Record<string, BrowserToolOperation[]>;
}

export interface BrowserInlineStyleValue {
  property: string;
  value: string;
  priority?: "important";
}

export type BrowserPageAction =
  | { type: "click"; selector: string; target?: "selector" | "visual" }
  | { type: "click_at"; x: number; y: number }
  | { type: "type"; selector: string; text: string; clear?: boolean }
  | { type: "select"; selector: string; value: string }
  | { type: "focus"; selector: string }
  | {
      type: "scroll";
      selector?: string;
      deltaX?: number;
      deltaY?: number;
      block?: ScrollLogicalPosition;
      inline?: ScrollLogicalPosition;
    }
  | { type: "reload" }
  | { type: "navigate"; url: string }
  | { type: "class"; selector: string; add?: string[]; remove?: string[] }
  | {
      type: "style";
      selector: string;
      set?: BrowserInlineStyleValue[];
      remove?: string[];
    };

export interface BrowserPageActionResult {
  index: number;
  type: BrowserPageAction["type"];
  selector?: string;
  x?: number;
  y?: number;
  ok: boolean;
  error?: string;
}

export interface BrowserToolPayload {
  ok: boolean;
  operation?: BrowserToolOperation;
  url?: string;
  title?: string;
  documentId?: string;
  html?: string;
  selector?: string;
  imageDataUrl?: string;
  actionResults?: BrowserPageActionResult[];
  error?: string;
}

export interface BrowserToolRequest {
  requestId: string;
  operation: BrowserToolOperation;
  actions?: BrowserPageAction[];
  selector?: string;
}

const MAX_ACTIONS = 20;
const MAX_SELECTOR_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_SCROLL_DELTA = 100_000;
const MAX_POINTER_COORDINATE = 100_000;
const MAX_CLASS_TOKENS = 100;
const MAX_CLASS_TOKEN_LENGTH = 256;
const MAX_STYLE_CHANGES = 100;
const MAX_STYLE_PROPERTY_LENGTH = 128;
const MAX_STYLE_VALUE_LENGTH = 2_000;
const MAX_NAVIGATION_URL_LENGTH = 8_192;
const SCROLL_POSITIONS = new Set<ScrollLogicalPosition>([
  "start",
  "center",
  "end",
  "nearest",
]);

function boundedString(
  value: unknown,
  name: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new Error(`${name} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
  if (value.length > maxLength) throw new Error(`${name} is too long.`);
  return value;
}

export function normalizeBrowserElementSelector(value: unknown): string {
  return boundedString(value, "selector", MAX_SELECTOR_LENGTH);
}

function stringArray(
  value: unknown,
  name: string,
  maxItems: number,
  normalize: (item: unknown, itemName: string) => string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${name} must be an array with at most ${maxItems} items.`);
  }
  return value.map((item, index) => normalize(item, `${name}[${index}]`));
}

function classToken(value: unknown, name: string): string {
  const token = boundedString(value, name, MAX_CLASS_TOKEN_LENGTH);
  if (/\s/.test(token)) throw new Error(`${name} must be one CSS class token.`);
  return token;
}

function styleProperty(value: unknown, name: string): string {
  const property = boundedString(value, name, MAX_STYLE_PROPERTY_LENGTH);
  if (!/^(?:--[a-z0-9_-]+|-?[a-z][a-z0-9-]*)$/i.test(property)) {
    throw new Error(`${name} is not a valid CSS property name.`);
  }
  return property;
}

function styleValues(
  value: unknown,
  name: string,
): BrowserInlineStyleValue[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_STYLE_CHANGES) {
    throw new Error(`${name} must be an array with at most ${MAX_STYLE_CHANGES} items.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`${name}[${index}] must be an object.`);
    }
    const candidate = item as Record<string, unknown>;
    if (candidate.priority !== undefined && candidate.priority !== "important") {
      throw new Error(`${name}[${index}].priority must be important when provided.`);
    }
    return {
      property: styleProperty(candidate.property, `${name}[${index}].property`),
      value: boundedString(
        candidate.value,
        `${name}[${index}].value`,
        MAX_STYLE_VALUE_LENGTH,
        true,
      ),
      ...(candidate.priority === "important" ? { priority: "important" as const } : {}),
    };
  });
}

function scrollPosition(value: unknown, name: string): ScrollLogicalPosition | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !SCROLL_POSITIONS.has(value as ScrollLogicalPosition)
  ) {
    throw new Error(`${name} must be start, center, end or nearest.`);
  }
  return value as ScrollLogicalPosition;
}

function navigationUrl(value: unknown, name: string): string {
  const input = boundedString(value, name, MAX_NAVIGATION_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http:// or https://.`);
  }
  return url.toString();
}

function pointerCoordinate(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_POINTER_COORDINATE
  ) {
    throw new Error(`${name} must be a finite number between 0 and 100000.`);
  }
  return value;
}

function optionalScrollDelta(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_SCROLL_DELTA
  ) {
    throw new Error(`${name} must be a finite number between -100000 and 100000.`);
  }
  return value;
}

export type BrowserNavigationAction = Extract<
  BrowserPageAction,
  { type: "reload" | "navigate" }
>;

/** Returns a navigation only when it is the complete action sequence. */
export function isolatedBrowserNavigationAction(
  actions: BrowserPageAction[],
): BrowserNavigationAction | undefined {
  const navigation = actions.find(
    (action): action is BrowserNavigationAction =>
      action.type === "reload" || action.type === "navigate",
  );
  if (navigation && actions.length !== 1) {
    throw new Error("Navigation must be the only action in its sequence.");
  }
  return navigation;
}

export function normalizeBrowserPageActions(value: unknown): BrowserPageAction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ACTIONS) {
    throw new Error(`actions must contain between 1 and ${MAX_ACTIONS} items.`);
  }
  return value.map((entry, index): BrowserPageAction => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`actions[${index}] must be an object.`);
    }
    const action = entry as Record<string, unknown>;
    switch (action.type) {
      case "click": {
        if (
          action.target !== undefined &&
          action.target !== "selector" &&
          action.target !== "visual"
        ) {
          throw new Error(
            `actions[${index}].target must be selector or visual when provided.`,
          );
        }
        return {
          type: "click",
          selector: boundedString(
            action.selector,
            `actions[${index}].selector`,
            MAX_SELECTOR_LENGTH,
          ),
          ...(action.target ? { target: action.target } : {}),
        };
      }
      case "click_at":
        return {
          type: "click_at",
          x: pointerCoordinate(action.x, `actions[${index}].x`),
          y: pointerCoordinate(action.y, `actions[${index}].y`),
        };
      case "focus":
        return {
          type: "focus",
          selector: boundedString(
            action.selector,
            `actions[${index}].selector`,
            MAX_SELECTOR_LENGTH,
          ),
        };
      case "type":
        return {
          type: "type",
          selector: boundedString(
            action.selector,
            `actions[${index}].selector`,
            MAX_SELECTOR_LENGTH,
          ),
          text: boundedString(
            action.text,
            `actions[${index}].text`,
            MAX_TEXT_LENGTH,
            true,
          ),
          ...(typeof action.clear === "boolean" ? { clear: action.clear } : {}),
        };
      case "select":
        return {
          type: "select",
          selector: boundedString(
            action.selector,
            `actions[${index}].selector`,
            MAX_SELECTOR_LENGTH,
          ),
          value: boundedString(
            action.value,
            `actions[${index}].value`,
            MAX_TEXT_LENGTH,
            true,
          ),
        };
      case "scroll": {
        const selector =
          action.selector === undefined
            ? undefined
            : boundedString(
                action.selector,
                `actions[${index}].selector`,
                MAX_SELECTOR_LENGTH,
              );
        const deltaX = optionalScrollDelta(action.deltaX, `actions[${index}].deltaX`);
        const deltaY = optionalScrollDelta(action.deltaY, `actions[${index}].deltaY`);
        const block = scrollPosition(action.block, `actions[${index}].block`);
        const inline = scrollPosition(action.inline, `actions[${index}].inline`);
        const intoView = deltaX === undefined && deltaY === undefined;
        if (intoView && !selector) {
          throw new Error(
            `actions[${index}] scroll requires a selector or deltaX/deltaY.`,
          );
        }
        if (!intoView && (block !== undefined || inline !== undefined)) {
          throw new Error(
            `actions[${index}] block and inline apply only to selector-only scrolling.`,
          );
        }
        return {
          type: "scroll",
          ...(selector ? { selector } : {}),
          ...(deltaX !== undefined ? { deltaX } : {}),
          ...(deltaY !== undefined ? { deltaY } : {}),
          ...(intoView && block ? { block } : {}),
          ...(intoView && inline ? { inline } : {}),
        };
      }
      case "reload":
        return { type: "reload" };
      case "navigate":
        return {
          type: "navigate",
          url: navigationUrl(action.url, `actions[${index}].url`),
        };
      case "class": {
        const add = stringArray(
          action.add,
          `actions[${index}].add`,
          MAX_CLASS_TOKENS,
          classToken,
        );
        const remove = stringArray(
          action.remove,
          `actions[${index}].remove`,
          MAX_CLASS_TOKENS,
          classToken,
        );
        if ((add?.length ?? 0) === 0 && (remove?.length ?? 0) === 0) {
          throw new Error(`actions[${index}] class requires add or remove tokens.`);
        }
        return {
          type: "class",
          selector: boundedString(
            action.selector,
            `actions[${index}].selector`,
            MAX_SELECTOR_LENGTH,
          ),
          ...(add?.length ? { add } : {}),
          ...(remove?.length ? { remove } : {}),
        };
      }
      case "style": {
        const set = styleValues(action.set, `actions[${index}].set`);
        const remove = stringArray(
          action.remove,
          `actions[${index}].remove`,
          MAX_STYLE_CHANGES,
          styleProperty,
        );
        if ((set?.length ?? 0) === 0 && (remove?.length ?? 0) === 0) {
          throw new Error(`actions[${index}] style requires set or remove entries.`);
        }
        return {
          type: "style",
          selector: boundedString(
            action.selector,
            `actions[${index}].selector`,
            MAX_SELECTOR_LENGTH,
          ),
          ...(set?.length ? { set } : {}),
          ...(remove?.length ? { remove } : {}),
        };
      }
      default:
        throw new Error(`actions[${index}].type is not supported.`);
    }
  });
}
