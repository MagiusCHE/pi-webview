import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import type { SessionInfo } from "../src/ide/protocol.ts";
import {
  createSessionItemText,
  filterSessions,
  sessionDirectoryName,
} from "../src/web/session-picker.ts";

const sessions: SessionInfo[] = [
  {
    path: "/sessions/first.jsonl",
    name: "Fix login validation",
    cwd: "/work/parent/pi-webview",
  },
  {
    path: "/sessions/second.jsonl",
    name: "Login screen",
    cwd: "C:\\Work\\account-app\\",
  },
  {
    path: "/sessions/third.jsonl",
    name: "Session picker",
    cwd: "/work/pi-webview-parent/demo",
  },
  { path: "/sessions/pi-webview.jsonl", name: "Untitled" },
];
const labelFor = (session: SessionInfo) => session.name ?? "";
const search = (query: string, locale = "en") =>
  filterSessions(sessions, query, labelFor, locale);

test("directory names exclude parent paths and tolerate platform separators", () => {
  for (const [cwd, expected] of [
    ["/work/parent/pi-webview", "pi-webview"],
    ["/work/pi-webview///", "pi-webview"],
    ["C:\\Work\\account-app\\", "account-app"],
    ["C:/Work/account-app/", "account-app"],
    ["\\\\server\\share\\project\\", "project"],
    ["relative/project", "project"],
    ["project", "project"],
    ["/", ""],
    ["", ""],
    [undefined, ""],
  ] as const) {
    assert.equal(sessionDirectoryName(cwd), expected);
  }
});

test("a single term matches session titles or directory names, ignoring case", () => {
  for (const locale of ["en", "it"]) {
    assert.deepEqual(search("LOGIN", locale), sessions.slice(0, 2));
    assert.deepEqual(search("PI-WEBVIEW", locale), [sessions[0]]);
    assert.deepEqual(search("account-APP", locale), [sessions[1]]);
    assert.deepEqual(search("PICKER", locale), [sessions[2]]);
  }
});

test("parent directories and session file paths are not searched", () => {
  assert.deepEqual(search("parent"), []);
  assert.deepEqual(search("work"), []);
  assert.deepEqual(search("/sessions/"), []);
  assert.deepEqual(search("jsonl"), []);
  assert.deepEqual(search("pi-webview"), [sessions[0]]);
});

test("all comma-separated terms must match, including across different fields", () => {
  assert.deepEqual(search("fix,validation"), [sessions[0]]);
  assert.deepEqual(search("pi,view"), [sessions[0]]);
  assert.deepEqual(search("LOGIN, PI-WEBVIEW"), [sessions[0]]);
  assert.deepEqual(search("pi-webview,login"), [sessions[0]]);
  assert.deepEqual(search("login, account"), [sessions[1]]);
  assert.deepEqual(search("login,missing"), []);
  assert.deepEqual(search("login,demo"), []);
});

test("search trims separators, ignores empty terms and tolerates repeated terms", () => {
  assert.deepEqual(search(" , FIX, , login, FIX, , "), [sessions[0]]);
  assert.deepEqual(search("login, "), sessions.slice(0, 2));
  for (const query of ["", "   ", ",", " , , ", "\t,\n\u00a0"]) {
    assert.equal(search(query), sessions);
  }
});

test("spaces and commas both require every term regardless of word order", () => {
  assert.deepEqual(search("fix login,validation"), [sessions[0]]);
  assert.deepEqual(search("fix validation"), [sessions[0]]);
  assert.deepEqual(search("validation login"), [sessions[0]]);
  assert.deepEqual(search("validation,login"), [sessions[0]]);
  assert.deepEqual(search("login demo"), []);
});

test("adding a title word after a directory name keeps the matching session", () => {
  assert.deepEqual(search("account-app"), [sessions[1]]);
  for (const query of [
    "account-app login",
    "account-app,login",
    "account-app   login",
    "account-app,\tlogin",
    " LOGIN\naccount-app ",
    "account-app\u00a0login",
  ]) {
    assert.deepEqual(search(query), [sessions[1]], `query: ${JSON.stringify(query)}`);
  }
});

