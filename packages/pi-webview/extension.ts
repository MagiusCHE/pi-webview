// pi-webview — estensione pi (package distribuito via `pi install`).
// All'avvio fa DUE ensure: 1) il companion VS Code (installa/aggiorna dal vsix
// incluso se manca o è datato, idempotente) e 2) il link `piw` sul PATH.
// `piw` a sua volta rifà l'ensure del companion VS Code all'avvio.
// Quando pi gira dentro la webview (env PI_WEBVIEW_COMPANION=1) il check del
// companion scatta comunque: è il canale di aggiornamento per chi usa SOLO la
// webview (il pacchetto su disco è aggiornato, il companion installato no).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readVsixVersion } from "./lib/vsix-version.ts";

const execFileAsync = promisify(execFile);

const COMPANION_ID = "magiusche.pi-webview-ide";
const PKG_NAME = "@magiusche/pi-webview";
// `pi remove` vuole il nome CON il prefisso sorgente npm: (come `pi install npm:…`)
const PKG_REF = `npm:${PKG_NAME}`;
const AUTO_INSTALL_ENV = "PI_WEBVIEW_AUTO_INSTALL";
const VSIX_REL = join("companion", "pi-webview-ide.vsix");

// Segnale di reload per l'IDE (contratto multi-IDE, docs/concept/0004):
// quando il companion viene AGGIORNATO mentre l'IDE è aperto, la finestra
// resta sulla versione vecchia caricata in memoria → scriviamo qui la versione
// target; il companion dell'IDE (in esecuzione) la legge e chiede il reload.
const RELOAD_SIGNAL = join(homedir(), ".pi", "pi-webview", "companion-reload.json");

type Notify = (message: string, kind: "info" | "warning" | "error") => void;

// API minimale di pi usata dall'estensione (typed localmente per non
// dipendere da @earendil-works/pi-coding-agent come devDependency).
interface PiApi {
  on(
    event: string,
    handler: (event: unknown, ctx: unknown) => void | Promise<void>,
  ): void;
  registerCommand(
    name: string,
    opts: {
      description?: string;
      handler: (
        args: string,
        ctx: {
          ui: { notify: Notify; input: unknown; confirm: unknown; select: unknown };
        },
      ) => void | Promise<void>;
    },
  ): void;
  // comandi slash disponibili (per il dedupe della registrazione — il check
  // va fatto al session_start: durante il load getCommands è uno stub che
  // lancia "Extension runtime not initialized")
  getCommands(): { name: string }[];
}

function detectIde(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.TERM_PROGRAM?.toLowerCase() === "windsurf") return "windsurf";
  if (env.TERM_PROGRAM?.toLowerCase() === "cursor") return "cursor";
  // stessi marker di pi-x-ide: TERM_PROGRAM=vscode è il marker standard del
  // terminale integrato (senza di esso l'auto-install non scattava mai)
  if (env.TERM_PROGRAM?.toLowerCase() === "vscode") return "vscode";
  if (
    env.VSCODE_PID ||
    env.VSCODE_CWD ||
    env.VSCODE_IPC_HOOK_CLI ||
    env.VSCODE_GIT_IPC_HANDLE
  ) {
    return "vscode";
  }
  return undefined;
}

// Esegue la CLI di VS Code in modo portabile: su Windows `code` è un file
// `.cmd`, che Node non esegue con execFile → si passa da `cmd /c` con il
// quoting dei path (che su Windows contengono spesso spazi).
function runCli(
  cli: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32") {
    const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a));
    return execFileAsync("cmd", ["/c", cli, ...quoted], {
      timeout,
      windowsHide: true,
    });
  }
  return execFileAsync(cli, args, { timeout });
}

async function listExtensions(cli: string): Promise<string> {
  const { stdout } = await runCli(cli, ["--list-extensions", "--show-versions"], 15_000);
  return stdout;
}

// Versione installata del companion (es. `magiusche.pi-webview-ide@0.1.0`),
// `null` se non è installato, "" se presente ma senza versione.
async function installedCompanionVersion(cli: string): Promise<string | null> {
  const out = await listExtensions(cli);
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (t.toLowerCase().startsWith(COMPANION_ID)) {
      const m = /@([^@\s]+)\s*$/.exec(t);
      return m ? (m[1] ?? "") : "";
    }
  }
  return null;
}

async function installCompanion(cli: string, vsixPath: string): Promise<void> {
  await runCli(cli, ["--install-extension", vsixPath, "--force"], 60_000);
}

// Path del bin `piw` sul PATH dell'utente (ex scripts/link-bin.mjs, rimosso):
// Unix → ~/.local/bin/piw (symlink), Windows → %APPDATA%\npm\piw.cmd.
// Override della dir: PIW_BIN_DIR. Nessun postinstall npm: il link lo crea
// l'estensione al primo avvio di pi (ensurePiwBin).
function piwBinPaths(): { dir: string; link: string; target: string; isWindows: boolean } {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const target = join(moduleDir, "piw.js"); // dist/piw.js
  const isWindows = process.platform === "win32";
  const dir =
    process.env.PIW_BIN_DIR ??
    (isWindows
      ? process.env.APPDATA
        ? join(process.env.APPDATA, "npm")
        : ""
      : join(homedir(), ".local", "bin"));
  return {
    dir,
    link: dir ? join(dir, isWindows ? "piw.cmd" : "piw") : "",
    target,
    isWindows,
  };
}

