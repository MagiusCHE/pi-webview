export type BrowserToolOperation = "dom" | "screenshot" | "action";

export type BrowserPageAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string; clear?: boolean }
  | { type: "select"; selector: string; value: string }
  | { type: "focus"; selector: string }
  | { type: "scroll"; selector?: string; deltaX?: number; deltaY?: number };

export interface BrowserPageActionResult {
  index: number;
  type: BrowserPageAction["type"];
  selector?: string;
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
  imageDataUrl?: string;
  actionResults?: BrowserPageActionResult[];
  error?: string;
}

export interface BrowserToolRequest {
  requestId: string;
  operation: BrowserToolOperation;
  actions?: BrowserPageAction[];
}

const MAX_ACTIONS = 20;
const MAX_SELECTOR_LENGTH = 2_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_SCROLL_DELTA = 100_000;

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
      case "click":
      case "focus":
        return {
          type: action.type,
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
        if (deltaX === undefined && deltaY === undefined) {
          throw new Error(`actions[${index}] scroll requires deltaX or deltaY.`);
        }
        return {
          type: "scroll",
          ...(selector ? { selector } : {}),
          ...(deltaX !== undefined ? { deltaX } : {}),
          ...(deltaY !== undefined ? { deltaY } : {}),
        };
      }
      default:
        throw new Error(`actions[${index}].type is not supported.`);
    }
  });
}
