// piw — runs pi-webview standalone from the installed package (plan 0005).
// npm bin (`"bin": { "piw": "dist/piw.js" }`): npm generates the shim
// (script/symlink on Linux/macOS, `piw.cmd` on Windows).
//
// Usage:
//   piw                      → opens a NEW session (new tab, if needed)
//   piw --session <id>       → resumes a session (partial id or path;
//                              the cwd is set by pi from the session)
//   piw --port N             → fixed port (default: random)
//   piw --ip <IPv4>          → also binds a specific address; 0.0.0.0 binds all
//   piw --no-open            → does not open the browser: prints the link
//   piw --pi <command>       → alternative pi command
//   piw --background | -b    → starts in background (fire-and-forget),
//                              detached from the terminal, and opens the browser;
//                              with --no-open prints only the link
//   piw -k | --kill          → stops the background bridge
//
// Single-instance: ONE bridge listening per user. If a bridge is already
// active (valid lock: live pid + /health with token), piw does NOT start a
// second one: it only opens a new browser tab towards the existing bridge.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { resolvePi } from "./spawn.ts";
import { readLock, writeLock, clearLock, pidAlive, healthCheck } from "./lock.ts";
import { getSessionInfo, listSessions } from "./sessions.ts";
import { resolveLaunchCwd } from "./launch-context.ts";
import {
  ALL_IPV4_INTERFACES,
  LOOPBACK_IP,
  bindingIncludes,
  normalizeBindIp,
} from "./bind.ts";
import {
  ensureCompanions,
  formatCompanionNotes,
  companionReloadHints,
} from "./companions.ts";
import { RESTART_TOKEN_ENV, restartTokenFromEnvironment } from "./restart-token.ts";

// Capture and remove the private hand-off before companion checks or any other
// subprocess can inherit it. A background relaunch receives it explicitly.
const restartTokenValue = process.env[RESTART_TOKEN_ENV];
delete process.env[RESTART_TOKEN_ENV];

// dist/piw.js → root of the installed package
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeJs = join(root, "dist", "bridge.cjs");
const webDir = join(root, "dist", "web");

// package version (for --version and the launch line)
const piwVersion: string = (() => {
  try {
    const json = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
      version?: unknown;
    };
    return typeof json.version === "string" ? json.version : "?";
  } catch {
    return "?";
  }
})();

// Companion check (VS Code + Visual Studio), fire and forget: never block
// startup. Same centralized module as the pi extension (ensureCompanions in
// src/bridge/companions.ts). Steps are buffered only while nothing is being
// done: the FIRST action step flushes the whole trace, then every step is
// streamed — nothing to install/update → total silence (no output).
const steps: string[] = [];
let flushing = false;
void ensureCompanions(root, {
  onStep: (step, action) => {
    if (action) {
      if (!flushing) {
        flushing = true;
        for (const s of steps) console.log(`piw: ${s}`);
      }
      console.log(`piw: ${step}`);
    } else {
      steps.push(step);
    }
  },
}).then((notes) => {
  if (notes.length === 0) return; // nothing to install/update → silent
  if (!flushing) for (const s of steps) console.log(`piw: ${s}`); // safety
  for (const msg of formatCompanionNotes(notes, "it", "piw: ")) {
    console.log(msg);
  }
  for (const hint of companionReloadHints(notes, "it", "piw: ")) {
    console.log(hint);
  }
});

