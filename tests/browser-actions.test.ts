import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBrowserElementSelector,
  normalizeBrowserPageActions,
  type BrowserPageAction,
} from "../src/ide/browser-tools.ts";
import {
  browserToolPermissionGranted,
  grantBrowserPersistentPermission,
  grantBrowserSessionPermission,
  hasBrowserPersistentPermissions,
  normalizeBrowserPersistentPermissions,
} from "../src/web/browser-tool-consent.ts";

const origin = "https://example.test";

test("browser permissions remain independent by operation", () => {
  const session = grantBrowserSessionPermission([], "dom");
  assert.equal(browserToolPermissionGranted("dom", origin, session, {}), true);
  assert.equal(browserToolPermissionGranted("screenshot", origin, session, {}), false);
  assert.equal(browserToolPermissionGranted("action", origin, session, {}), false);
});

test("session, site and global browser permission scopes are distinct", () => {
  const site = grantBrowserPersistentPermission({}, "screenshot", origin, "site");
  assert.equal(browserToolPermissionGranted("screenshot", origin, [], site), true);
  assert.equal(
    browserToolPermissionGranted("screenshot", "https://other.test", [], site),
    false,
  );

  const global = grantBrowserPersistentPermission(site, "action", origin, "global");
  assert.equal(
    browserToolPermissionGranted("action", "https://other.test", [], global),
    true,
  );
  assert.equal(hasBrowserPersistentPermissions(global), true);
});

test("browser permission config drops malformed operations and origins", () => {
  assert.deepEqual(
    normalizeBrowserPersistentPermissions({
      global: ["dom", "javascript"],
      sites: {
        [origin]: ["action", "eval"],
        "not an origin": ["screenshot"],
      },
    }),
    { global: ["dom"], sites: { [origin]: ["action"] } },
  );
  assert.equal(hasBrowserPersistentPermissions({}), false);
});

test("browser page actions are normalized without accepting executable code", () => {
  const actions: BrowserPageAction[] = normalizeBrowserPageActions([
    { type: "type", selector: "textarea[name=post]", text: "Hello", clear: true },
    { type: "click", selector: "button[type=submit]" },
    { type: "click", selector: "#checkbox", target: "visual" },
    { type: "click_at", x: 240.5, y: 180 },
    { type: "scroll", deltaY: 500 },
    { type: "scroll", selector: "#target", block: "center", inline: "nearest" },
    { type: "reload" },
    { type: "navigate", url: "https://example.test/next?q=1" },
    {
      type: "class",
      selector: "#dialog",
      add: ["open"],
      remove: ["hidden"],
    },
    {
      type: "style",
      selector: "#dialog",
      set: [{ property: "display", value: "block", priority: "important" }],
      remove: ["pointer-events"],
    },
  ]);
  assert.equal(actions.length, 10);
  assert.deepEqual(actions[0], {
    type: "type",
    selector: "textarea[name=post]",
    text: "Hello",
    clear: true,
  });
  assert.deepEqual(actions[2], {
    type: "click",
    selector: "#checkbox",
    target: "visual",
  });
  assert.deepEqual(actions[3], { type: "click_at", x: 240.5, y: 180 });
  assert.deepEqual(actions[5], {
    type: "scroll",
    selector: "#target",
    block: "center",
    inline: "nearest",
  });
  assert.deepEqual(actions[6], { type: "reload" });
  assert.deepEqual(actions[7], {
    type: "navigate",
    url: "https://example.test/next?q=1",
  });
  assert.deepEqual(actions[8], {
    type: "class",
    selector: "#dialog",
    add: ["open"],
    remove: ["hidden"],
  });
  assert.deepEqual(actions[9], {
    type: "style",
    selector: "#dialog",
    set: [{ property: "display", value: "block", priority: "important" }],
    remove: ["pointer-events"],
  });
  assert.equal(normalizeBrowserElementSelector("main > form"), "main > form");
  assert.throws(() => normalizeBrowserElementSelector(""), /non-empty/);
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "javascript", code: "alert(1)" }]),
    /not supported/,
  );
  assert.throws(
    () =>
      normalizeBrowserPageActions([
        { type: "click", selector: "#target", target: "coordinates" },
      ]),
    /must be selector or visual/,
  );
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "click_at", x: -1, y: 20 }]),
    /between 0 and 100000/,
  );
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "scroll" }]),
    /requires a selector or deltaX\/deltaY/,
  );
  assert.throws(
    () =>
      normalizeBrowserPageActions(new Array(21).fill({ type: "focus", selector: "x" })),
    /between 1 and 20/,
  );
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "scroll", deltaY: 10, block: "center" }]),
    /apply only to selector-only scrolling/,
  );
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "navigate", url: "javascript:alert(1)" }]),
    /must use http:\/\/ or https:\/\//,
  );
  assert.throws(
    () => normalizeBrowserPageActions([{ type: "class", selector: "x" }]),
    /requires add or remove/,
  );
  assert.throws(
    () =>
      normalizeBrowserPageActions([
        {
          type: "style",
          selector: "x",
          set: [{ property: "not valid", value: "block" }],
        },
      ]),
    /not a valid CSS property/,
  );
});
