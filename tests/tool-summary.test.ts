import { test } from "node:test";
import assert from "node:assert/strict";
import { streamedToolPath, toolSummary } from "../src/web/tool-summary.ts";

test('bash: come pi.dev — "$" evidenziato, comando negli args attenuati', () => {
  const s = toolSummary("bash", JSON.stringify({ command: "ls -la" }));
  assert.equal(s.name, "$");
  assert.equal(s.args, "ls -la");
  // no JS truncation: the CSS (single-line ellipsis) does the cutting
  const long = "x".repeat(80);
  const s2 = toolSummary("bash", JSON.stringify({ command: long }));
  assert.equal(s2.name, "$");
  assert.equal(s2.args, long);
  // command missing → only the dollar
  assert.deepEqual(toolSummary("bash", "{}"), { name: "$", args: "" });
});

test("read: path come args (ellipsis CSS, niente troncatura JS)", () => {
  const path = "a/b/" + "x".repeat(70);
  const s = toolSummary("read", JSON.stringify({ path }));
  assert.equal(s.name, "read");
  assert.equal(s.args, path);
});

test("read con range: [start-end] e path", () => {
  const s = toolSummary(
    "read",
    JSON.stringify({ path: "/p/" + "y".repeat(50), startLine: 10, endLine: 20 }),
  );
  assert.equal(s.name, "read");
  assert.match(s.args, /^\[10-20\] \/p\//);
  assert.ok(s.args.endsWith("y".repeat(50)));

  // fallback offset+length
  const s2 = toolSummary(
    "read",
    JSON.stringify({ path: "file.txt", offset: 5, length: 30 }),
  );
  assert.match(s2.args, /^\[5-35\]/);
});

test("edit/write: path come args (nessun ellipsis JS)", () => {
  const path = "z".repeat(60);
  assert.equal(toolSummary("edit", JSON.stringify({ path })).args, path);
  assert.equal(toolSummary("write", JSON.stringify({ path })).args, path);
});

test("edit streaming: path disponibile prima del JSON completo", () => {
  const path = '/home/user/proj/src/a\\b"c.ts';
  const prefix = JSON.stringify({ path }).slice(0, -1);
  const fragment = `${prefix},"edits":[{"oldText":"large payload`;
  assert.equal(streamedToolPath("edit", fragment), path);
  assert.equal(streamedToolPath("edit", fragment, "/home/user/proj"), './src/a\\b"c.ts');
});

test("edit streaming: attende la fine della stringa path", () => {
  assert.equal(streamedToolPath("edit", '{"path":"src/incomplete'), "");
  assert.equal(streamedToolPath("bash", '{"path":"src/done.ts"'), "");
  assert.equal(streamedToolPath("edit-diff", '{"filePath":"src/done.ts"'), "src/done.ts");
});

test("grep: pattern + path come argomenti", () => {
  const s = toolSummary(
    "grep",
    JSON.stringify({ pattern: "TODO", path: "/p/" + "p".repeat(30) }),
  );
  assert.equal(s.name, "grep");
  assert.ok(s.args.startsWith("TODO · /p/"));
  assert.ok(s.args.endsWith("p".repeat(30)));
});

test("path relativi al workspace (./…) quando dentro il progetto", () => {
  const ws = "/home/user/proj";
  const s = toolSummary("read", JSON.stringify({ path: "/home/user/proj/src/x.ts" }), ws);
  assert.equal(s.args, "./src/x.ts");
  // outside the workspace: stays absolute
  const s2 = toolSummary("read", JSON.stringify({ path: "/etc/hosts" }), ws);
  assert.equal(s2.args, "/etc/hosts");
});

test("args non JSON → solo il nome, argomenti vuoti", () => {
  assert.deepEqual(toolSummary("bash", "{rotto"), { name: "bash", args: "" });
  assert.deepEqual(toolSummary("read", ""), { name: "read", args: "" });
});
