#!/usr/bin/env node
// Bridge standalone (piano 0001 + 0005): espone `pi --mode rpc` su WebSocket
// locale (127.0.0.1 + token) con sessioni multiple. Ogni connessione WS è un
// canale dedicato con il SUO processo pi: l'intento (nuova sessione o resume)
// viene dichiarato dal client nella query del WS (?new=1 / ?session=<path>).
// Inoltro bidirezionale trasparente dei frame JSONL per canale — niente
// broadcast tra client.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Frame, IdeRequest, IdeResponse, RpcEvent } from "../ide/protocol.ts";
import { PiProcess } from "./pi-process.ts";
import { resolvePi, checkBashOnWindows } from "./spawn.ts";
import { createMockIde } from "./mock-ide.ts";
import { ConfigStore, readCompactionSettings } from "./config.ts";
import {
  listSessions,
  forkSession,
  getSessionInfo,
  renameSessionFile,
  deleteSessionFile,
} from "./sessions.ts";
import { getTrust, setTrust } from "./trust.ts";
import { saveAttachment, pathExists } from "./attachments.ts";
import { fetchProviderBalance } from "./balance.ts";
import { clearLock } from "./lock.ts";

// versione del pacchetto pi-webview (il "piw"): risale da dist/ (bridge.cjs)
// al package.json più vicino (in dev: src/bridge → root del repo)
function packageVersion(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    try {
      const json = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf-8"),
      ) as { version?: unknown };
      if (typeof json.version === "string") return json.version;
    } catch {
      // continua a risalire
    }
    dir = dirname(dir);
  }
  return null;
}

interface Options {
  debug: boolean;
  mockIde: boolean;
  serve: string | null;
  open: boolean;
  port: number | null;
  token: string | null;
  piCommand: string;
  idleTimeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    debug: false,
    mockIde: false,
    serve: null,
    open: false,
    port: null,
    token: null,
    piCommand: "pi",
    idleTimeoutMs: 60_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--debug":
        opts.debug = true;
        break;
      case "--mock-ide":
        opts.mockIde = true;
        break;
      case "--open":
        opts.open = true;
        break;
      case "--serve":
        opts.serve = argv[++i] ?? null;
        break;
      case "--port":
        opts.port = Number(argv[++i]);
        break;
      case "--token":
        opts.token = argv[++i] ?? null;
        break;
      case "--pi":
        opts.piCommand = argv[++i] ?? "pi";
        break;
      case "--no-idle":
        opts.idleTimeoutMs = 0;
        break;
      case "--idle-timeout":
        opts.idleTimeoutMs = Number(argv[++i]) * 1000;
        break;
      default:
        console.error(`[bridge] argomento sconosciuto: ${arg}`);
        process.exit(2);
    }
  }
  return opts;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(normalize(root))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

// intent dichiarato dal client nella query del WebSocket
interface Intent {
  kind: "default" | "new" | "session";
  sessionPath?: string;
}