// Crea il link `piw` sul PATH se manca. NIENTE postinstall npm (rimosso per
// non avere install scripts): l'unica via di creazione/aggiornamento del link
// è questo ensure all'avvio di pi. Best effort: mai rompere l'avvio di pi per
// un link. Idempotente: non tocca file regolari utente.
function ensurePiwBin(): void {
  try {
    const { dir, link, target, isWindows } = piwBinPaths();
    if (!dir) return;
    if (isWindows) {
      // .cmd: crea SOLO se manca (mai sovrascrivere un eventuale file utente)
      if (existsSync(link)) return;
      mkdirSync(dir, { recursive: true });
      const content = `@echo off\r\nnode "${target.replace(/"/g, '\\"')}" %*\r\n`;
      writeFileSync(link, content);
      return;
    }
    // lstatSync come check di ESISTENZA (non existsSync): vede i symlink anche
    // DANGLING, che altrimenti non verrebbero mai sostituiti (e symlinkSync
    // fallirebbe con EEXIST sul path esistente)
    let st: ReturnType<typeof lstatSync> | null = null;
    try {
      st = lstatSync(link);
    } catch {
      st = null; // non esiste
    }
    if (st) {
      if (!st.isSymbolicLink()) return; // file regolare utente: non toccare
      const cur = readlinkSync(link);
      if (cur === target) return; // già il nostro link
      rmSync(link); // link a un'altra versione/path di installazione: sostituisci
    }
    mkdirSync(dir, { recursive: true });
    symlinkSync(target, link);
  } catch {
    // best effort: mai rompere l'avvio per un link
  }
}

function writeReloadSignal(version: string): void {
  try {
    mkdirSync(dirname(RELOAD_SIGNAL), { recursive: true });
    writeFileSync(RELOAD_SIGNAL, JSON.stringify({ version }, null, 2) + "\n");
  } catch {
    // best effort: mai rompere l'installazione per un segnale
  }
}

function clearReloadSignal(): void {
  try {
    rmSync(RELOAD_SIGNAL, { force: true });
  } catch {
    // best effort
  }
}

// Rimuove il symlink `piw` dal PATH dell'utente, SOLO se punta al bin di
// questo pacchetto (mai file regolari utente, mai link che puntano altrove).
// Replicato qui perché senza postinstall npm la pulizia del link spetta
// interamente a /pi-webview uninstall.
function unlinkPiwBin(): void {
  const { dir, link, target } = piwBinPaths();
  if (!dir) return;
  try {
    if (!existsSync(link)) return;
    if (!lstatSync(link).isSymbolicLink()) return; // file utente: non toccare
    const cur = readlinkSync(link);
    if (cur !== target) return; // non è il nostro link
    rmSync(link);
  } catch {
    // best effort: mai rompere il comando per un link
  }
}

