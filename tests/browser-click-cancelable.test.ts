import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pageActions = readFileSync("src/adapters/browser/chrome/page-actions.ts", "utf8");
const serviceWorker = readFileSync(
  "src/adapters/browser/chrome/service-worker.ts",
  "utf8",
);

test("page clicks build cancelable events so page preventDefault works", () => {
  // MouseEvent/PointerEvent default to cancelable: false: without this flag a
  // page preventDefault() is a no-op and the browser still submits or navigates
  assert.match(pageActions, /cancelable: true/);
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    assert.match(
      pageActions,
      new RegExp(
        `new (?:MouseEvent|PointerEvent)\\("${type}", \\{ \\.\\.\\.(?:pointer|mouse)`,
      ),
      `${type} must be dispatched with the cancelable options`,
    );
  }
});

test("page clicks never force or duplicate the default action", () => {
  // the default is canceled only when the caller explicitly asks for suppress,
  // never to force or hide an activation the page expects
  assert.doesNotMatch(
    pageActions,
    /preventDefault\(\)[^\n]*;\s*\n\s*target\.dispatchEvent/,
  );
  assert.doesNotMatch(pageActions, /stopPropagation/);
  assert.doesNotMatch(pageActions, /stopPropagation\(|stopImmediatePropagation\(/);
  // the click result reports whether the page canceled the activation
  assert.match(pageActions, /defaultPrevented: click\.defaultPrevented/);
  // the action result carries the page decision back to the tool output
  assert.match(
    pageActions,
    /defaultPrevented === undefined \? \{\} : \{ defaultPrevented \}/,
  );
  assert.match(serviceWorker, /world: "MAIN"/);
});

test("hover and enter events keep their real flags", () => {
  // enter does not bubble and hover events are not cancelable in real browsers
  assert.match(pageActions, /const hoverOptions = \{ bubbles: true, composed: true \};/);
  assert.match(pageActions, /const enterOptions = \{ composed: true \};/);
});

test("clicks can suppress the browser default without hiding page handlers", () => {
  // suppression is applied through a capture listener: dispatchEvent resets the
  // canceled flag, so the event must be canceled during propagation
  assert.match(pageActions, /window\.addEventListener\("click", suppress, true\)/);
  assert.match(pageActions, /if \(event === click\) click\.preventDefault\(\);/);
  assert.match(pageActions, /window\.removeEventListener\("click", suppress, true\)/);
  assert.match(pageActions, /suppressed: suppressDefault/);
  assert.match(pageActions, /defaultAction === "suppress"/);
});
