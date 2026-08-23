// piw — avvia pi-webview standalone dal pacchetto installato (piano 0005).
// Binario npm (`"bin": { "piw": "dist/piw.js" }`): npm genera lo shim
// (script/symlink su Linux/macOS, `piw.cmd` su Windows).
//
// Uso:
//   piw                      → apre una NUOVA sessione (nuova tab, se serve)
//   piw --session <id>       → riprende una sessione (id parziale o path;
//                              la cwd la imposta pi dalla sessione)
//   piw --port N             → porta fissa (default: casuale)
//   piw --no-open            → non apre il browser: stampa il link in console
//   piw --pi <comando>       → comando pi alternativo
//   piw --background | -b    → avvia in background (fire-and-forget),
//                              staccato dal terminale, e apre il browser;
//                              con --no-open stampa solo il link
//   piw -k | --kill          → ferma il bridge in background
//
// Single-instance: un SOLO bridge in ascolto per utente. Se un bridge è già
// attivo (lock valido: pid vivo + /health col token), piw NON ne avvia un
// secondo: apre solo una nuova tab del browser verso il bridge esistente.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { resolvePi } from "./spawn.ts";
import {
  readLock,
  writeLock,
  clearLock,
  pidAlive,
  healthCheck,
} from "./lock.ts";
import { ensureVscodeCompanion } from "./companion.ts";

// dist/piw.js → root del pacchetto installato
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeJs = join(root, "dist", "bridge.cjs");
const webDir = join(root, "dist", "web");

// versione del pacchetto (per --version e per la riga di avvio)
const piwVersion: string = (() => {
  try {
    const json = JSON.parse(
      readFileSync(join(root, "package.json"), "utf-8"),
    ) as { version?: unknown };
    return typeof json.version === "string" ? json.version : "?";
  } catch {
    return "?";
  }
})();

// verifica del companion VS Code (fire and forget: mai bloccare l'avvio)
// divisione: estensione pi → solo link piw; piw → solo companion VS Code
void ensureVscodeCompanion(root).then((msg) => {
  if (msg) console.log(msg);
});

for (const f of [bridgeJs, webDir]) {
  if (!existsSync(f)) {
    console.error(`piw: manca ${f} — pacchetto installato incompleto`);
    process.exit(1);
  }
}

const argv = process.argv.slice(2).filter((a) => a !== "--");
// ^ il separatore `--` (convenzione: piw -- -b) non è un argomento reale:
const value = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const noOpen = argv.includes("--no-open");
const background = argv.includes("--background") || argv.includes("-b");
const kill = argv.includes("--kill") || argv.includes("-k");
// processo già staccato (rilancio interno di --background)
const detachedRun = process.env.PIW_DETACHED === "1";
const session = value("--session");
const portArg = value("--port");
const piArg = value("--pi");
const debug = argv.includes("--debug");

// argomenti extra passati al bridge (es. --no-idle, --idle-timeout, --mock-ide)
const extra: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-open" || a === "--debug") continue;
  if (a === "--session" || a === "--port" || a === "--pi") {
    i++; // salta anche il valore
    continue;
  }
  if (a === "--background" || a === "-b" || a === "--kill" || a === "-k") continue;
  if (a !== undefined) extra.push(a);
}

// intent per la UI: nuova sessione (default) o resume di una esistente
const intent = session
  ? `session=${encodeURIComponent(session)}`
  : "new=1";

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
  // 0a) --version | -V: stampa SOLO la versione ed esce
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`piw ${piwVersion}`);
    process.exit(0);
  }

  // ogni lancio dice la sua versione
  console.log(`piw ${piwVersion}`);

  // 0b) --kill: ferma il bridge in background (il pid è nel lock)
  if (kill) {
    const l = readLock();
    if (l && pidAlive(l.pid) && (await healthCheck(l.port, l.token))) {
      try {
        process.kill(l.pid, "SIGTERM");
      } catch {
        // processo già terminato: prosegue con la pulizia
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

  // 0) --background: si rilancia staccato dal terminale e il processo
  //    originale esce subito (cross-platform: detached=true di Node).
  //    Il figlio (PIW_DETACHED=1) fa il lavoro normale e resta vivo col bridge.
  //    Il parent NON esce finché il lock non è valido: evita la race dove un
  //    `piw` successivo immediato troverebbe il lock assente e avvierebbe
  //    un secondo bridge.
  if (background && !detachedRun) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...argv], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PIW_DETACHED: "1" },
    });
    child.unref();
    console.log("piw: avvio in background…");
    const deadline = Date.now() + 10_000;
    for (;;) {
      const l = readLock();
      if (l && pidAlive(l.pid) && (await healthCheck(l.port, l.token))) {
        const url = `http://127.0.0.1:${l.port}/?${intent}`;
        // default: apre il browser; con --no-open stampa solo il link
        if (noOpen) {
          console.log(`piw: bridge attivo su ${url}`);
        } else {
          openBrowser(url);
          console.log(`piw: bridge attivo su http://127.0.0.1:${l.port} (background).`);
        }
        return;
      }
      if (Date.now() > deadline) {
        console.error("piw: il bridge non è diventato attivo entro 10s — controlla i log");
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // 1) bridge già attivo? → riusa (niente secondo bridge)
  const lock = readLock();
  if (lock && pidAlive(lock.pid) && (await healthCheck(lock.port, lock.token))) {
    const url = `http://127.0.0.1:${lock.port}/?${intent}`;
    console.log(`piw: bridge già attivo su http://127.0.0.1:${lock.port} — apro ${intent}`);
    if (!noOpen && !detachedRun) openBrowser(url);
    return;
  }
  if (lock) {
    console.log("piw: lock stantio (bridge non raggiungibile) — avvio un nuovo bridge");
  }

  // 2) nuovo bridge: token generato qui (il bridge lo usa e il lock lo registra)
  const token = randomBytes(16).toString("hex");
  const bridgeArgs = [
    bridgeJs,
    "--serve",
    webDir,
    "--token",
    token,
    ...(portArg ? ["--port", portArg] : []),
    ...(piArg ? ["--pi", piArg] : []),
    ...(debug ? ["--debug"] : []),
    ...extra,
  ];

  // risolve `pi` nel PATH e lo passa esplicitamente al bridge (portabile:
  // su Windows lo shim è pi.cmd, con path assoluto e eventuali spazi)
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
  const child = spawn(process.execPath, bridgeArgs, {
    stdio: ["ignore", "pipe", "inherit"],
  });

  // 3) attende BRIDGE_READY per conoscere la porta reale e registrare il lock
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
  writeLock({ pid: child.pid, port, token, startedAt: new Date().toISOString() });
  const url = `http://127.0.0.1:${port}/?${intent}`;
  console.log(`piw: bridge attivo su ${url}`);
  if (!noOpen && !detachedRun) openBrowser(url);

  // 4) il launcher resta vivo con il bridge; su uscita pulisce il lock
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
