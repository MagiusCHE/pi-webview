// piw — runs pi-webview standalone from the installed package (plan 0005).
// npm bin (`"bin": { "piw": "dist/piw.js" }`): npm generates the shim
// (script/symlink on Linux/macOS, `piw.cmd` on Windows).
//
// Usage:
//   piw                      → opens a NEW session (new tab, if needed)
//   piw --session <id>       → resumes a session (partial id or path;
//                              the cwd is set by pi from the session)
//   piw --port N             → fixed port (default: random)
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
import { resolvePi } from "./spawn.ts";
import {
  readLock,
  writeLock,
  clearLock,
  pidAlive,
  healthCheck,
} from "./lock.ts";
import { ensureVscodeCompanion } from "./companion.ts";

// dist/piw.js → root of the installed package
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeJs = join(root, "dist", "bridge.cjs");
const webDir = join(root, "dist", "web");

// package version (for --version and the launch line)
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

// VS Code companion check (fire and forget: never block startup)
// split: pi extension → only piw link; piw → only VS Code companion
void ensureVscodeCompanion(root).then((msg) => {
  if (msg) console.log(msg);
});

for (const f of [bridgeJs, webDir]) {
  if (!existsSync(f)) {
    console.error(`piw: manca ${f} — pacchetto installato incompleto`);    process.exit(1);
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
const debug = argv.includes("--debug");

// extra arguments passed to the bridge (e.g. --no-idle, --idle-timeout, --mock-ide)
const extra: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-open" || a === "--debug") continue;
  if (a === "--session" || a === "--port" || a === "--pi") {
    i++; // skip the value too
    continue;
  }
  if (a === "--background" || a === "-b" || a === "--kill" || a === "-k") continue;
  if (a !== undefined) extra.push(a);
}

// intent for the UI: new session (default) or resume of an existing one
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
  // 0a) --version | -V: prints ONLY the version and exits
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(`piw ${piwVersion}`);
    process.exit(0);
  }

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
        // default: opens the browser; with --no-open prints only the link
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

  // 1) bridge already active? → reuse (no second bridge)
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

  // 2) new bridge: token generated here (the bridge uses it and the lock records it)
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
  const child = spawn(process.execPath, bridgeArgs, {
    stdio: ["ignore", "pipe", "inherit"],
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
  writeLock({ pid: child.pid, port, token, startedAt: new Date().toISOString() });
  const url = `http://127.0.0.1:${port}/?${intent}`;
  console.log(`piw: bridge attivo su ${url}`);
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
