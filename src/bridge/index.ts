#!/usr/bin/env node
// Standalone bridge (plans 0001 + 0005): exposes `pi --mode rpc` over a local
// WebSocket (127.0.0.1 + token) with multiple sessions. Each WS connection is
// a dedicated channel with its OWN pi process: the intent (new session or
// resume) is declared by the client in the WS query (?new=1 / ?session=<path>).
// Transparent bidirectional forwarding of JSONL frames per channel — no
// broadcast between clients.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { CliFlags, Frame, IdeRequest, IdeResponse, RpcEvent } from "../ide/protocol.ts";
import { PiProcess } from "./pi-process.ts";
import { resolvePi } from "./spawn.ts";
import { cliFlagArgs, fetchAvailableCliFlags } from "./cli-flags.ts";
import { createMockIde } from "./mock-ide.ts";
import {
  ConfigStore,
  readCompactionSettings,
  readThinkingSettings,
} from "./config.ts";
import {
  listSessions,
  forkSession,
  getSessionInfo,
  renameSessionFile,
  deleteSessionFile,
  readSessionSettings,
  writeSessionSettings,
  readSessionCliFlags,
  writeSessionCliFlags,
} from "./sessions.ts";
import { getTrust, setTrust } from "./trust.ts";
import { readStartupInfo } from "./startup-info.ts";
import {
  saveAttachment,
  pathExists,
  attachFromPath,
} from "./attachments.ts";
import { fetchProviderBalance } from "./balance.ts";
import { clearLock } from "./lock.ts";

// same deterministic log as the VS Code companion: ~/.pi/pi-webview/companion.log
const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB: reset only at session startup
function bridgeLog(msg: string): void {
  try {
    const dir = join(homedir(), ".pi", "pi-webview");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "companion.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // best effort
  }
}
// called ONLY at bridge startup: reset the log if it exceeds 2MB
function resetBridgeLogIfOversized(): void {
  try {
    const file = join(homedir(), ".pi", "pi-webview", "companion.log");
    if (statSync(file).size > MAX_LOG_BYTES) writeFileSync(file, "");
  } catch {
    // missing file: nothing to reset
  }
}
let notifySeq = 0;

