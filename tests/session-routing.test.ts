import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sessionPickStrategy } from "../src/web/session-routing.ts";

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
  assert.match(bridge, /moveSession\(req\.sessionPath, req\.path\)/);
  assert.match(bridge, /workspace move requires a session path/);
  assert.equal(italian.ui.moveSessionHere, "Sposta la sessione nella nuova cartella");
  assert.equal(english.ui.moveSessionHere, "Move the session into the new folder");
});
