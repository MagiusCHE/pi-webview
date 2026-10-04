import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SESSION_HISTORY_TIMEOUT_MS,
  SESSION_SWITCH_TIMEOUT_MS,
  sessionPickStrategy,
  sessionSwitchOutcome,
} from "../src/web/session-routing.ts";

test("Chrome resumes cross-workspace sessions without forking", () => {
  assert.equal(sessionPickStrategy("browser-extension", true), "reload-original");
});

test("same-workspace sessions always switch directly", () => {
  for (const mode of ["browser-extension", "standalone", "vscode", "ide"] as const) {
    assert.equal(sessionPickStrategy(mode, false), "switch");
  }
});

test("standalone and fixed-workspace IDEs retain their distinct cross-workspace flows", () => {
  assert.equal(sessionPickStrategy("standalone", true), "choose-standalone-action");
  assert.equal(sessionPickStrategy("vscode", true), "confirm-ide-fork");
  assert.equal(sessionPickStrategy("ide", true), "confirm-ide-fork");
});

// An unstarted session (browser, "New session" still empty) has no
// conversation to fork: picking a session from another repository must open it
// directly instead of asking what to do. IDE hosts keep the question because
// their workspace is fixed.
test("an unstarted session resumes a cross-workspace pick without asking", () => {
  assert.equal(sessionPickStrategy("standalone", true, true), "resume-original");
  assert.equal(
    sessionPickStrategy("standalone", true, false),
    "choose-standalone-action",
  );
  assert.equal(sessionPickStrategy("vscode", true, true), "confirm-ide-fork");
  assert.equal(sessionPickStrategy("ide", true, true), "confirm-ide-fork");
  assert.equal(sessionPickStrategy("browser-extension", true, true), "reload-original");
  assert.equal(sessionPickStrategy("standalone", false, true), "switch");
});

test("the empty-session shortcut uses the same test as the folder button", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  const emptiness = /!sessionHasMessages && isNewSession\(currentSession\(\)\)/g;
  assert.equal(
    (web.match(emptiness) ?? []).length,
    2,
    "pickSession and changeWorkspace must agree on what an empty session is",
  );
  const pick = /async function pickSession\(path: string\)[\s\S]*?\n}/.exec(web)?.[0];
  assert.ok(pick, "pickSession not found");
  assert.match(
    pick,
    /sessionPickStrategy\(runtime\.mode, crossWorkspace, currentIsEmpty\)/,
  );
  assert.match(
    pick,
    /strategy === "resume-original" && session\?\.cwd[\s\S]*?await resumeSessionInWorkspace\(path, session\.cwd\)/,
  );
});

test("a large local session is given more than the default RPC timeout", () => {
  assert.ok(SESSION_SWITCH_TIMEOUT_MS > 10_000);
  const web = readFileSync("src/web/main.ts", "utf8");
  assert.match(
    web,
    /rpcRequest\(\s*\{ type: "switch_session", sessionPath: path \},\s*undefined,\s*SESSION_SWITCH_TIMEOUT_MS,/,
  );
});

test("a large history is not silently treated as a new session on timeout", () => {
  assert.ok(SESSION_HISTORY_TIMEOUT_MS > 10_000);
  const web = readFileSync("src/web/main.ts", "utf8");
  assert.match(
    web,
    /rpcRequest\(\s*rpc\.getMessages\(\),\s*undefined,\s*SESSION_HISTORY_TIMEOUT_MS,/,
  );
  assert.match(web, /if \(loaded\) void maybeShowStartupBanner\(\)/);
  const italian = JSON.parse(readFileSync("src/web/locale/it.json", "utf8"));
  const english = JSON.parse(readFileSync("src/web/locale/en.json", "utf8"));
  assert.match(italian.ui.sessionHistoryFailed, /\{reason\}/);
  assert.match(english.ui.sessionHistoryFailed, /\{reason\}/);
});

test("a failed or cancelled switch is not treated as a loaded session", () => {
  assert.equal(
    sessionSwitchOutcome({ success: true, data: { cancelled: false } }),
    "switched",
  );
  assert.equal(
    sessionSwitchOutcome({ success: true, data: { cancelled: true } }),
    "cancelled",
  );
  assert.equal(sessionSwitchOutcome({ success: false, error: "missing cwd" }), "failed");
  const web = readFileSync("src/web/main.ts", "utf8");
  assert.match(web, /reportSessionSwitchFailure\(res\.error\)/);
  assert.match(web, /reportSessionSwitchFailure\(error\)/);
});

test("the folder-change dialog moves a session into the new workspace", () => {
  const web = readFileSync("src/web/main.ts", "utf8");
  const bridge = readFileSync("src/bridge/index.ts", "utf8");
  const italian = JSON.parse(readFileSync("src/web/locale/it.json", "utf8"));
  const english = JSON.parse(readFileSync("src/web/locale/en.json", "utf8"));

  // the dialog offers the move action next to fork/new
  assert.match(web, /t\("moveSessionHere"\)/);
  assert.match(web, /done\("move"\)/);
  // moving sends the current session and resumes the moved copy
  assert.match(web, /action: choice/);
  assert.match(web, /choice !== "new" && currentSessionPath/);
  // the bridge stops pi first, then moves the file and starts on the copy
  assert.match(bridge, /req\.action === "move"/);
  assert.match(bridge, /moveSession\(req\.sessionPath, targetPath\)/);
  assert.match(bridge, /workspace move requires a session path/);
  assert.equal(italian.ui.moveSessionHere, "Sposta la sessione nella nuova cartella");
  assert.equal(english.ui.moveSessionHere, "Move the session into the new folder");
});