export default function (pi: PiApi): void {
  // percorso del vsix companion incluso nel package: extension.js sta in dist/,
  // il vsix a livello ROOT del package (companion/…) → risalire di un livello
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const vsixPath = join(moduleDir, "..", VSIX_REL);

  const autoInstall = (process.env[AUTO_INSTALL_ENV] ?? "1").trim().toLowerCase();
  const enabled = !["0", "false", "off", "none"].includes(autoInstall);

  let pendingNotify: string | null = null;

  // ensure 1/2 — companion VS Code: installa/aggiorna se la versione installata
  // non combacia col vsix incluso. Gira ad OGNI avvio di pi (idempotente): non
  // è condizionato dal rilevamento IDE, così anche chi usa solo la webview o
  // lancia pi da un terminale esterno riceve il companion aggiornato.
  // Disattivabile con PI_WEBVIEW_AUTO_INSTALL=0.
  const tryAutoInstall = async (): Promise<void> => {
    if (!enabled) return;
    try {
      const installed = await installedCompanionVersion("code");
      const vsixVersion = readVsixVersion(vsixPath);
      if (installed !== null && vsixVersion !== undefined && installed === vsixVersion) {
        clearReloadSignal(); // già aggiornato: nessun segnale pendente
        return; // già installato e aggiornato
      }
      await installCompanion("code", vsixPath);
      // update (non installazione fresca) → segnala all'IDE aperto il reload
      if (installed !== null && vsixVersion !== undefined) {
        writeReloadSignal(vsixVersion);
      }
      pendingNotify =
        installed === null
          ? "pi-webview: companion installed in VS Code. Reload the window to activate the webview."
          : `pi-webview: companion updated to ${vsixVersion}. Reload the window to activate the webview.`;
    } catch (err) {
      // code CLI assente (ENOENT) → niente VS Code: skip silenzioso; altri
      // errori vanno notificati
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        pendingNotify = `pi-webview: companion install failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  };

  // al caricamento: ensure companion VS Code + ensure link piw (fire and forget)
  void tryAutoInstall();
  ensurePiwBin();

  // la notifica all'utente appena c'è un contesto UI
  pi.on("session_start", (_event, ctx) => {
    const ui = (ctx as { ui?: { notify: Notify } }).ui;
    if (ui && pendingNotify) {
      ui.notify(pendingNotify, "info");
      pendingNotify = null;
    }
  });

  // compattazione fallita/annullata (pi 0.84.3+): inoltra il MOTIVO reale
  // alla UI (webview → status line in chat; TUI → notifica) — l'evento ha
  // reason (aborted/error), retryState, source e errorMessage, che il solo
  // compaction_end non distingue
  pi.on("session_compact_failed", (event, ctx) => {
    const ui = (ctx as { ui?: { notify: Notify } }).ui;
    if (!ui?.notify) return;
    const e = event as {
      reason?: string;
      source?: string;
      retryState?: string;
      errorMessage?: string;
    };
    const reason =
      e.reason === "aborted"
        ? "aborted"
        : e.reason === "error"
          ? "failed"
          : (e.reason ?? "failed");
    const source = e.source ? ` (${e.source})` : "";
    const retry = e.retryState ? ` — retry: ${e.retryState}` : "";
    const err = e.errorMessage ? `: ${e.errorMessage}` : "";
    ui.notify(
      `pi-webview: compaction ${reason}${source}${retry}${err}`,
      "warning",
    );
  });

  // registrazione differita: getCommands() è uno stub che LANCIAA durante il
  // load ("Extension runtime not initialized") → il dedupe può avvenire solo
  // dopo il bind, al primo session_start (che rpc-mode attende PRIMA di
  // processare qualunque comando). Se lo stesso pacchetto è caricato due volte
  // (es. installato npm + `pi -e` in dev) la seconda copia NON registra — con
  // due registrazioni pi mangla il nome in "pi-webview:1"/"pi-webview:2" e il
  // comando non è più invocabile.
  const registerCommand = (): void => {
    pi.registerCommand("pi-webview", {
    description: "Manage the webview IDE integration (status, install, reinstall, uninstall)",
    handler: async (args, ctx) => {
      const [sub] = args.trim().split(/\s+/, 1);
      const notify = ctx.ui.notify;
      switch (sub || "status") {
        case "status": {
          const ide = detectIde();
          const companion = process.env.PI_WEBVIEW_COMPANION === "1";
          // presenza del link piw sul PATH (diagnostica; lstat: vede anche i
          // symlink dangling)
          const { dir, link } = piwBinPaths();
          let piw = "missing";
          try {
            if (dir && lstatSync(link).isSymbolicLink()) piw = "present";
          } catch {
            piw = "missing";
          }
          notify(
            `pi-webview: IDE detected = ${ide ?? "none"}; companion active = ${companion ? "yes (webview)" : "no"}; piw link = ${piw}`,
            "info",
          );
          return;
        }
        case "install":
        case "reinstall": {
          await installCompanion("code", vsixPath);
          notify(
            "pi-webview: companion installed. Reload the VS Code window.",
            "info",
          );
          return;
        }
        case "uninstall": {
          // 1) companion VS Code (se esiste — nessun gate sul rilevamento IDE)
          try {
            const before = await installedCompanionVersion("code");
            if (before === null) {
              notify("pi-webview: companion not installed in VS Code.", "info");
            } else {
              await runCli("code", ["--uninstall-extension", COMPANION_ID], 30_000);
              notify(
                `pi-webview: companion ${COMPANION_ID} removed from VS Code.`,
                "info",
              );
            }
          } catch (err) {
            notify(
              `pi-webview: companion uninstall failed: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
          }
          // 2) link `piw` dal PATH (se è il nostro)
          unlinkPiwBin();
          notify("pi-webview: piw binary link removed from PATH.", "info");
          // 3) rimozione del pacchetto da pi stesso (pi remove npm:<nome>)
          try {
            await runCli("pi", ["remove", PKG_REF], 60_000);
            notify(
              "pi-webview: package removed from pi. Restart pi to finish (reload the VS Code window if the companion was removed).",
              "info",
            );
          } catch (err) {
            notify(
              `pi-webview: pi remove failed (${err instanceof Error ? err.message : String(err)}). Run it manually: pi remove ${PKG_REF}`,
              "error",
            );
          }
          return;
        }
        default:
          notify("pi-webview: subcommands: status | install | reinstall | uninstall", "info");
      }
    },
    });
  };

  pi.on("session_start", () => {
    const already = pi.getCommands().some(
      (c) => c.name === "pi-webview" || c.name.startsWith("pi-webview:"),
    );
    if (!already) registerCommand();
  });
}