for (const f of [bridgeJs, webDir]) {
  if (!existsSync(f)) {
    console.error(`piw: manca ${f} — pacchetto installato incompleto`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2).filter((a) => a !== "--");
// ^ the `--` separator (convention: piw -- -b) is not a real argument:
const value = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const noOpen = argv.includes("--no-open");
const background = argv.includes("--background") || argv.includes("-b");
const kill = argv.includes("--kill") || argv.includes("-k");
// already detached process (internal relaunch of --background)
const detachedRun = process.env.PIW_DETACHED === "1";
const session = value("--session");
const portArg = value("--port");
const piArg = value("--pi");
const ipArg = value("--ip") ?? value("--host");
let bindIp: string;
try {
  bindIp = normalizeBindIp(ipArg);
} catch (error) {
  console.error(`piw: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const debug = argv.includes("--debug");
const launchCwd = resolveLaunchCwd();

// extra arguments passed to the bridge (e.g. --no-idle, --idle-timeout, --mock-ide)
const extra: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-open" || a === "--debug") continue;
  if (
    a === "--session" ||
    a === "--port" ||
    a === "--pi" ||
    a === "--ip" ||
    a === "--host"
  ) {
    i++; // skip the value too
    continue;
  }
  if (a === "--background" || a === "-b" || a === "--kill" || a === "-k") continue;
  if (a !== undefined) extra.push(a);
}

function resolvePublicSessionId(reference: string): string | undefined {
  if (existsSync(reference)) return getSessionInfo(reference).id;
  const all = listSessions();
  const exact = all.find((candidate) => candidate.id === reference);
  if (exact?.id) return exact.id;
  const partial = all.filter((candidate) => candidate.id?.startsWith(reference));
  return partial.length === 1 ? partial[0]?.id : undefined;
}

// The browser URL contains only opaque identifiers. Session paths and the
// shell working directory stay inside the bridge process.
const publicSessionId = session ? resolvePublicSessionId(session) : undefined;
if (session && !publicSessionId) {
  console.error(`piw: sessione non trovata o id ambiguo: ${session}`);
  process.exit(1);
}

async function createPageIntent(port: number, token: string): Promise<string> {
  if (publicSessionId) return `s=${encodeURIComponent(publicSessionId)}`;
  const res = await fetch(`http://127.0.0.1:${port}/launch-intent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-webview-token": token,
    },
    body: JSON.stringify({ cwd: launchCwd }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error("impossibile registrare la directory di avvio");
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || !data.id) {
    throw new Error("risposta non valida durante la registrazione della directory");
  }
  return `new=1&launch=${encodeURIComponent(data.id)}`;
}

function remoteHosts(ip: string): string[] {
  if (ip !== ALL_IPV4_INTERFACES) return ip === LOOPBACK_IP ? [] : [ip];
  const hosts = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) hosts.add(address.address);
    }
  }
  return [...hosts];
}

function remotePageUrl(
  host: string,
  port: number,
  intent: string,
  token: string,
): string {
  const params = new URLSearchParams({ token });
  for (const [key, value] of new URLSearchParams(intent)) params.set(key, value);
  return `http://${host}:${port}/?${params.toString()}`;
}