function parseIntent(url: URL): Intent {
  if (url.searchParams.has("session")) {
    return { kind: "session", sessionPath: url.searchParams.get("session") ?? undefined };
  }
  if (url.searchParams.get("new") === "1") return { kind: "new" };
  return { kind: "default" };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const log = opts.debug ? (msg: string) => console.error(`[bridge] ${msg}`) : () => {};

  const pi = resolvePi();
  if (!pi.found) {
    console.error(
      `[bridge] comando '${pi.command}' non trovato nel PATH.\n` +
        "  Installa pi: npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
    );
    process.exit(1);
  }
  const bashWarning = checkBashOnWindows();
  if (bashWarning) console.warn(`[bridge] ATTENZIONE: ${bashWarning}`);

  // comando da spawnare: usa il path risolto (su Windows pi.cmd ha bisogno
  // del path completo), a meno che l'utente non ne passi uno esplicito
  const piCommand = opts.piCommand === "pi" && pi.path ? pi.path : opts.piCommand;

  const token = opts.token ?? randomBytes(16).toString("hex");
  const mockIde = opts.mockIde ? createMockIde((m) => console.error(m)) : null;
  const configStore = new ConfigStore();

  // --- server HTTP (health, config, serve statico opzionale) ---------------
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      // usato da `piw` per validare il lock (single-instance)
      if (url.searchParams.get("token") === token) {
        res.writeHead(200).end("ok");
      } else {
        res.writeHead(401).end("unauthorized");
      }
      return;
    }
    if (url.pathname === "/bridge-config.json") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ wsUrl: `ws://127.0.0.1:${port}?token=${token}` }));
      return;
    }
    if (opts.serve) {
      serveStatic(opts.serve, req, res);
      return;
    }
    res.writeHead(404).end("bridge attivo, ma --serve non specificato");
  });

  // --- WebSocket con autenticazione via token ------------------------------
  const wss = new WebSocketServer({ noServer: true });
  const channels = new Set<Channel>();

  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.searchParams.get("token") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  // --- canale: una connessione WS + il suo processo pi ----------------------
  interface Channel {
    ws: WebSocket;
    workspaceDir: string;
    pi: PiProcess;
    dispose: () => void;
  }

  const createChannel = (ws: WebSocket, intent: Intent): Channel => {
    const send = (frame: Frame) => {
      const text = JSON.stringify(frame);
      log(`→ ui ${text.slice(0, 200)}`);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    };

    const respond = (id: string, payload: Omit<IdeResponse, "id">) =>
      send({ channel: "ide", payload: { ...payload, id } });

    let workspaceDir = process.cwd();
    const makePi = (cwd: string, sessionPath?: string): PiProcess =>
      new PiProcess(
        piCommand,
        {
          onEvent: (event) => send({ channel: "rpc", payload: event as RpcEvent }),
          onStderr: (line) => {
            if (line.trim()) console.error(`[pi:err] ${line}`);
          },
          log,
        },
        {
          cwd,
          ...(sessionPath ? { args: ["--session", sessionPath] } : {}),
        },
      );

    let pi = makePi(workspaceDir, intent.kind === "session" ? intent.sessionPath : undefined);
    pi.start();
    log(`canale aperto (intent=${intent.kind})`);

    // cambio workspace: riavvia pi con la nuova cwd
    const switchWorkspace = (newCwd: string): Promise<void> =>
      new Promise((resolve) => {
        workspaceDir = newCwd;
        pi.dispose();
        pi = makePi(newCwd);
        pi.start();
        resolve();
      });

    const handleIde = (req: IdeRequest): void => {
      if (req.type === "getConfig") {
        respond(req.id ?? "", { ok: true, data: configStore.get() });
        return;
      }
      if (req.type === "setConfig") {
        configStore.patch(req.patch);
        log(`config aggiornata: ${JSON.stringify(req.patch)}`);
        respond(req.id ?? "", { ok: true, data: configStore.get() });
        return;
      }
      if (req.type === "getWorkspace") {
        respond(req.id ?? "", { ok: true, data: { workspace: workspaceDir } });
        return;
      }
      if (req.type === "getVersion") {
        respond(req.id ?? "", {
          ok: true,
          data: { source: "piw", version: packageVersion() },
        });
        return;
      }
      if (req.type === "getBalance") {
        void fetchProviderBalance(req.provider).then((b) =>
          respond(req.id ?? "", { ok: true, data: b ?? null }),
        );
        return;
      }
      if (req.type === "getCompactionSettings") {
        respond(req.id ?? "", { ok: true, data: readCompactionSettings() });
        return;
      }
      if (req.type === "listDir") {
        try {
          const dirs = readdirSync(req.path, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name)
            .sort((a, b) => a.localeCompare(b));
          respond(req.id ?? "", { ok: true, data: { path: req.path, dirs } });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `lettura cartella fallita: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "setWorkspace") {
        let sessionPath: string | undefined;
        try {
          if (req.action === "fork" && req.sessionPath) {
            const res = forkSession(req.sessionPath, req.path);
            sessionPath = (res as { path?: string }).path;
          }
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `fork nella nuova cartella fallito: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        void switchWorkspace(req.path)
          .then(() =>
            respond(req.id ?? "", { ok: true, data: { workspace: req.path, sessionPath } }),
          )
          .catch((err: unknown) =>
            respond(req.id ?? "", {
              ok: false,
              error: `cambio workspace fallito: ${err instanceof Error ? err.message : String(err)}`,
            }),
          );
        return;
      }
      if (req.type === "listSessions") {
        respond(req.id ?? "", {
          ok: true,
          data: { sessions: listSessions(undefined, req.workspace ?? workspaceDir), workspace: workspaceDir },
        });
        return;
      }
      if (req.type === "getTrust") {
        respond(req.id ?? "", { ok: true, data: getTrust(workspaceDir) });
        return;
      }
      if (req.type === "setTrust") {
        respond(req.id ?? "", {
          ok: true,
          data: setTrust(workspaceDir, req.status),
        });
        return;
      }
      if (req.type === "saveAttachment") {
        try {
          const res = saveAttachment(req.name, req.mimeType, req.dataBase64);
          respond(req.id ?? "", { ok: true, data: res });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `salvataggio allegato fallito: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "pathExists") {
        respond(req.id ?? "", { ok: true, data: { exists: pathExists(req.path) } });
        return;
      }
      if (req.type === "getSessionInfo") {
        try {
          respond(req.id ?? "", { ok: true, data: getSessionInfo(req.path) });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `info sessione non disponibile: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "renameSession") {
        try {
          renameSessionFile(req.path, req.name);
          respond(req.id ?? "", { ok: true, data: { path: req.path, name: req.name } });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `rinomina non riuscita: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "deleteSession") {
        try {
          deleteSessionFile(req.path);
          respond(req.id ?? "", { ok: true });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `eliminazione non riuscita: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "storeSteerQueue") {
        steerQueueStore.items = req.items;
        respond(req.id ?? "", { ok: true });
        return;
      }
      if (req.type === "getSteerQueue") {
        respond(req.id ?? "", { ok: true, data: { items: steerQueueStore.items } });
        return;
      }
      if (req.type === "forkSession") {
        try {
          const res = forkSession(req.sourcePath, workspaceDir);
          respond(req.id ?? "", { ok: true, data: res });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `fork fallito: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (mockIde) {
        mockIde.handle(req, (out) => {
          const text = JSON.stringify(out);
          log(`→ ui ${text.slice(0, 200)}`);
          if (ws.readyState === WebSocket.OPEN) ws.send(text);
        });
      } else {
        respond(req.id ?? "", {
          ok: false,
          error: "nessun IDE (usa --mock-ide per simulare)",
        });
      }
    };

    ws.on("message", (data) => {
      let frame: Frame;
      try {
        frame = JSON.parse(data.toString()) as Frame;
      } catch {
        log("frame non JSON da client, ignorato");
        return;
      }
      if (frame.channel === "rpc") {
        pi.send(frame.payload);
        return;
      }
      if (frame.channel === "ide") {
        handleIde(frame.payload as IdeRequest);
        return;
      }
      log("canale sconosciuto, ignorato");
    });

    const dispose = (): void => {
      pi.dispose();
      channels.delete(channel);
    };
    ws.on("close", () => {
      log("canale chiuso (tab chiusa)");
      dispose();
    });
    ws.on("error", dispose);

    const channel: Channel = { ws, workspaceDir, pi, dispose };
    channels.add(channel);
    log(`client connesso (canali totali: ${channels.size})`);
    return channel;
  };

  // --- idle shutdown ----------------------------------------------------------
  // Spegnimento automatico dopo `idleTimeoutMs` senza NESSUN client connesso:
  // la connessione WebSocket aperta è già il segnale di attività (non serve
  // keep-alive esplicito); il countdown parte quando l'ultima tab si chiude.
  let activeConnections = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // coda stearing persistita (standalone: in memoria per la durata del bridge)
  const steerQueueStore: { items: { text: string }[] } = { items: [] };

  const startIdleTimer = () => {
    if (opts.idleTimeoutMs <= 0 || activeConnections > 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log(`[bridge] nessun client per ${opts.idleTimeoutMs / 1000}s — spegnimento`);
      shutdown(0);
    }, opts.idleTimeoutMs);
  };
  const cancelIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    activeConnections++;
    cancelIdleTimer();
    const channel = createChannel(ws, parseIntent(url));
    ws.on("close", () => {
      activeConnections--;
      if (activeConnections === 0) startIdleTimer();
    });
  });

  // --- startup ---------------------------------------------------------------
  let port = opts.port ?? 0;
  const server = http.listen(port, "127.0.0.1", () => {
    const addr = http.address();
    port = typeof addr === "object" && addr ? addr.port : port;
    const wsUrl = `ws://127.0.0.1:${port}?token=${token}`;
    console.log(`BRIDGE_READY ${wsUrl}`);
    console.log(opts.serve ? `UI:  http://127.0.0.1:${port}/` : `WS:  ${wsUrl}`);
    if (opts.serve && opts.open) openBrowser(`http://127.0.0.1:${port}/`);
    startIdleTimer();
  });

  // --- shutdown ---------------------------------------------------------------
  const shutdown = (code: number) => {
    for (const ch of channels) ch.dispose();
    wss.close();
    server.close();
    clearLock();
    process.exit(code);
  };
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
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

main();
