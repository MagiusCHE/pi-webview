import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { setLocale, t } from "../src/web/i18n.ts";

// Exercise the actual handler without booting the full Webview or changing
// its architecture for a notification-only fix.
const main = readFileSync("src/web/main.ts", "utf8");
const start = main.indexOf("function handlePiNotify(");
const end = main.indexOf("\nfunction addStatusLine(", start);
assert.ok(start >= 0 && end > start, "completion notification handler must exist");
const handler = ts.transpileModule(main.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

interface Options {
  apiAvailable?: boolean;
  permission?: NotificationPermission;
  requestedPermission?: NotificationPermission;
  requestFails?: boolean;
  creationFails?: boolean;
  notifications?: "desktop" | "off";
  visible?: boolean;
  focused?: boolean;
}

function harness(options: Options = {}) {
  setLocale("en");
  const desktop: Array<{ title: string; options: NotificationOptions }> = [];
  const chat: unknown[][] = [];
  let permissionRequests = 0;
  class TestNotification {
    static permission = options.permission ?? "granted";

    static requestPermission(): Promise<NotificationPermission> {
      permissionRequests++;
      return options.requestFails
        ? Promise.reject(new Error("Notification permission unavailable"))
        : Promise.resolve(options.requestedPermission ?? "denied");
    }

    constructor(title: string, notificationOptions: NotificationOptions) {
      if (options.creationFails) throw new Error("Desktop notification unavailable");
      desktop.push({ title, options: notificationOptions });
    }
  }
  const notify = runInNewContext(`${handler}\nhandlePiNotify;`, {
    window: options.apiAvailable === false ? {} : { Notification: TestNotification },
    Notification: TestNotification,
    document: {
      visibilityState: options.visible ? "visible" : "hidden",
      hasFocus: () => options.focused ?? false,
    },
    effectiveNotifications: () => options.notifications ?? "desktop",
    browserNotifyThrottled: (show: () => void) => show(),
    runtime: { isVsCode: false },
    t,
    addSystemBox: (...args: unknown[]) => chat.push(args),
  }) as (title: string, body: string) => void;
  return { notify, desktop, chat, permissionRequests: () => permissionRequests };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("completion notifications remain desktop-only when permission is granted", () => {
  const value = harness();
  value.notify("π", "The assistant already answered in the chat.");
  assert.equal(value.desktop.length, 1);
  assert.equal(
    value.desktop[0]?.options.body,
    "π pi-webview - Task completed!\nThe assistant already answered in the chat.",
  );
  assert.equal(value.desktop[0]?.options.icon, "/icon.png");
  assert.deepEqual(value.chat, []);
});

test("a missing Notifications API never duplicates the response in chat", () => {
  const value = harness({ apiAvailable: false });
  value.notify("π", "Already displayed answer");
  assert.deepEqual(value.desktop, []);
  assert.deepEqual(value.chat, []);
});

test("denied notification permission never falls back to chat", () => {
  const value = harness({ permission: "denied" });
  value.notify("π", "Already displayed answer");
  assert.equal(value.permissionRequests(), 0);
  assert.deepEqual(value.desktop, []);
  assert.deepEqual(value.chat, []);
});

test("a denied permission prompt stays silent in chat", async () => {
  const value = harness({ permission: "default", requestedPermission: "denied" });
  value.notify("π", "Already displayed answer");
  await settle();
  assert.equal(value.permissionRequests(), 1);
  assert.deepEqual(value.desktop, []);
  assert.deepEqual(value.chat, []);
});

test("accepting the permission prompt still shows the desktop notification", async () => {
  const value = harness({ permission: "default", requestedPermission: "granted" });
  value.notify("π", "Already displayed answer");
  await settle();
  assert.equal(value.desktop.length, 1);
  assert.deepEqual(value.chat, []);
});

test("desktop notification creation errors never fall back to chat", () => {
  const value = harness({ creationFails: true });
  assert.doesNotThrow(() => value.notify("π", "Already displayed answer"));
  assert.deepEqual(value.desktop, []);
  assert.deepEqual(value.chat, []);
});

test("a failed permission request is handled without a chat fallback", async () => {
  const value = harness({ permission: "default", requestFails: true });
  value.notify("π", "Already displayed answer");
  await settle();
  assert.equal(value.permissionRequests(), 1);
  assert.deepEqual(value.desktop, []);
  assert.deepEqual(value.chat, []);
});

test("disabled notifications and a focused page remain silent", () => {
  for (const options of [
    { notifications: "off" as const },
    { visible: true, focused: true },
  ]) {
    const value = harness(options);
    value.notify("π", "Already displayed answer");
    assert.deepEqual(value.desktop, []);
    assert.deepEqual(value.chat, []);
    assert.equal(value.permissionRequests(), 0);
  }
});
