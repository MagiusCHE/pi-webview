import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBrowserPageActions,
  type BrowserPageAction,
} from "../src/ide/browser-tools.ts";
import {
  BrowserReadConsentStore,
  browserReadConsentKey,
} from "../src/web/browser-tool-consent.ts";

const origin = "https://example.test";

test("DOM and screenshot consents are independent per origin", async () => {
  assert.notEqual(
    browserReadConsentKey(origin, "dom"),
    browserReadConsentKey(origin, "screenshot"),
  );
  const store = new BrowserReadConsentStore();
  let prompts = 0;
  const confirm = async () => {
    prompts += 1;
    return true;
  };

  assert.equal(await store.allow(origin, "dom", confirm), true);
  assert.equal(await store.allow(origin, "dom", confirm), true);
  assert.equal(prompts, 1);
  assert.equal(await store.allow(origin, "screenshot", confirm), true);
  assert.equal(prompts, 2);
});

test("concurrent consent requests share only the same operation prompt", async () => {
  const store = new BrowserReadConsentStore();
  let resolveConsent: ((value: boolean) => void) | undefined;
  let prompts = 0;
  const confirm = () => {
    prompts += 1;
    return new Promise<boolean>((resolve) => {
      resolveConsent = resolve;
    });
  };
  const first = store.allow(origin, "screenshot", confirm);
  const second = store.allow(origin, "screenshot", confirm);
  assert.equal(prompts, 1);
  resolveConsent?.(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("browser page actions are normalized without accepting executable code", () => {
  const actions: BrowserPageAction[] = normalizeBrowserPageActions([
    { type: "type", selector: "textarea[name=post]", text: "Hello", clear: true },
    { type: "click", selector: "button[type=submit]" },
    { type: "scroll", deltaY: 500 },
  ]);
  assert.equal(actions.length, 3);
  assert.deepEqual(actions[0], {
    type: "type",
    selector: "textarea[name=post]",
    text: "Hello",
    clear: true,
  });
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "javascript", code: "alert(1)" }]),
    /not supported/,
  );
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "scroll" }]),
    /requires deltaX or deltaY/,
  );
  assert.throws(
    () =>
      normalizeBrowserPageActions(new Array(21).fill({ type: "focus", selector: "x" })),
    /between 1 and 20/,
  );
});