// pi-webview package version (the "piw"): climbs from dist/ (bridge.cjs)
// to the nearest package.json (in dev: src/bridge → repo root)
function packageVersion(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 4; i++) {
    try {
      const json = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf-8"),
      ) as { version?: unknown };
      if (typeof json.version === "string") return json.version;
    } catch {
      // keep climbing up
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
        console.error(`[bridge] unknown argument: ${arg}`);
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

// intent declared by the client in the WebSocket query
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
  resetBridgeLogIfOversized(); // session startup: reset the log if it exceeds 2MB
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
  // command to spawn: use the resolved path (on Windows pi.cmd needs the
  // full path), unless the user passes an explicit one
  const piCommand = opts.piCommand === "pi" && pi.path ? pi.path : opts.piCommand;

  const token = opts.token ?? randomBytes(16).toString("hex");
  const mockIde = opts.mockIde ? createMockIde((m) => console.error(m)) : null;
  const configStore = new ConfigStore();
  let availableCliFlagsPromise: ReturnType<typeof fetchAvailableCliFlags> | null = null;
  const availableCliFlags = () => {
    if (!availableCliFlagsPromise) {
      availableCliFlagsPromise = fetchAvailableCliFlags(piCommand, (message) => {
        bridgeLog(message);
        log(message);
      });
    }
    return availableCliFlagsPromise;
  };

  // --- HTTP server (health, config, optional static serve) -----------------
// stderr forwarding quota (terminal parity, no thread flooding)
let stderrWindowStart = 0;
let stderrCount = 0;
function stderrAllowed(): boolean {
  const now = Date.now();
  if (now - stderrWindowStart > 5000) {
    stderrWindowStart = now;
    stderrCount = 0;
  }
  return stderrCount++ < 25;
}
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      // used by `piw` to validate the lock (single-instance)
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

  // --- WebSocket with token authentication ---------------------------------
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

  // --- channel: one WS connection + its pi process --------------------------
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
    let currentSessionPath =
      intent.kind === "session" ? intent.sessionPath : undefined;
    const makePi = (
      cwd: string,
      sessionPath?: string,
      flags: CliFlags = readSessionCliFlags(sessionPath ?? ""),
    ): PiProcess =>
      new PiProcess(
        piCommand,
        {
          onEvent: (event) => send({ channel: "rpc", payload: event as RpcEvent }),
          onStderr: (line) => {
            if (!line.trim()) return;
            console.error(`[pi:err] ${line}`);
            // terminal parity: forward pi stderr to the webview (capped)
            if (stderrAllowed()) {
              send({ channel: "rpc", payload: { type: "pi_stderr", line } });
            }
          },
          // OSC 777 notify (turn complete etc.): the webview turns it into a
          // browser notification when the window is hidden
          onNotify: (n) => {
            const seq = ++notifySeq;
            console.error(`[bridge] notify #${seq} title=${n.title}`);
            bridgeLog(`bridge notify #${seq} title=${n.title} body=${(n.body ?? "").slice(0, 60)}`);
            send({
              channel: "rpc",
              payload: { type: "pi_notify", title: n.title, body: n.body },
            });
          },
          log,
        },
        {
          cwd,
          args: [
            ...(sessionPath ? ["--session", sessionPath] : []),
            ...cliFlagArgs(flags),
          ],
        },
      );

    let pi = makePi(workspaceDir, currentSessionPath);
    pi.start();
    log(`channel open (intent=${intent.kind})`);

    const restartPi = (sessionPath: string | undefined, flags: CliFlags): void => {
      currentSessionPath = sessionPath;
      pi.dispose();
      send({
        channel: "rpc",
        payload: { type: "connection_closed", reason: "restart" },
      });
      pi = makePi(workspaceDir, sessionPath, flags);
      pi.start();
      send({ channel: "rpc", payload: { type: "pi_restarted" } });
    };

    // Workspace change: restart pi with the new cwd. `sessionPath` is used by
    // the standalone cross-workspace resume action: pi starts directly on the
    // selected session, with no temporary new session and no fork.
    const switchWorkspace = (
      newCwd: string,
      sessionPath?: string,
    ): Promise<void> =>
      new Promise((resolve) => {
        workspaceDir = newCwd;
        currentSessionPath = sessionPath;
        pi.dispose();
        pi = makePi(newCwd, sessionPath);
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
        log(`config updated: ${JSON.stringify(req.patch)}`);
        respond(req.id ?? "", { ok: true, data: configStore.get() });
        return;
      }
      if (req.type === "getSessionSettings") {
        respond(req.id ?? "", {
          ok: true,
          data: readSessionSettings(req.sessionPath ?? ""),
        });
        return;
      }
      if (req.type === "setSessionSettings") {
        // write INSIDE the session file (custom entry): no global config keys
        const path = req.sessionPath ?? "";
        writeSessionSettings(path, req.settings ?? {});
        respond(req.id ?? "", { ok: true, data: readSessionSettings(path) });
        return;
      }
      if (req.type === "getStartupInfo") {
        // new-session welcome banner: NON-persistent (per-process file written
        // by the pi-side extension at session_start — never in the session jsonl)
        respond(req.id ?? "", { ok: true, data: { info: readStartupInfo(pi.pid) } });
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
      if (req.type === "getCliFlags") {
        const sessionPath = req.sessionPath ?? currentSessionPath ?? "";
        if (sessionPath) currentSessionPath = sessionPath;
        void availableCliFlags().then((available) =>
          respond(req.id ?? "", {
            ok: true,
            data: {
              available,
              values: readSessionCliFlags(sessionPath),
            },
          }),
        );
        return;
      }
      if (req.type === "setCliFlags") {
        const sessionPath = req.sessionPath ?? currentSessionPath;
        const next = req.flags ?? {};
        if (sessionPath) writeSessionCliFlags(sessionPath, next);
        respond(req.id ?? "", { ok: true, data: { flags: next } });
        restartPi(sessionPath, next);
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
      if (req.type === "getThinkingSettings") {
        respond(req.id ?? "", {
          ok: true,
          data: readThinkingSettings(workspaceDir),
        });
        return;
      }
      if (req.type === "listDir") {
        try {
          const path = normalize(req.path);
          const parentPath = dirname(path);
          const dirs = readdirSync(path, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => ({ name: d.name, path: join(path, d.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          respond(req.id ?? "", {
            ok: true,
            data: {
              path,
              parent: parentPath === path ? null : parentPath,
              dirs,
            },
          });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `folder listing failed: ${err instanceof Error ? err.message : String(err)}`,
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
          } else if (req.action === "resume") {
            if (!req.sessionPath) {
              respond(req.id ?? "", {
                ok: false,
                error: "workspace resume requires a session path",
              });
              return;
            }
            sessionPath = req.sessionPath;
          }
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `fork into the new folder failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        void switchWorkspace(
          req.path,
          req.action === "resume" ? sessionPath : undefined,
        )
          .then(() =>
            respond(req.id ?? "", { ok: true, data: { workspace: req.path, sessionPath } }),
          )
          .catch((err: unknown) =>
            respond(req.id ?? "", {
              ok: false,
              error: `workspace switch failed: ${err instanceof Error ? err.message : String(err)}`,
            }),
          );
        return;
      }
      if (req.type === "listSessions") {
        // ALL mode: the webview sends NO workspace → list EVERY project folder
        // (the old `req.workspace ?? workspaceDir` fallback filtered to the
        // current folder even in ALL mode). With a workspace → filter to it.
        const sessions = req.workspace
          ? listSessions(undefined, req.workspace)
          : listSessions(undefined);
        respond(req.id ?? "", {
          ok: true,
          data: { sessions, workspace: workspaceDir },
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
            error: `attachment save failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "attachPath") {
        try {
          respond(req.id ?? "", { ok: true, data: attachFromPath(req.path) });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `attach failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (req.type === "pickFile") {
        // standalone: the browser cannot open the VS Code dialog — the attach
        // button is hidden outside the IDE; answer an error just in case
        respond(req.id ?? "", {
          ok: false,
          error: "pickFile: solo nell'IDE (VS Code)",
        });
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
            error: `session info unavailable: ${err instanceof Error ? err.message : String(err)}`,
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
            error: `rename failed: ${err instanceof Error ? err.message : String(err)}`,
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
            error: `deletion failed: ${err instanceof Error ? err.message : String(err)}`,
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
      // standalone: the webview shows browser notifications itself — nothing to do
      if (req.type === "notifyDesktop") {
        respond(req.id ?? "", { ok: true });
        return;
      }
      // debug: webview-side notify counter (double-notification investigation)
      if (req.type === "debugNotify") {
        bridgeLog(`webview pi_notify #${String(req.count ?? "?")}`);
        respond(req.id ?? "", { ok: true });
        return;
      }
      if (req.type === "forkSession") {
        try {
          const res = forkSession(req.sourcePath, workspaceDir);
          respond(req.id ?? "", { ok: true, data: res });
        } catch (err) {
          respond(req.id ?? "", {
            ok: false,
            error: `fork failed: ${err instanceof Error ? err.message : String(err)}`,
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
          error: "no IDE (use --mock-ide to simulate)",
        });
      }
    };

    ws.on("message", (data) => {
      let frame: Frame;
      try {
        frame = JSON.parse(data.toString()) as Frame;
      } catch {
        log("non-JSON frame from client, ignored");
        return;
      }
      if (frame.channel === "rpc") {
        const payload = frame.payload as { type?: string; sessionPath?: string };
        if (payload.type === "switch_session" && payload.sessionPath) {
          currentSessionPath = payload.sessionPath;
        } else if (payload.type === "new_session") {
          currentSessionPath = undefined;
        }
        pi.send(frame.payload);
        return;
      }
      if (frame.channel === "ide") {
        handleIde(frame.payload as IdeRequest);
        return;
      }
      log("unknown channel, ignored");
    });

    const dispose = (): void => {
      pi.dispose();
      channels.delete(channel);
    };
    ws.on("close", () => {
      log("channel closed (tab closed)");
      dispose();
    });
    ws.on("error", dispose);

    const channel: Channel = { ws, workspaceDir, pi, dispose };
    channels.add(channel);
    log(`client connected (total channels: ${channels.size})`);
    return channel;
  };

  // --- idle shutdown ----------------------------------------------------------
  // Automatic shutdown after `idleTimeoutMs` with NO connected client:
  // an open WebSocket connection is already the activity signal (no explicit
  // keep-alive needed); the countdown starts when the last tab closes.
  let activeConnections = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // persistent steering queue (standalone: in memory for the bridge lifetime)
  const steerQueueStore: { items: { text: string }[] } = { items: [] };

  const startIdleTimer = () => {
    if (opts.idleTimeoutMs <= 0 || activeConnections > 0) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      console.log(`[bridge] no client for ${opts.idleTimeoutMs / 1000}s — shutting down`);
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