function printRemoteAccess(
  ip: string,
  port: number,
  intent: string,
  token: string,
): void {
  const hosts = remoteHosts(ip);
  if (hosts.length === 0 && ip === ALL_IPV4_INTERFACES) {
    console.log(
      `piw: in ascolto su 0.0.0.0:${port}; nessun indirizzo IPv4 esterno rilevato.`,
    );
    return;
  }
  for (const host of hosts) {
    console.log(`piw: accesso remoto: ${remotePageUrl(host, port, intent, token)}`);
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd: [string, string[]] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
}

async function main(): Promise<void> {
  // 0a) --version | -V: prints ONLY the version and exits
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`piw ${piwVersion}`);
    process.exit(0);
  }

  const restartToken = restartTokenFromEnvironment(restartTokenValue);

  // every launch says its version
  console.log(`piw ${piwVersion}`);

  // 0b) --kill: stops the background bridge (the pid is in the lock)
  if (kill) {
    const l = readLock();
    if (l && pidAlive(l.pid) && (await healthCheck(l.port, l.token))) {
      try {
        process.kill(l.pid, "SIGTERM");
      } catch {
        // process already terminated: continue with the cleanup
      }
      console.log(`piw: bridge (pid ${l.pid}) fermato.`);
      clearLock();
    } else if (l) {
      console.log("piw: lock stantio, nessun bridge attivo — lock rimosso.");
      clearLock();
    } else {
      console.log("piw: nessun bridge attivo.");
    }
    return;
  }

  // 0) --background: relaunches detached from the terminal and the original
  //    process exits right away (cross-platform: Node's detached=true).
  //    The child (PIW_DETACHED=1) does the normal work and stays alive with
  //    the bridge. The parent does NOT exit until the lock is valid: avoids
  //    the race where an immediate next `piw` would find the lock missing
  //    and start a second bridge.
  if (background && !detachedRun) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
      cwd: launchCwd,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        PIW_DETACHED: "1",
        ...(restartToken ? { [RESTART_TOKEN_ENV]: restartToken } : {}),
      },
    });
    child.unref();
    console.log("piw: avvio in background…");
    const deadline = Date.now() + 10_000;
    for (;;) {
      const l = readLock();
      if (l && pidAlive(l.pid) && (await healthCheck(l.port, l.token))) {
        const activeBindIp = normalizeBindIp(l.bindIp);
        if (!bindingIncludes(activeBindIp, bindIp)) {
          console.error(
            `piw: il bridge attivo è bindato su ${activeBindIp}; fermalo con piw -k prima di usare --ip ${bindIp}.`,
          );
          process.exit(1);
        }
        const intent = await createPageIntent(l.port, l.token);
        const url = `http://${LOOPBACK_IP}:${l.port}/?${intent}`;
        // default: opens the browser; with --no-open prints only the link
        if (noOpen) {
          console.log(`piw: bridge attivo su ${url}`);
        } else {
          openBrowser(url);
          console.log(
            `piw: bridge attivo su http://${LOOPBACK_IP}:${l.port} (background).`,
          );
        }
        if (ipArg) printRemoteAccess(activeBindIp, l.port, intent, l.token);
        return;
      }
      if (Date.now() > deadline) {
        console.error(
          "piw: il bridge non è diventato attivo entro 10s — controlla i log",
        );
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // 1) bridge already active? → reuse (no second bridge)
  const lock = readLock();
  if (lock && pidAlive(lock.pid) && (await healthCheck(lock.port, lock.token))) {
    const activeBindIp = normalizeBindIp(lock.bindIp);
    if (ipArg && !bindingIncludes(activeBindIp, bindIp)) {
      console.error(
        `piw: il bridge attivo è bindato su ${activeBindIp}; fermalo con piw -k prima di usare --ip ${bindIp}.`,
      );
      process.exit(1);
    }
    const intent = detachedRun ? "new=1" : await createPageIntent(lock.port, lock.token);
    const url = `http://${LOOPBACK_IP}:${lock.port}/?${intent}`;
    console.log(
      `piw: bridge già attivo su http://${LOOPBACK_IP}:${lock.port} — apro ${intent}`,
    );
    if (!noOpen && !detachedRun) openBrowser(url);
    if (ipArg && !detachedRun) {
      printRemoteAccess(activeBindIp, lock.port, intent, lock.token);
    }
    return;
  }
  if (lock) {
    console.log("piw: lock stantio (bridge non raggiungibile) — avvio un nuovo bridge");
  }

  // 2) New bridges normally receive a fresh token. The artifact-update
  // procedure may hand the previous one back internally so authenticated
  // remote URLs remain valid across that controlled restart.
  const token = restartToken ?? randomBytes(16).toString("hex");
  const bridgeArgs = [
    bridgeJs,
    "--serve",
    webDir,
    "--token",
    token,
    ...(portArg ? ["--port", portArg] : []),
    "--ip",
    bindIp,
    ...(piArg ? ["--pi", piArg] : []),
    ...(debug ? ["--debug"] : []),
    ...extra,
  ];

  // resolves `pi` in the PATH and passes it explicitly to the bridge (portable:
  // on Windows the shim is pi.cmd, with absolute path and possible spaces)
  const pi = resolvePi();
  if (!pi.found) {
    console.error("piw: comando 'pi' non trovato nel PATH.");
    console.error(
      "  Installa pi: npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
    );
    process.exit(1);
  }
  bridgeArgs.push("--pi", pi.path ?? pi.command);

  console.log(`piw: avvio bridge (pi = ${pi.path ?? pi.command})…`);
  const bridgeEnv = { ...process.env };
  // The bridge receives the token through its existing --token argument; do
  // not retain the private restart hand-off in the child environment as well.
  delete bridgeEnv[RESTART_TOKEN_ENV];
  const child = spawn(process.execPath, bridgeArgs, {
    cwd: launchCwd,
    stdio: ["ignore", "pipe", "inherit"],
    env: bridgeEnv,
  });

  // 3) waits for BRIDGE_READY to know the real port and register the lock
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("bridge non è partito (nessun BRIDGE_READY in 15s)"));
    }, 15_000);
    child.stdout.on("data", (buf: Buffer) => {
      const m = buf.toString().match(/BRIDGE_READY ws:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`bridge terminato prima del ready (code=${code})`));
    });
  });

  if (!child.pid) {
    throw new Error("processo bridge senza pid");
  }
  let intent: string;
  try {
    intent = detachedRun ? "new=1" : await createPageIntent(port, token);
  } catch (error) {
    child.kill();
    throw error;
  }
  writeLock({
    pid: child.pid,
    port,
    token,
    startedAt: new Date().toISOString(),
    bindIp,
  });
  const url = `http://${LOOPBACK_IP}:${port}/?${intent}`;
  console.log(`piw: bridge attivo su ${url}`);
  if (ipArg) printRemoteAccess(bindIp, port, intent, token);
  if (!noOpen && !detachedRun) openBrowser(url);

  // 4) the launcher stays alive with the bridge; on exit it cleans the lock
  child.on("exit", (code) => {
    clearLock();
    process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

void main().catch((err: unknown) => {
  console.error(`piw: ${err instanceof Error ? err.message : String(err)}`);
  clearLock();
  process.exit(1);
});
