import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  utimesSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listSessions,
  defaultSessionDir,
  forkSession,
  getSessionInfo,
  encodeProjectFolder,
} from "../src/bridge/sessions.ts";

const header = (id: string, cwd: string) =>
  JSON.stringify({ type: "session", version: "3", id, cwd });

test("listSessions: header, nome da session_info, primo messaggio, ordine mtime", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-sessions-"));
  try {
    const proj1 = join(root, "--work-proj-one--");
    const proj2 = join(root, "--work-proj-two--");
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });

    // s1: with name (session_info) and first user message
    const s1 = join(proj2, "2026-07-01_aaa.jsonl");
    writeFileSync(
      s1,
      header("id-2", "/work/proj-two") +
        "\n" +
        JSON.stringify({ type: "session_info", id: "k1", name: "Refactor auth module" }) +
        "\n" +
        JSON.stringify({
          type: "message",
          id: "m1",
          message: { role: "user", content: "Sistemi il login, per favore" },
        }) +
        "\n",
    );
    // s2: header only (no name/message)
    const s2 = join(proj1, "2026-07-02_bbb.jsonl");
    writeFileSync(s2, header("id-3", "/work/proj-one") + "\n");
    // s3: corrupted header → present but without id
    const s3 = join(proj1, "2026-07-03_ccc.jsonl");
    writeFileSync(s3, "{non-json\n");
    writeFileSync(join(proj1, "ignorato.txt"), "no");

    const base = Date.UTC(2026, 6, 1, 12);
    utimesSync(s1, new Date(base), new Date(base));
    utimesSync(s2, new Date(base + 60_000), new Date(base + 60_000));
    utimesSync(s3, new Date(base + 120_000), new Date(base + 120_000));

    const sessions = listSessions(root);
    assert.equal(sessions.length, 3);
    // s3 (corrupted) most recent → first
    assert.equal(sessions[0]?.id, undefined);
    assert.equal(sessions[1]?.id, "id-3");
    assert.equal(sessions[2]?.id, "id-2");
    assert.equal(sessions[2]?.name, "Refactor auth module");
    assert.equal(sessions[2]?.firstMessage, "Sistemi il login, per favore");
    assert.equal(sessions[2]?.cwd, "/work/proj-two");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listSessions: workspace filter (header.cwd and folder name)", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-sessions-"));
  try {
    // no dashes in names: - is the separator pi uses in the folder name
    const proj1 = join(root, "--work-projone--");
    const proj2 = join(root, "--work-projtwo--");
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });

    writeFileSync(join(proj1, "a.jsonl"), header("id-1", "/work/projone") + "\n");
    writeFileSync(join(proj2, "b.jsonl"), header("id-2", "/work/projtwo") + "\n");
    // without header.cwd: match via decoded folder name
    writeFileSync(join(proj2, "c.jsonl"), "{type-less\n");

    const filtered = listSessions(root, "/work/projtwo");
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((s) => s.path.startsWith(proj2)));
    assert.equal(filtered[0]?.id, "id-2");
    assert.equal(filtered[1]?.id, undefined);

    const other = listSessions(root, "/work/altro-progetto");
    assert.deepEqual(other, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("forkSession: copia la sessione nel workspace con header aggiornato", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-sessions-"));
  try {
    const proj1 = join(root, "--work-projone--");
    const proj2 = join(root, "--work-projtwo--");
    mkdirSync(proj1, { recursive: true });

    const source = join(proj1, "2026-07-01_aaa.jsonl");
    writeFileSync(
      source,
      header("id-2", "/work/projone") +
        "\n" +
        JSON.stringify({ type: "session_info", id: "k1", name: "Sessione vecchia" }) +
        "\n" +
        JSON.stringify({
          type: "message",
          id: "m1",
          message: { role: "user", content: "ciao" },
        }) +
        "\n",
    );

    const { path } = forkSession(source, "/work/projtwo", root);
    assert.ok(path.startsWith(proj2), "fork nella cartella del workspace");
    assert.notEqual(path, source);

    const lines = readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const headerLine = lines[0];
    assert.equal(headerLine.type, "session");
    assert.equal(headerLine.cwd, "/work/projtwo");
    assert.equal(headerLine.parentSession, source);
    assert.ok(headerLine.id && headerLine.id !== "id-2");
    // entries copied, original header excluded
    assert.equal(lines.length, 3);
    assert.equal(lines[1].type, "session_info");
    assert.equal(lines[1].name, "Sessione vecchia");
    assert.equal(lines[2].type, "message");
    // the original is not touched
    assert.ok(readFileSync(source, "utf-8").includes("id-2"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listSessions: tutte le sessioni ordinate dalla più recente (all)", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-sessions-"));
  try {
    const projA = join(root, "--work-projone--");
    const projB = join(root, "--work-projtwo--");
    mkdirSync(projA, { recursive: true });
    mkdirSync(projB, { recursive: true });

    const old1 = join(projA, "2026-07-01_a.jsonl");
    const mid = join(projB, "2026-07-02_b.jsonl");
    const new1 = join(projA, "2026-07-03_c.jsonl");
    writeFileSync(old1, header("id-old", "/work/projone") + "\n");
    writeFileSync(mid, header("id-mid", "/work/projtwo") + "\n");
    writeFileSync(new1, header("id-new", "/work/projone") + "\n");
    const base = Date.UTC(2026, 6, 1, 12);
    utimesSync(old1, new Date(base), new Date(base));
    utimesSync(mid, new Date(base + 60_000), new Date(base + 60_000));
    utimesSync(new1, new Date(base + 120_000), new Date(base + 120_000));

    const all = listSessions(root); // senza filtro: tutte
    assert.deepEqual(
      all.map((s) => s.id),
      ["id-new", "id-mid", "id-old"],
    );

    const filtered = listSessions(root, "/work/projone");
    assert.deepEqual(
      filtered.map((s) => s.id),
      ["id-new", "id-old"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSessionInfo: conteggio su TUTTO il file e ultima attività dai timestamp", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-sessions-"));
  try {
    const proj = join(root, "--work-projone--");
    mkdirSync(proj, { recursive: true });
    const path = join(proj, "2026-07-01_a.jsonl");
    // beyond the old 512KB limit: the count must include everything
    const lines = [header("id-1", "/work/projone")];
    for (let i = 0; i < 30; i++) {
      lines.push(
        JSON.stringify({
          type: "message",
          id: `m${i}`,
          timestamp: new Date(Date.UTC(2026, 6, 1, 12) + i * 60_000).toISOString(),
          message: { role: "user", content: `messaggio ${i}` },
        }),
      );
    }
    // 40KB of padding at the end to exceed the old limit
    const big = "x".repeat(600 * 1024);
    writeFileSync(path, lines.join("\n") + "\n" + big + "\n");

    const s = listSessions(root)[0];
    assert.ok(s);
    assert.equal(s.messageCount, 30, "conteggio su tutto il file");
    assert.equal(s.firstMessage, "messaggio 0");
    // last activity = timestamp of the last message, not the file mtime
    assert.equal(s.lastActivity, Date.parse("2026-07-01T12:29:00.000Z"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getSessionInfo: info aggiornata di una singola sessione", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-webview-sessions-"));
  try {
    const proj = join(root, "--work-projone--");
    mkdirSync(proj, { recursive: true });
    const path = join(proj, "2026-07-01_a.jsonl");
    writeFileSync(
      path,
      header("id-1", "/work/projone") +
        "\n" +
        JSON.stringify({ type: "session_info", id: "k1", name: "Nuovo nome" }) +
        "\n" +
        JSON.stringify({
          type: "message",
          id: "m1",
          message: { role: "user", content: "primo messaggio" },
        }) +
        "\n",
    );
    const info = getSessionInfo(path);
    assert.equal(info.path, path);
    assert.equal(info.name, "Nuovo nome");
    assert.equal(info.firstMessage, "primo messaggio");
    assert.equal(info.messageCount, 1);
    assert.ok(typeof info.mtime === "number");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listSessions: cartella mancante → lista vuota", () => {
  assert.deepEqual(listSessions(join(tmpdir(), "pi-webview-inesistente-xyz")), []);
});

test("defaultSessionDir: percorso canonico di pi", () => {
  assert.ok(defaultSessionDir().endsWith(join(".pi", "agent", "sessions")));
});

// --- project folder encoding (parity with the C# SessionStore, concept 0005) ---

test("encodeProjectFolder: windows separators and ':' become -", () => {
  assert.equal(encodeProjectFolder("C:\\proj\\sub"), "--C--proj-sub--");
  assert.equal(encodeProjectFolder("/home/user"), "--home-user--");
});

test("listSessions: workspace filter with a windows path", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-sess-win-"));
  try {
    const projDir = join(dir, encodeProjectFolder("C:\\proj"));
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "sess.jsonl"),
      header("id1", "C:\\proj") +
        "\n" +
        JSON.stringify({ type: "message", role: "user", content: "ciao" }) +
        "\n",
    );
    const sessions = listSessions(dir, "C:\\proj");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.cwd, "C:\\proj");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listSessions: windows workspace matching ignores case and separator style", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-sess-win-case-"));
  try {
    const projDir = join(dir, encodeProjectFolder("c:\\work\\pi-webview"));
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "sess.jsonl"),
      header("id-win", "c:\\work\\pi-webview") + "\n",
    );

    const sessions = listSessions(dir, "C:/Work/pi-webview");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, "id-win");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listSessions: falls back to the header cwd when the encoded folder differs", () => {
  const dir = mkdtempSync(join(tmpdir(), "piw-sess-win-fallback-"));
  try {
    const legacyDir = join(dir, "--legacy-project-folder--");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, "sess.jsonl"),
      header("id-fallback", "C:\\Work\\pi-webview") + "\n",
    );

    const sessions = listSessions(dir, "C:\\Work\\pi-webview");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, "id-fallback");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
