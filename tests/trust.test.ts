import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TrustRuntime,
  applyTrustOption,
  getTrust,
  trustOptions,
  trustOverrideArgs,
} from "../src/bridge/trust.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-webview-trust-"));
}

function readTrustFile(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "trust.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

test("getTrust: decisione salvata (trust.json) per la cartella o un parent", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "trust.json"), JSON.stringify({ "/work/proj": true }));
    // exact match
    assert.equal(getTrust("/work/proj", dir).status, "trusted");
    // parent match
    assert.equal(getTrust("/work/proj/sub/deep", dir).status, "trusted");
    // no decision → untrusted: pi never prompts in RPC mode, so the protected
    // project resources are ignored (there is no third "ask" level)
    assert.equal(getTrust("/altro", dir).status, "untrusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getTrust: decisione negativa e defaultProjectTrust", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "trust.json"), JSON.stringify({ "/work/proj": false }));
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ defaultProjectTrust: "always" }),
    );
    // explicit decision wins over the default
    assert.equal(getTrust("/work/proj", dir).status, "untrusted");
    // without a decision → always → trusted
    assert.equal(getTrust("/altro", dir).status, "trusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getTrust: file mancanti → untrusted (mai ask)", () => {
  const dir = tempDir();
  try {
    assert.equal(getTrust("/work/proj", dir).status, "untrusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getTrust: parentPath e opzioni del prompt come la TUI di pi", () => {
  const dir = tempDir();
  try {
    const withParent = getTrust("/work/proj", dir);
    assert.equal(withParent.parentPath, "/work");
    assert.deepEqual(
      withParent.options?.map((o) => o.id),
      ["trust", "trust-parent", "trust-session", "untrust", "untrust-session"],
    );
    // session-only options carry the run flag they arm
    assert.deepEqual(
      withParent.options?.filter((o) => o.sessionOverride !== undefined),
      [
        { id: "trust-session", sessionOverride: true },
        { id: "untrust-session", sessionOverride: false },
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getTrust: senza cartella superiore l'opzione parent non esiste", () => {
  const dir = tempDir();
  try {
    assert.equal(getTrust("/", dir).parentPath, undefined);
    assert.deepEqual(
      trustOptions("/").map((o) => o.id),
      ["trust", "trust-session", "untrust", "untrust-session"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTrustOption: trust/untrust scrivono trust.json", () => {
  const dir = tempDir();
  try {
    const trusted = applyTrustOption("/work/proj", "trust", dir);
    assert.equal(trusted.status, "trusted");
    assert.equal(trusted.sessionOverride, undefined);
    assert.equal(readTrustFile(dir)["/work/proj"], true);

    const untrusted = applyTrustOption("/work/proj", "untrust", dir);
    assert.equal(untrusted.status, "untrusted");
    assert.equal(readTrustFile(dir)["/work/proj"], false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTrustOption: trust-parent salva sul parent e rimuove la cartella", () => {
  const dir = tempDir();
  try {
    applyTrustOption("/work/proj/sub", "untrust", dir);
    assert.equal(getTrust("/work/proj/sub", dir).status, "untrusted");

    const applied = applyTrustOption("/work/proj/sub", "trust-parent", dir);
    assert.equal(applied.status, "trusted");
    const file = readTrustFile(dir);
    // the folder-specific decision is gone, the parent one applies
    assert.equal(file["/work/proj/sub"], undefined);
    assert.equal(file["/work/proj"], true);
    assert.equal(getTrust("/work/proj/sub", dir).status, "trusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTrustOption: le opzioni session-only non persistono nulla", () => {
  const dir = tempDir();
  try {
    const trusted = applyTrustOption("/work/proj", "trust-session", dir);
    assert.equal(trusted.status, "trusted");
    assert.equal(trusted.sessionOverride, true);
    const untrusted = applyTrustOption("/work/proj", "untrust-session", dir);
    assert.equal(untrusted.status, "untrusted");
    assert.equal(untrusted.sessionOverride, false);
    // nothing was written and the effective status is unchanged
    assert.throws(() => readTrustFile(dir));
    assert.equal(getTrust("/work/proj", dir).status, "untrusted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTrustOption: opzione sconosciuta → errore", () => {
  const dir = tempDir();
  try {
    assert.throws(
      // @ts-expect-error: id non valido per il tipo
      () => applyTrustOption("/work/proj", "trust-everything", dir),
      /unknown trust option/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTrustOption: un salvataggio impossibile è un errore, non un silenzio", () => {
  const dir = tempDir();
  try {
    // a FILE in the path of the trust dir makes the write impossible
    const blocked = join(dir, "not-a-dir");
    writeFileSync(blocked, "x");
    assert.throws(
      () => applyTrustOption("/work/proj", "trust", join(blocked, "agent")),
      // the caller (webview) must be able to show the failure
      /ENOTDIR|EEXIST|not a directory/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trustOverrideArgs: solo le opzioni session-only producono un flag", () => {
  assert.deepEqual(trustOverrideArgs(), []);
  assert.deepEqual(trustOverrideArgs(true), ["--approve"]);
  assert.deepEqual(trustOverrideArgs(false), ["--no-approve"]);
});

test("TrustRuntime: il cambio è pendente finché pi non viene riavviato", () => {
  const dir = tempDir();
  try {
    const runtime = new TrustRuntime("/work/proj", dir);
    assert.equal(runtime.status(), "untrusted");
    assert.equal(runtime.isTrusted(), false);

    const result = runtime.apply("trust");
    // pendingRestart + status of the RUNNING process (the chip keeps it)
    assert.equal(result.pendingRestart, true);
    assert.equal(result.status, "untrusted");
    assert.equal(result.sessionOnly, false);
    assert.equal(runtime.isTrusted(), false);

    // the restart applies the saved decision and clears the pending marker
    runtime.onLaunched();
    assert.equal(runtime.status(), "trusted");
    assert.equal(runtime.result().pendingRestart, false);
    assert.equal(runtime.result().sessionOnly, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TrustRuntime: l'override session-only si consuma al primo riavvio", () => {
  const dir = tempDir();
  try {
    const runtime = new TrustRuntime("/work/proj", dir);
    const result = runtime.apply("trust-session");
    assert.equal(result.pendingRestart, true);
    assert.equal(result.status, "untrusted");
    // the flag is handed to the next launch only
    assert.deepEqual(runtime.launchArgs(), ["--approve"]);

    runtime.onLaunched();
    assert.equal(runtime.status(), "trusted");
    assert.equal(runtime.result().sessionOnly, true);
    assert.deepEqual(runtime.launchArgs(), []);

    // a later restart ends the "this session only" choice
    runtime.onLaunched();
    assert.equal(runtime.status(), "untrusted");
    assert.equal(runtime.result().sessionOnly, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TrustRuntime: scegliere lo stato già attivo non richiede un riavvio", () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "trust.json"), JSON.stringify({ "/work/proj": true }));
    const runtime = new TrustRuntime("/work/proj", dir);
    assert.equal(runtime.isTrusted(), true);
    assert.equal(runtime.apply("trust").pendingRestart, false);
    assert.deepEqual(runtime.launchArgs(), []);
    // a session-only choice that matches the current status is a no-op too
    const session = runtime.apply("trust-session");
    assert.equal(session.pendingRestart, false);
    assert.deepEqual(runtime.launchArgs(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