test("search uses the caller's fallback label and supports sessions without a cwd", () => {
  const fallbackSessions: SessionInfo[] = [
    { path: "/sessions/first.jsonl", firstMessage: "Review the composer" },
    { path: "/sessions/second.jsonl", cwd: "/work/demo" },
  ];
  const fallbackLabel = (session: SessionInfo) => session.firstMessage ?? "New session";
  assert.deepEqual(
    filterSessions(fallbackSessions, "review,composer", fallbackLabel, "en"),
    [fallbackSessions[0]],
  );
  assert.deepEqual(filterSessions(fallbackSessions, "new,demo", fallbackLabel, "en"), [
    fallbackSessions[1],
  ]);
  assert.deepEqual(filterSessions([], "anything", fallbackLabel, "en"), []);
});

// Minimal DOM surface for the label renderer, without a browser dependency.
class TestElement {
  className = "";
  textContent = "";
  innerHTML = "";
  children: TestElement[] = [];

  append(...children: TestElement[]): void {
    this.children.push(...children);
  }
}

function renderer(context: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new TestElement() },
  });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return (session: SessionInfo, workspace: string | null = "/work/current") =>
    createSessionItemText(
      session,
      labelFor(session),
      workspace,
    ) as unknown as TestElement;
}

test("foreign sessions show only their directory beneath the session name", (context) => {
  const render = renderer(context);
  for (const session of sessions.slice(0, 3)) {
    const text = render(session);
    assert.equal(text.className, "session-item-text");
    assert.deepEqual(
      text.children.map((child) => child.className),
      ["session-item-label", "session-item-directory"],
    );
    assert.deepEqual(
      text.children.map((child) => child.textContent),
      [session.name, sessionDirectoryName(session.cwd)],
    );
  }
});

test("current-workspace sessions have no subtitle, including equivalent Windows paths", (context) => {
  const render = renderer(context);
  for (const [cwd, workspace] of [
    ["/work/current", "/work/current"],
    ["C:\\Work\\Current", "c:/work/current/"],
    ["\\\\Server\\Share\\Current", "\\\\server\\share\\current\\"],
  ]) {
    const text = render({ path: "/session.jsonl", name: "Current", cwd }, workspace);
    assert.deepEqual(
      text.children.map((child) => child.className),
      ["session-item-label"],
    );
  }
});

test("different workspaces with the same directory name still show a subtitle", (context) => {
  const render = renderer(context);
  const text = render({ path: "/session.jsonl", name: "Other", cwd: "/other/current" });
  assert.equal(text.children[1]?.textContent, "current");
});

test("unknown workspaces or missing directory names never produce empty subtitles", (context) => {
  const render = renderer(context);
  for (const session of [
    { path: "/session.jsonl", name: "Missing cwd" },
    { path: "/session.jsonl", name: "Empty cwd", cwd: "" },
    { path: "/session.jsonl", name: "Root cwd", cwd: "/" },
  ]) {
    assert.equal(render(session).children.length, 1);
  }
  assert.equal(render(sessions[0]!, null).children.length, 1);
});

test("session titles and directory names are rendered as text, never HTML", (context) => {
  const render = renderer(context);
  const name = '<img src=x onerror="unexpected()">';
  const directory = "project & <demo>";
  const text = render({ path: "/session.jsonl", name, cwd: `/work/${directory}` });
  assert.equal(text.children[0]?.textContent, name);
  assert.equal(text.children[1]?.textContent, directory);
  for (const element of [text, ...text.children]) assert.equal(element.innerHTML, "");
});

test("picker wiring uses the shared filter and vertically stacked, muted subtitles", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  const css = readFileSync("src/web/style.css", "utf8");
  assert.match(
    web,
    /filterSessions\(\s*list,\s*els\.sessionSearch\.value,\s*sessionLabel,\s*currentLocale,/,
  );
  assert.match(
    web,
    /createSessionItemText\(s, sessionDisplayLabel\(s\), workspacePath\)/,
  );
  assert.match(web, /els\.sessionSearch\.title = t\("searchSessionsHint"\)/);
  const textRule = /\.session-item-text \{([^}]*)\}/.exec(css)?.[1];
  const directoryRule = /\.session-item-directory \{([^}]*)\}/.exec(css)?.[1];
  assert.ok(textRule);
  assert.match(textRule, /flex-direction: column/);
  assert.match(textRule, /min-width: 0/);
  assert.ok(directoryRule);
  assert.match(directoryRule, /color: var\(--fg-tertiary\)/);
  assert.match(directoryRule, /font-size: 12px/);
  assert.match(directoryRule, /text-overflow: ellipsis/);
});
