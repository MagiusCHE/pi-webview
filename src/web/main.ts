// UI web (piano 0001): stream dei messaggi di pi, input, abort, attach,
// tema (D7) e locale (i18n). Header: dropdown sessioni + settings (gear).
// Non dipende da VS Code: parla il bridge protocol.

import type {
  Frame,
  IdeEvent,
  RpcEvent,
  IdeRequest,
  IdeResponse,
  UserConfig,
  SessionInfo,
  SessionListResult,
  CliFlags,
  CliFlagInfo,
} from "../ide/protocol.ts";
import { rpc } from "../ide/protocol.ts";
import {
  createWsTransport,
  createVsCodeTransport,
  type Transport,
} from "../ide/transport.ts";
import {
  emptyStream,
  handleRpcEvent,
  type FinalizedMessage,
  type ToolCallInfo,
  type UiAction,
} from "../ide/events.ts";
import { applyTheme, watchThemeChanges } from "./theme.ts";
import type { ThemePreference } from "../ide/protocol.ts";
import { currentLocale, setLocale, t, tpl, isLocaleId, type LocaleId } from "./i18n.ts";
import { runtime } from "./environment.ts";
import { renderMarkdown } from "./markdown.ts";
import { toolSummary, type ToolSummary } from "./tool-summary.ts";
import {
  trustIcon,
  sendIcon,
  stopIcon,
  attachFileIcon,
  newChatIcon,
  settingsIcon,
  chatIcon,
  folderIcon,
  scrollDownIcon,
  copyIcon,
  checkIcon,
  pencilIcon,
  trashIcon,
  type TrustIconKind,
} from "./icons.ts";

const els = {
  connDot: document.getElementById("conn-dot") as HTMLSpanElement,
  sessionBtn: document.getElementById("session-btn") as HTMLButtonElement,
  sessionMenu: document.getElementById("session-menu") as HTMLDivElement,
  sessionFilters: document.getElementById("session-filters") as HTMLDivElement,
  sessionItems: document.getElementById("session-items") as HTMLDivElement,
  settingsBtn: document.getElementById("btn-settings") as HTMLButtonElement,
  settingsModal: document.getElementById("settings-modal") as HTMLDivElement,
  settingsClose: document.getElementById("btn-settings-close") as HTMLButtonElement,
  settingsModalTitle: document.getElementById("settings-modal-title") as HTMLSpanElement,
  lang: document.getElementById("lang") as HTMLSelectElement,
  langLabel: document.getElementById("settings-lang-label") as HTMLLabelElement,
  historyInput: document.getElementById("settings-history-limit") as HTMLInputElement,
  historyLabel: document.getElementById("settings-history-label") as HTMLLabelElement,
  themeLabel: document.getElementById("settings-theme-label") as HTMLLabelElement,
  settingsVersionLabel: document.getElementById("settings-version-label") as HTMLLabelElement,
  settingsVersion: document.getElementById("settings-version") as HTMLSpanElement,
  pidevTitle: document.getElementById("settings-pidev-title") as HTMLDivElement,
  pidevNote: document.getElementById("settings-pidev-note") as HTMLDivElement,
  cliFlags: document.getElementById("cli-flags") as HTMLDivElement,
  cliApplyRow: document.getElementById("cli-apply-row") as HTMLDivElement,
  cliApply: document.getElementById("cli-apply") as HTMLButtonElement,
  cliApplyHint: document.getElementById("cli-apply-hint") as HTMLSpanElement,
  themeRow: document.querySelector(".theme-row") as HTMLDivElement,
  newChat: document.getElementById("btn-new-chat") as HTMLButtonElement,
  thread: document.getElementById("thread") as HTMLElement,
  messages: document.getElementById("messages") as HTMLElement,
  statsBadge: document.getElementById("stats-badge") as HTMLDivElement,
  balanceChip: document.getElementById("balance-chip") as HTMLSpanElement,
  statsCtx: document.querySelector(".stats-ctx") as HTMLSpanElement,
  ctxFill: document.getElementById("ctx-fill") as unknown as SVGCircleElement,
  ctxLabel: document.getElementById("ctx-label") as HTMLSpanElement,
  statsSlots: document.getElementById("stats-slots") as HTMLSpanElement,
  statsStop: document.getElementById("btn-stop") as HTMLButtonElement,
  inputBox: document.querySelector(".input-box") as HTMLElement,
  scrollBottom: document.getElementById("scroll-bottom") as HTMLButtonElement,
  connectPanel: document.getElementById("connect-panel") as HTMLDivElement,
  connectUrl: document.getElementById("connect-url") as HTMLInputElement,
  connectBtn: document.getElementById("btn-connect") as HTMLButtonElement,
  input: document.getElementById("input") as HTMLTextAreaElement,
  cmdDropdown: document.getElementById("cmd-dropdown") as HTMLDivElement,
  cmdList: document.getElementById("cmd-list") as HTMLDivElement,
  cmdCounter: document.getElementById("cmd-counter") as HTMLSpanElement,
  steerPanel: document.getElementById("steer-panel") as HTMLDivElement,
  selectionPanel: document.getElementById("selection-panel") as HTMLDivElement,
  attachmentRow: document.getElementById("attachment-row") as HTMLDivElement,
  bootLoader: document.getElementById("boot-loader") as HTMLDivElement,
  bootLoaderText: document.getElementById("boot-loader-text") as HTMLSpanElement,
  dropOverlay: document.getElementById("drop-overlay") as HTMLDivElement,
  dropOverlayIcon: document.getElementById("drop-overlay-icon") as HTMLSpanElement,
  dropOverlayText: document.getElementById("drop-overlay-text") as HTMLSpanElement,
  send: document.getElementById("btn-send") as HTMLButtonElement,
  trust: document.getElementById("trust") as HTMLButtonElement,
  trustIcon: document.getElementById("trust-icon") as HTMLSpanElement,
  trustLabel: document.getElementById("trust-label") as HTMLSpanElement,
  btnModel: document.getElementById("btn-model") as HTMLButtonElement,
  modelInfo: document.getElementById("model-info") as HTMLSpanElement,
  btnThinking: document.getElementById("btn-thinking") as HTMLButtonElement,
  thinkingInfo: document.getElementById("thinking-info") as HTMLSpanElement,
};

// --- bootstrap del trasporto ------------------------------------------------
// Priorità: webview VS Code (postMessage) → query ?bridge= → env Vite →
// /bridge-config.json servito dal bridge (stessa origine, solo --serve).

async function resolveBridgeUrl(): Promise<string | null> {
  const fromQuery = new URLSearchParams(location.search).get("bridge");
  if (fromQuery) return fromQuery;
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_BRIDGE_URL;
  if (fromEnv) return fromEnv;
  let url: string | null = null;
  try {
    const res = await fetch("/bridge-config.json", { cache: "no-store" });
    if (res.ok) {
      const cfg = (await res.json()) as { wsUrl?: string };
      if (cfg.wsUrl) url = cfg.wsUrl;
    }
  } catch {
    // nessun bridge sulla stessa origine
  }
  // intent del canale (piano 0005): new=1 (nuova sessione) o
  // session=<path> (resume) propagati dalla query della pagina al WebSocket
  if (url && !runtime.isVsCode) {
    const p = new URLSearchParams(location.search);
    if (p.get("new") === "1") {
      url += (url.includes("?") ? "&" : "?") + "new=1";
    }
    const s = p.get("session");
    if (s) {
      url += (url.includes("?") ? "&" : "?") + `session=${encodeURIComponent(s)}`;
    }
  }
  return url;
}

let transport: Transport | null = null;
let statusState: "open" | "connecting" | "closed" = "connecting";
const demoMode = new URLSearchParams(location.search).has("demo");

function updateStatus(): void {
  els.connDot.className = `conn-dot conn-${statusState}`;
  els.connDot.title =
    statusState === "open"
      ? t("connected")
      : statusState === "connecting"
        ? t("connecting")
        : t("disconnected");
}

// loader di avvio: copre l'interfaccia finché connessione e dati iniziali
function hideBootLoader(): void {
  els.bootLoader.hidden = true;
}

async function connect(url: string): Promise<void> {
  transport?.close();
  transport = createWsTransport(url);
  setupTransport(transport);
}

function setupTransport(tr: Transport): void {
  tr.onStatus((s) => {
    statusState =
      s.state === "open" ? "open" : s.state === "connecting" ? "connecting" : "closed";
    updateStatus();
    els.send.disabled = s.state !== "open";
    updateSendButton();
    if (s.state === "open") {
      els.connectPanel.hidden = true;
      requestConfig();
      if (!demoMode) {
        void (async () => {
          await refreshSessions();
          hideBootLoader(); // dati iniziali caricati (o retry esauriti)
        })();
      }
    } else if (s.state === "closed") {
      hideBootLoader();
    }
  });
  tr.onFrame(handleFrame);
}

// --- correlazione richieste/risposte (rpc e ide) ----------------------------

const pendingRpc = new Map<string, (res: RpcEvent) => void>();
const pendingIde = new Map<string, (res: IdeResponse) => void>();
let rpcSeq = 0;
let ideSeq = 0;

function rpcRequest(
  command: RpcCommandLike,
  id = `rpc-${++rpcSeq}`,
  timeoutMs = 10_000,
): Promise<RpcEvent> {
  return new Promise((resolve, reject) => {
    pendingRpc.set(id, resolve);
    transport?.send({ channel: "rpc", payload: { ...command, id } });
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (pendingRpc.delete(id)) reject(new Error(`timeout: ${command.type}`));
      }, timeoutMs);
    }
  });
}

function ideRequest(req: IdeRequest): Promise<IdeResponse | null> {
  const id = `ide-${++ideSeq}`;
  return new Promise((resolve) => {
    pendingIde.set(id, resolve);
    transport?.send({ channel: "ide", payload: { ...req, id } });
    setTimeout(() => {
      if (pendingIde.delete(id)) resolve(null);
    }, 8_000);
  });
}

type RpcCommandLike = { type: string } & Record<string, unknown>;

function handleFrame(frame: Frame): void {
  if (frame.channel === "rpc") {
    const payload = frame.payload as RpcEvent;
    if (payload.type === "response" && typeof payload.id === "string") {
      const cb = pendingRpc.get(payload.id);
      if (cb) {
        pendingRpc.delete(payload.id);
        cb(payload);
        return;
      }
    }
    renderRpcEvent(payload);
    return;
  }
  const ide = frame.payload as IdeResponse | IdeEvent;
  if ("ok" in ide) {
    const res = ide as IdeResponse;
    const cb = res.id ? pendingIde.get(res.id) : undefined;
    if (cb) {
      pendingIde.delete(res.id);
      cb(res);
    }
    handleIdeResponse(res);
  } else {
    renderIdeEvent(ide as IdeEvent);
  }
}

// --- tema e locale -----------------------------------------------------------

const THEME_KEY: Record<ThemePreference, string> = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};

let themePref: ThemePreference = "system";

// limite dei messaggi mostrati in cronologia (resume e runtime): viene dal
// config (historyLimit), default 30 — l'utente lo cambia nelle impostazioni
const DEFAULT_HISTORY_LIMIT = 30;
let historyLimit = DEFAULT_HISTORY_LIMIT;
let configId = 0;

// parametri dev ?theme= / ?lang= (per verificare senza config)
const forcedThemeParam = new URLSearchParams(location.search).get("theme");
const forcedTheme =
  forcedThemeParam === "light" ||
  forcedThemeParam === "dark" ||
  forcedThemeParam === "system";
if (forcedTheme) themePref = forcedThemeParam as ThemePreference;
const forcedLang = new URLSearchParams(location.search).get("lang");
if (forcedLang === "it" || forcedLang === "en") setLocale(forcedLang);

function updateThemeButtons(): void {
  for (const btn of els.themeRow.querySelectorAll<HTMLButtonElement>(".theme-btn")) {
    const pref = (btn.dataset.themePref as ThemePreference | undefined) ?? "system";
    btn.classList.toggle("active", pref === themePref);
    btn.title = `${t("theme")}: ${t(THEME_KEY[pref])}`;
  }
}

function setThemePref(pref: ThemePreference): void {
  themePref = pref;
  applyTheme(themePref);
  updateThemeButtons();
  transport?.send({
    channel: "ide",
    payload: { type: "setConfig", patch: { theme: themePref }, id: `cfg-${++configId}` },
  });
}

function applyUiStrings(): void {
  els.input.placeholder = "";
  setStandardPlaceholder();
  els.connectUrl.placeholder = t("bridgeUrlPlaceholder");
  els.connectBtn.textContent = t("connect");
  els.send.title = t("send");
  els.newChat.title = t("newChat");
  els.btnModel.title = t("model");
  els.btnThinking.title = t("thinkingLevel");
  els.settingsBtn.title = t("settings");
  els.sessionBtn.title = t("sessions");
  els.lang.title = t("language");
  els.bootLoaderText.textContent = t("loading");
  els.langLabel.textContent = t("language");
  els.historyLabel.textContent = t("historyLimit");
  els.historyInput.value = String(historyLimit);
  els.themeLabel.textContent = t("theme");
  els.lang.value = currentLocale;
  updateStatus();
  updateThemeButtons();
  populateSessionMenu();
  // tema: dentro la webview di VS Code lo gestisce l'IDE — niente scelta
  if (runtime.isVsCode) {
    const row = els.themeRow.closest(".settings-row") as HTMLElement | null;
    if (row) row.hidden = true;
  }
}

function requestConfig(): void {
  void ideRequest({ type: "getConfig" }).then((res) => {
    if (res?.ok && typeof res.data === "object" && res.data !== null) {
      const cfg = res.data as Partial<UserConfig>;
      if (cfg.theme && !forcedTheme) {
        themePref = cfg.theme;
        applyTheme(themePref);
      }
      const loc = cfg.locale ?? null;
      if (isLocaleId(loc)) setLocale(loc);
      if (typeof cfg.historyLimit === "number" && cfg.historyLimit >= 1) {
        historyLimit = Math.floor(cfg.historyLimit);
      }
      applyUiStrings();
    }
  });
}

function handleIdeResponse(res: IdeResponse): void {
  if (res.ok && typeof res.data === "object" && res.data !== null) {
    const cfg = res.data as Partial<UserConfig>;
    if (cfg.theme && !forcedTheme) {
      themePref = cfg.theme;
      applyTheme(themePref);
    }
    const loc = cfg.locale ?? null;
    if (isLocaleId(loc)) setLocale(loc);
    if (typeof cfg.historyLimit === "number" && cfg.historyLimit >= 1) {
      historyLimit = Math.floor(cfg.historyLimit);
    }
    applyUiStrings();
  }
}

// --- settings (gear) → dialog modale ------------------------------------------

// riga versione: la sorgente dipende dal runtime — in webview VS Code è
// l'addon, standalone è il pacchetto piw (entrambi rispondono a getVersion)
function refreshVersionInfo(): void {
  els.settingsVersionLabel.textContent =
    runtime.mode === "vscode" ? t("settingsVersionAddon") : t("settingsVersionPiw");
  void ideRequest({ type: "getVersion" }).then((res) => {
    const v = res?.ok ? (res.data as { version?: string | null } | undefined)?.version : null;
    els.settingsVersion.textContent = v ?? "–";
  });
}

// --- blocco 3: flag CLI di pi (dinamici dai flag registrati) ----------------

let savedCliValues: CliFlags = {};
let cliDirty = false;

// valori correnti nel form (flag → valore): solo quelli REALMENTE impostati
// (checkbox spuntate, stringhe non vuote) — il confronto col salvato non deve
// sporcarsi con i default (checkbox false / input string vuoti)
function currentCliValues(): CliFlags {
  const values: CliFlags = {};
  for (const input of els.cliFlags.querySelectorAll<HTMLInputElement>("input[data-flag]")) {
    const name = input.dataset.flag ?? "";
    if (!name) continue;
    if (input.type === "checkbox") {
      if (input.checked) values[name] = true;
    } else if (input.value !== "") {
      values[name] = input.value;
    }
  }
  return values;
}

function setCliDirty(): void {
  cliDirty = JSON.stringify(currentCliValues()) !== JSON.stringify(savedCliValues);
  els.cliApplyRow.hidden = !cliDirty;
  if (cliDirty) els.cliApplyHint.textContent = t("applyCliHint");
}

// righe dinamiche: SOLO i flag esistenti (se l'estensione non c'è, il flag
// non appare); boolean → checkbox, string → input disabilitato (presto)
function renderCliFlags(available: CliFlagInfo[], values: CliFlags): void {
  els.cliFlags.textContent = "";
  if (available.length === 0) {
    const none = document.createElement("div");
    none.className = "settings-note";
    none.textContent = t("cliNoFlags");
    els.cliFlags.appendChild(none);
    return;
  }
  for (const flag of available) {
    const row = document.createElement("div");
    row.className = "settings-row";
    const label = document.createElement("label");
    label.textContent = `--${flag.name}`;
    if (flag.description) label.title = flag.description;
    row.appendChild(label);
    if (flag.type === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "field-checkbox";
      input.dataset.flag = flag.name;
      input.checked = values[flag.name] === true;
      input.addEventListener("change", setCliDirty);
      row.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "field-input";
      input.disabled = true;
      input.placeholder = t("cliStringNotSupported");
      input.dataset.flag = flag.name;
      row.appendChild(input);
    }
    els.cliFlags.appendChild(row);
  }
  setCliDirty();
}

function refreshCliFlags(): void {
  els.pidevTitle.textContent = "pi.dev";
  els.pidevNote.textContent = t("settingsPiDevNote");
  void ideRequest({ type: "getCliFlags" }).then((res) => {
    if (!res?.ok) return;
    const data = res.data as { available?: CliFlagInfo[]; values?: CliFlags } | undefined;
    savedCliValues = data?.values ?? {};
    renderCliFlags(data?.available ?? [], savedCliValues);
  });
}

// Applica: con elaborazione in corso → conferma + dequeue+stop (come lo STOP),
// poi setCliFlags → il companion riavvia pi in modo trasparente (connection_closed
// reason restart + pi_restarted → re-init senza reload)
els.cliApply.addEventListener("click", () => {
  void (async () => {
    const doApply = async (): Promise<void> => {
      els.cliApply.disabled = true;
      els.cliApplyHint.textContent = t("applyCliRestarting");
      await ideRequest({ type: "setCliFlags", flags: currentCliValues() });
    };
    if (working) {
      const ok = await showConfirm(t("applyCliWarn"));
      if (!ok) return;
      stopWorking(); // dequeue + abort come al solito
    }
    await doApply();
  })();
});

function openSettings(): void {
  els.settingsModal.hidden = false;
  els.settingsBtn.setAttribute("aria-expanded", "true");
  refreshVersionInfo();
  refreshCliFlags();
}

function closeSettings(): void {
  els.settingsModal.hidden = true;
  els.settingsBtn.setAttribute("aria-expanded", "false");
}

els.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (els.settingsModal.hidden) openSettings();
  else closeSettings();
});

els.settingsClose.addEventListener("click", closeSettings);
els.settingsModal.addEventListener("click", (e) => {
  if (e.target === els.settingsModal) closeSettings();
});

// --- dropdown sessioni ---------------------------------------------------------

els.sessionBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  els.sessionMenu.hidden = !els.sessionMenu.hidden;
  closeSettings();
});

els.sessionFilters.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".filter-btn");
  if (!btn?.dataset.role) return;
  filterMode = btn.dataset.role === "all" ? "all" : "folder";
  void refreshSessions();
});

els.sessionItems.addEventListener("click", (e) => {
  const action = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  const item = (e.target as HTMLElement).closest<HTMLElement>(".session-item");
  if (!item) return;
  // azione "nuova sessione" (riga in alto, senza path)
  if (item.dataset.action === "new") {
    // se la corrente È già una nuova sessione la riga è evidenziata come
    // attiva: cliccarla chiude il menu (come la sessione corrente)
    if (!!currentSessionPath && isNewSession(currentSession())) {
      els.sessionMenu.hidden = true;
      return;
    }
    void startNewSession();
    return;
  }
  if (!item.dataset.path) return;
  // azioni rinomina/elimina: stopPropagation, nessun cambio sessione
  if (action?.dataset.action === "rename") {
    void renameSessionFlow(item.dataset.path);
    return;
  }
  if (action?.dataset.action === "delete") {
    void deleteSessionFlow(item.dataset.path);
    return;
  }
  // click sull'area principale: sessione corrente → chiudi e basta
  if ((e.target as HTMLElement).closest(".session-item-main")) {
    if (item.dataset.path === currentSessionPath) {
      els.sessionMenu.hidden = true;
      return;
    }
    void pickSession(item.dataset.path);
  }
});

// --- rinomina / elimina sessione (dropdown) --------------------------------

// dialog con campo di testo precompilato: Enter applica, Escape annulla
function showPrompt(initialValue: string, title: string): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const msg = document.createElement("div");
    msg.className = "modal-message";
    msg.textContent = title;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.value = initialValue;
    input.spellcheck = false;
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = t("cancel");
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn accent";
    apply.textContent = t("apply");
    const close = (value: string | null) => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(value);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(null);
      }
    };
    cancel.addEventListener("click", () => close(null));
    apply.addEventListener("click", () => close(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        close(input.value);
      }
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    actions.append(cancel, apply);
    card.append(msg, input, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", esc, true);
    input.focus();
    input.select();
  });
}

async function renameSessionFlow(path: string): Promise<void> {
  const s = sessions.find((x) => x.path === path);
  if (!s) return;
  // valore iniziale: nome assegnato oppure label attuale (primo messaggio)
  const initial =
    s.name && !hasCjk(s.name) ? s.name : sessionLabel(s);
  const next = await showPrompt(initial, t("renameSession"));
  if (next === null) return; // annullato
  const newName = next.trim();
  if (!newName || newName === initial) return; // vuoto o invariato
  const current = path === currentSessionPath;
  if (current) {
    // sessione corrente: il nome vive nella memoria di pi (RPC)
    const res = await rpcRequest({ type: "set_session_name", name: newName });
    if (!res.success) {
      addStatusLine(t("renameFailed"));
      return;
    }
  } else {
    const res = await ideRequest({ type: "renameSession", path, name: newName });
    if (!res?.ok) {
      addStatusLine(t("renameFailed"));
      return;
    }
  }
  const idx = sessions.findIndex((x) => x.path === path);
  const cur = idx >= 0 ? sessions[idx] : undefined;
  if (cur) sessions[idx] = { ...cur, name: newName };
  populateSessionMenu();
  if (current) void refreshSessionTitle(); // aggiorna box e titolo
}

async function deleteSessionFlow(path: string): Promise<void> {
  const s = sessions.find((x) => x.path === path);
  const label = s ? sessionLabel(s) : t("newSession");
  const ok = await showConfirm(tpl(t("deleteAsk"), { name: label }));
  if (!ok) return;
  const res = await ideRequest({ type: "deleteSession", path });
  if (!res?.ok) {
    addStatusLine(t("deleteFailed"));
    return;
  }
  // sessione corrente eliminata → si parte con una nuova sessione
  if (path === currentSessionPath) {
    els.thread.textContent = "";
    try {
      await rpcRequest({ type: "new_session" });
    } catch {
      // new_session fallito: refreshSessions riallinea con lo stato di pi
    }
  }
  els.sessionMenu.hidden = false; // resta aperta: mostra la lista aggiornata
  await refreshSessions();
}

// nuova sessione: chiude la dropdown e ricarica con la sessione fresca
async function startNewSession(): Promise<void> {
  if (switchingSession) return;
  switchingSession = true;
  els.sessionBtn.disabled = true;
  try {
    const res = await rpcRequest({ type: "new_session" });
    if (res.success) {
      els.thread.textContent = "";
      els.sessionMenu.hidden = true;
      await refreshSessions();
      // pi può assegnare il nome in ritardo: aggiorna box e titolo quando arriva
      pollSessionTitle();
    }
  } catch {
    // new_session fallito: resta la sessione corrente
  }
  switchingSession = false;
  els.sessionBtn.disabled = false;
  populateSessionMenu();
}

// scelta sessione: nella stessa cartella → switch; altrove → fork (come pi)
async function pickSession(path: string): Promise<void> {
  if (switchingSession) return;
  const s = sessions.find((x) => x.path === path);
  const crossFolder = s?.cwd && workspacePath && s.cwd !== workspacePath;
  if (!crossFolder) {
    switchSession(path);
    return;
  }
  // sessione di un'altra cartella: chiedi conferma fork (modale custom, non
  // window.confirm: nelle webview di VS Code non funziona)
  const ok = await showConfirm(t("forkConfirm"));
  if (ok) {
    const res = await ideRequest({ type: "forkSession", sourcePath: path });
    if (res?.ok) {
      const forkPath = (res.data as { path?: string } | undefined)?.path;
      if (forkPath) {
        switchSession(forkPath);
        void refreshSessions();
      }
    }
  } else {
    els.sessionMenu.hidden = true;
  }
}

document.addEventListener("click", (e) => {
  const target = e.target as Node;
  if (
    !els.sessionMenu.hidden &&
    !els.sessionMenu.contains(target) &&
    !els.sessionBtn.contains(target)
  ) {
    els.sessionMenu.hidden = true;
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSettings();
    els.sessionMenu.hidden = true;
  }
});

for (const btn of els.themeRow.querySelectorAll<HTMLButtonElement>(".theme-btn")) {
  btn.addEventListener("click", () => {
    setThemePref((btn.dataset.themePref as ThemePreference | undefined) ?? "system");
  });
}

els.lang.addEventListener("change", () => {
  if (isLocaleId(els.lang.value)) {
    setLocale(els.lang.value as LocaleId);
    applyUiStrings();
    transport?.send({
      channel: "ide",
      payload: {
        type: "setConfig",
        patch: { locale: currentLocale },
        id: `cfg-${++configId}`,
      },
    });
  }
});

// limite storico: salvato nel config e riapplicato subito (tronca in cima)
els.historyInput.addEventListener("change", () => {
  const n = Math.max(
    5,
    Math.floor(Number(els.historyInput.value) || DEFAULT_HISTORY_LIMIT),
  );
  historyLimit = n;
  els.historyInput.value = String(n);
  transport?.send({
    channel: "ide",
    payload: {
      type: "setConfig",
      patch: { historyLimit: n },
      id: `cfg-${++configId}`,
    },
  });
  void loadHistory(); // riapplica il troncamento alla cronologia corrente
});

watchThemeChanges(() => applyTheme(themePref));

// --- sessioni (dropdown) ------------------------------------------------------

let sessions: SessionInfo[] = [];
let currentSessionPath: string | null = null;
let switchingSession = false;
let workspaceLabel = "";
let workspacePath: string | null = null;
let filterMode: "folder" | "all" = "folder";

// I nomi auto-generati (pi-spark) possono uscire in CJK anche con prompt
// italiani: in quel caso preferiamo il primo messaggio.
function hasCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

function sessionLabel(s: SessionInfo): string {
  if (s.name && !hasCjk(s.name)) return s.name;
  if (s.firstMessage) {
    const oneLine = s.firstMessage.replace(/\s+/g, " ");
    return oneLine.length > 48 ? oneLine.slice(0, 48) + "…" : oneLine;
  }
  const cwd = s.cwd?.split(/[\\/]/).pop();
  const activity = s.lastActivity ?? s.mtime;
  const date = activity
    ? new Date(activity).toLocaleDateString(currentLocale === "it" ? "it-IT" : "en-US")
    : "";
  const base = [cwd, date].filter(Boolean).join(" · ");
  return base || (s.path.split(/[\\/]/).pop() ?? s.path);
}

// tempo relativo come nel selettore /resume di pi ("now", "22m", "2h", "3g")
function relativeTime(ms?: number): string {
  if (!ms) return "";
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return t("now");
  if (sec < 3600) return `${Math.floor(sec / 60)}${t("unitM")}`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}${t("unitH")}`;
  return `${Math.floor(sec / 86400)}${t("unitD")}`;
}

function currentSession(): SessionInfo | undefined {
  return sessions.find((s) => s.path === currentSessionPath);
}

// sessione nuova = nessun messaggio ancora salvato
function isNewSession(s?: SessionInfo): boolean {
  return !s || !s.messageCount || s.messageCount === 0;
}

function populateSessionMenu(): void {
  els.sessionFilters.textContent = "";
  els.sessionItems.textContent = "";

  // filtro sulla stessa riga: ./cartella | Tutte (segmented control)
  const folderBtn = document.createElement("button");
  folderBtn.type = "button";
  folderBtn.className = "filter-btn";
  folderBtn.dataset.role = "folder";
  folderBtn.textContent = `./${workspaceLabel || "…"}`;
  folderBtn.classList.toggle("active", filterMode === "folder");
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "filter-btn";
  allBtn.dataset.role = "all";
  allBtn.textContent = t("all");
  allBtn.classList.toggle("active", filterMode === "all");
  // solo standalone: icona cartella per cambiare workspace (nelle webview IDE
  // il workspace lo decide l'host)
  if (!runtime.isVsCode) {
    const browseBtn = document.createElement("button");
    browseBtn.type = "button";
    browseBtn.className = "filter-btn folder-browse";
    browseBtn.title = t("chooseFolder");
    browseBtn.innerHTML = folderIcon();
    browseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void changeWorkspace();
    });
    els.sessionFilters.append(folderBtn, browseBtn, allBtn);
  } else {
    els.sessionFilters.append(folderBtn, allBtn);
  }

  // riga-azione "nuova sessione": c'è SEMPRE. Quando la sessione corrente È
  // già una nuova sessione viene evidenziata come attiva (come le altre).
  const currentIsNew = !!currentSessionPath && isNewSession(currentSession());
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "session-item new-session";
  newBtn.dataset.action = "new";
  newBtn.classList.toggle("active", currentIsNew);
  const newLabel = document.createElement("span");
  newLabel.className = "session-item-label";
  newLabel.textContent = t("newSession");
  const newIcon = document.createElement("span");
  newIcon.className = "session-item-meta";
  newIcon.textContent = currentIsNew ? "(0)" : "＋";
  newBtn.append(newLabel, newIcon);
  els.sessionItems.appendChild(newBtn);

  if (sessions.length === 0 && !currentSessionPath) {
    const empty = document.createElement("div");
    empty.className = "session-empty";
    empty.textContent = t("noSessions");
    els.sessionItems.appendChild(empty);
  } else {
    // la sessione corrente può non essere in lista (appena creata, non salvata);
    // se è NUOVA è già rappresentata dalla riga-azione evidenziata qui sopra
    const list = [...sessions];
    if (currentSessionPath && !currentIsNew && !list.some((s) => s.path === currentSessionPath)) {
      list.unshift({ path: currentSessionPath, name: t("newSession") });
    }
    for (const s of list) {
      // la nuova sessione corrente vive nella riga-azione: niente duplicato
      if (currentIsNew && s.path === currentSessionPath) continue;
      // contenitore: area principale cliccabile (nome+meta) + azioni rinomina/
      // elimina. Niente <button> annidati: l'item è un div flex.
      const item = document.createElement("div");
      item.className = "session-item";
      item.dataset.path = s.path;
      item.classList.toggle("active", s.path === currentSessionPath);
      // la sessione corrente nuova viene mostrata in evidenza (come l'azione)
      item.classList.toggle(
        "new-session",
        s.path === currentSessionPath && isNewSession(s),
      );
      // in modalità "Tutte", evidenzia le sessioni della cartella corrente
      item.classList.toggle(
        "in-workspace",
        filterMode === "all" && !!workspacePath && s.cwd === workspacePath,
      );
      const main = document.createElement("button");
      main.type = "button";
      main.className = "session-item-main";
      const label = document.createElement("span");
      label.className = "session-item-label";
      // nuova sessione (0 messaggi) → titolo esplicito nella dropdown
      label.textContent =
        s.path === currentSessionPath && isNewSession(s)
          ? t("newSession")
          : sessionLabel(s);
      const meta = document.createElement("span");
      meta.className = "session-item-meta";
      const count = s.messageCount ?? 0;
      const rel = relativeTime(s.lastActivity ?? s.mtime);
      meta.textContent = [count > 0 ? `(${count})` : "", rel].filter(Boolean).join(" ");
      main.append(label, meta);
      // azioni per OGNI sessione: rinomina + elimina (con conferma)
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "session-item-action";
      rename.dataset.action = "rename";
      rename.title = t("renameSession");
      rename.innerHTML = pencilIcon();
      const del = document.createElement("button");
      del.type = "button";
      del.className = "session-item-action danger";
      del.dataset.action = "delete";
      del.title = t("deleteSession");
      del.innerHTML = trashIcon();
      item.append(main, rename, del);
      els.sessionItems.appendChild(item);
    }
  }
  const cur = currentSession();
  els.sessionBtn.textContent = cur
    ? isNewSession(cur)
      ? t("newSession")
      : sessionLabel(cur)
    : currentSessionPath
      ? t("newSession")
      : t("noSessions");
  updateDocumentTitle();
}

// etichetta corrente riusata da box e titolo browser
function currentSessionLabel(): string {
  const cur = currentSession();
  if (cur) return isNewSession(cur) ? t("newSession") : sessionLabel(cur);
  return currentSessionPath ? t("newSession") : t("noSessions");
}

// il titolo del browser mostra il nome della sessione, solo fuori dall'IDE
function updateDocumentTitle(): void {
  if (runtime.isVsCode) return; // nell'IDE il titolo lo gestisce l'host
  const label = currentSessionLabel();
  document.title =
    label && label !== t("noSessions") ? `${label} — pi-webview` : "pi-webview";
}

// rilegge i dati della sessione corrente (nome assegnato da pi, primo
// messaggio, conteggio) e aggiorna box + titolo browser
async function refreshSessionTitle(): Promise<void> {
  if (!currentSessionPath) return;
  // 1) nome assegnato da pi (es. auto-title) via get_state
  let named = false;
  try {
    const state = await rpcRequest(rpc.getState());
    const name = (state.data as { sessionName?: string } | undefined)?.sessionName;
    if (name && currentSessionPath) {
      const s = sessions.find((x) => x.path === currentSessionPath);
      if (s && s.name !== name) {
        s.name = name;
        named = true;
      }
    }
  } catch {
    // get_state fallito: si usa la lettura del file
  }
  // 2) dati freschi dal file (primo messaggio, conteggio, nome in session_info)
  const res = await ideRequest({ type: "getSessionInfo", path: currentSessionPath });
  if (res?.ok) {
    const info = res.data as SessionInfo;
    const idx = sessions.findIndex((x) => x.path === currentSessionPath);
    if (idx >= 0) sessions[idx] = { ...sessions[idx], ...info };
    else sessions.unshift(info);
  }
  if (named || res?.ok) populateSessionMenu();
}

// dopo una nuova sessione pi può assegnare il nome in ritardo: sondaggio breve
function pollSessionTitle(attempts = 10, interval = 4000): void {
  void refreshSessionTitle();
  let n = 0;
  const iv = setInterval(() => {
    n++;
    void refreshSessionTitle();
    if (n >= attempts) clearInterval(iv);
  }, interval);
}

async function refreshSessions(): Promise<void> {
  // get_state può fallire all'avvio (pi non è ancora pronto nella webview):
  // riprova finché il processo risponde (timeout breve per tentativo)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const state = await rpcRequest(rpc.getState(), `rpc-st-${attempt}`, 3000);
      if (state.success) {
        const data = state.data as
          | {
              sessionFile?: string;
              model?: unknown;
              thinkingLevel?: string;
              steeringMode?: string;
            }
          | undefined;
        if (data?.sessionFile) {
          currentSessionPath = data.sessionFile;
          persistSessionPath(); // riprendi la stessa sessione ai reload di VS Code
        }
        if (data?.model) {
          const m = data.model as {
            provider?: string;
            name?: string;
            id?: string;
            input?: string[];
          };
          currentModel = m;
          modelSupportsVision = Array.isArray(m.input) && m.input.includes("image");
          const label = m.name ?? m.id;
          modelInfoText = label ? [m.provider, label].filter(Boolean).join(" · ") : "";
          renderModelInfo();
        }
        if (typeof data?.thinkingLevel === "string") {
          thinkingLevel = data.thinkingLevel;
          renderThinkingInfo();
        }
        if (
          typeof data?.steeringMode === "string" &&
          (data.steeringMode === "one-at-a-time" || data.steeringMode === "all")
        ) {
          steeringMode = data.steeringMode;
        }
        break; // pi pronto
      }
    } catch {
      // pi non ancora su: riprova tra poco
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const trust = await ideRequest({ type: "getTrust" });
  if (trust?.ok) renderTrust(trust.data as { status?: string } | null);
  // workspace prima (istantaneo, niente lettura di tutti i file di sessione)
  if (!workspacePath) {
    const wr = await ideRequest({ type: "getWorkspace" });
    if (wr?.ok) {
      const w = (wr.data as { workspace?: string } | undefined)?.workspace;
      if (w) {
        workspacePath = w;
        workspaceLabel = w.split(/[\\/]/).pop() ?? "";
      }
    }
  }
  const ws = filterMode === "folder" ? workspacePath : undefined;
  const list = await ideRequest({
    type: "listSessions",
    ...(ws ? { workspace: ws } : {}),
  });
  if (list?.ok) {
    const data = list.data as SessionListResult | undefined;
    sessions = (data?.sessions ?? []) as SessionInfo[];
    const label = data?.workspace?.split(/[\\/]/).pop();
    if (label) workspaceLabel = label;
  }
  populateSessionMenu();
  await loadHistory();
  // stearing: coda persistita ripristinata; se pi è idle, consegna subito
  await loadSteerQueue();
  updateSteerPlaceholder();
  deliverSteering();
  void fetchSlashCommands(); // comandi estensione per la palette (piano 0003)
}

async function loadHistory(): Promise<void> {
  try {
    const res = await rpcRequest(rpc.getMessages());
    const messages = (res.data as { messages?: unknown[] } | undefined)?.messages;
    if (messages) {
      // solo gli ULTIMI historyLimit passaggi: la cronologia lunga viene
      // troncata in cima (mai tutta la sessione)
      renderHistory(messages.slice(-historyLimit));
      seedMessageHistory(messages.slice(-historyLimit));
    }
  } catch {
    // nessuna cronologia disponibile
  }
  void fetchSessionStats(); // gauger contesto dopo ogni cambio sessione
  void fetchBalance(); // saldo reale del provider (dopo che currentModel è noto)
  void fetchCompactionSettings(); // soglia auto-compaction di pi per il tooltip
}

// soglie auto-compaction di pi (config ~/.pi/config.json): per il tooltip
// del blocco contesto — “(auto-compact ≥ X%)”
async function fetchCompactionSettings(): Promise<void> {
  const res = await ideRequest({ type: "getCompactionSettings" });
  const s = res?.ok
    ? (res.data as { enabled?: boolean; reserveTokens?: number } | null)
    : null;
  if (s && typeof s.enabled === "boolean" && typeof s.reserveTokens === "number") {
    compactionSettings = {
      enabled: s.enabled,
      reserveTokens: s.reserveTokens,
    };
    updateStatsTitle();
  }
}

// --- cambio workspace (standalone: browse cartella + scelta destino) -----------

async function listDirs(path: string): Promise<string[]> {
  const res = await ideRequest({ type: "listDir", path });
  if (!res?.ok) return [];
  return (res.data as { dirs?: string[] } | undefined)?.dirs ?? [];
}

function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx <= 0) return path;
  return path.slice(0, idx);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

// modale di navigazione cartelle (bridge listDir): risolve con il path scelto
function openFolderBrowser(start: string): Promise<string | null> {
  return new Promise((resolve) => {
    let current = start;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal folder-modal";
    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("span");
    title.className = "modal-title";
    title.textContent = t("chooseFolder");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn";
    close.textContent = "✕";
    close.title = t("cancel");
    head.append(title, close);
    const pathEl = document.createElement("div");
    pathEl.className = "folder-path";
    const dirsEl = document.createElement("div");
    dirsEl.className = "folder-dirs";
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "btn primary";
    selectBtn.textContent = t("select");
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("cancel");
    actions.append(selectBtn, cancelBtn);
    card.append(head, pathEl, dirsEl, actions);
    backdrop.appendChild(card);

    const done = (val: string | null): void => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(val);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") done(null);
    };
    document.addEventListener("keydown", esc);

    async function load(): Promise<void> {
      pathEl.textContent = current;
      dirsEl.textContent = "";
      // ".. (cartella superiore)" come primo elemento della lista
      if (parentDir(current) !== current) {
        const up = document.createElement("button");
        up.type = "button";
        up.className = "folder-dir folder-up";
        up.innerHTML = `${folderIcon()} <span>.. (${escapeHtml(t("parentFolder"))})</span>`;
        up.addEventListener("click", () => {
          current = parentDir(current);
          void load();
        });
        dirsEl.appendChild(up);
      }
      const placeholder = document.createElement("div");
      placeholder.className = "folder-dirs-empty";
      placeholder.textContent = t("loading");
      dirsEl.appendChild(placeholder);
      const dirs = await listDirs(current);
      placeholder.remove();
      if (dirs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "folder-dirs-empty";
        empty.textContent = "—";
        dirsEl.appendChild(empty);
      }
      for (const d of dirs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "folder-dir";
        btn.innerHTML = `${folderIcon()} <span>${escapeHtml(d)}</span>`;
        btn.addEventListener("click", () => {
          const sep = current.endsWith("/") || current.endsWith("\\") ? "" : "/";
          current = current + sep + d;
          void load();
        });
        dirsEl.appendChild(btn);
      }
    }

    selectBtn.addEventListener("click", () => done(current));
    cancelBtn.addEventListener("click", () => done(null));
    close.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });

    document.body.appendChild(backdrop);
    void load();
  });
}

// dialog a 3 scelte: fork della sessione nella nuova cartella, nuova sessione,
// oppure annulla
function askWorkspaceAction(folder: string): Promise<"fork" | "new" | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const icon = document.createElement("div");
    icon.className = "modal-icon";
    icon.innerHTML = trustIcon("warn-filled");
    const msg = document.createElement("div");
    msg.className = "modal-message";
    msg.textContent = `${t("changeWorkspaceAsk")}\n\n${folder}`;
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const forkBtn = document.createElement("button");
    forkBtn.type = "button";
    forkBtn.className = "btn primary";
    forkBtn.textContent = t("forkHere");
    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn";
    newBtn.textContent = t("newSessionHere");
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("cancel");
    actions.append(forkBtn, newBtn, cancelBtn);
    card.append(icon, msg, actions);
    backdrop.appendChild(card);

    const done = (val: "fork" | "new" | null): void => {
      backdrop.remove();
      resolve(val);
    };
    forkBtn.addEventListener("click", () => done("fork"));
    newBtn.addEventListener("click", () => done("new"));
    cancelBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });

    document.body.appendChild(backdrop);
  });
}

async function changeWorkspace(): Promise<void> {
  if (!workspacePath) return;
  const target = await openFolderBrowser(workspacePath);
  if (!target) return;
  if (target === workspacePath) return; // stessa cartella: nessun cambio
  const choice = await askWorkspaceAction(target);
  if (!choice) return;
  const res = await ideRequest({
    type: "setWorkspace",
    path: target,
    action: choice,
    ...(choice === "fork" && currentSessionPath
      ? { sessionPath: currentSessionPath }
      : {}),
  });
  if (!res?.ok) return;
  workspacePath = target;
  workspaceLabel = target.split(/[\\/]/).pop() ?? "";
  if (choice === "fork") {
    const forkPath = (res.data as { sessionPath?: string } | undefined)?.sessionPath;
    if (forkPath) switchSession(forkPath);
  }
  void refreshSessions();
}

// salva la sessione corrente nel companion (globalState di VS Code): ai
// reload della finestra pi viene riavviato con --session <path> e riprende
// la conversazione aperta (solo in modalità webview VS Code)
function persistSessionPath(): void {
  if (!runtime.isVsCode || !currentSessionPath) return;
  void ideRequest({ type: "storeSession", path: currentSessionPath });
}

function switchSession(path: string): void {
  if (!path || path === currentSessionPath || switchingSession) return;
  switchingSession = true;
  els.sessionBtn.disabled = true;
  void (async () => {
    try {
      const res = await rpcRequest({ type: "switch_session", sessionPath: path });
      if (res.success) {
        currentSessionPath = path;
        persistSessionPath(); // riprendi questa sessione ai reload di VS Code
        els.thread.textContent = "";
        await loadHistory();
      }
    } catch {
      // switch fallito: resta la sessione corrente
    }
    switchingSession = false;
    els.sessionBtn.disabled = false;
    populateSessionMenu();
    els.sessionMenu.hidden = true;
  })();
}

// --- render dei messaggi -----------------------------------------------------

const stream = emptyStream();
let currentMsg: HTMLElement | null = null;
let thinkingSlot: HTMLElement | null = null;
let currentText: HTMLElement | null = null;
let markdownAccum = "";
let renderPending = false;
let thinkingEl: HTMLElement | null = null;
let thinkingContentEl: HTMLElement | null = null;
let thinkingSpinnerEl: HTMLElement | null = null;
let thinkingTimerEl: HTMLElement | null = null;
let thinkingStartedAt = 0;
let thinkingTimer: ReturnType<typeof setInterval> | null = null;
// il pulsante STOP vive nella BARRA DI STATO (a destra del contesto):
// rosso, visibile solo a turno attivo, cliccabile indipendentemente
function updateThinkingStopBtn(visible: boolean): void {
  els.statsStop.hidden = !visible;
}

// STOP: come Escape di pi.dev — prima riporta i messaggi in stearing
// nell'editor (dequeue), POI ferma il turno corrente
els.statsStop.innerHTML = stopIcon();
els.statsStop.title = t("stopWorking");

// STOP (pulsante ▢ o tasto Esc): come Escape di pi.dev — prima riporta i
// messaggi in stearing nell'editor (dequeue), POI ferma il turno corrente
function stopWorking(): void {
  if (!transport || !working) return;
  dequeueSteering(); // i messaggi accodati tornano nella textarea (se ce ne sono)
  transport.send({ channel: "rpc", payload: rpc.abort() });
  working = false;
  hideSentLoader();
  hideExtensionsBlock();
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
}

els.statsStop.addEventListener("click", stopWorking);

// Esc durante l'elaborazione = STOP (come pi.dev). I modali (conferma/
// prompt) chiudono già su Esc in fase di capture con stopPropagation: qui
// non arriva nulla mentre un modale è aperto.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (els.settingsModal && !els.settingsModal.hidden) return; // impostazioni aperte
  if (working) {
    e.preventDefault();
    stopWorking();
  }
});
let thinkingAccum = "";
let thinkingContentRendered = false;
let toolsEl: HTMLElement | null = null;
let toolsPre: HTMLPreElement | null = null;
let toolsText = "";

function addMsg(kind: "user" | "assistant" | "status"): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${kind}`;
  els.thread.appendChild(wrapper);
  // runtime: la cronologia non supera historyLimit — tronca in cima
  while (els.thread.children.length > historyLimit) {
    els.thread.firstElementChild?.remove();
  }
  scrollToBottom();
  return wrapper;
}

// margine per considerarsi "in fondo" (e quindi seguire l'autoscroll).
// PICCOLO di proposito: basta scrollare su un po' con la rotella per inibire
// l'autoscroll. La crescita del contenuto NON dipende da questo margine (la
// gestisce stickToBottom, vedi sotto).
const SCROLL_RESUME_MARGIN = 24;

// l'utente sta seguendo la chat? Aggiornato SOLO dall'evento scroll (mai dai
// nostri riallineamenti, che quando si torna in fondo lo riportano a true).
// Separa l'INTENTO dell'utente dalla crescita del contenuto: la resa
// asincrona sposta il fondo ma non cambia lo stato → lo streaming continua a
// seguire finché l'utente non scrolla davvero.
let stickToBottom = true;

// auto-scroll intelligente: segue solo se l'utente è già in fondo
function scrollToBottom(force = false): void {
  if (!force && !stickToBottom) return;
  const el = els.messages;
  el.scrollTop = el.scrollHeight;
  // la resa è ASINCRONA (markdown re-render a rAF, immagini, code block): il
  // contenuto cresce DOPO l'assegnazione → riallinea ai frame successivi
  // finché l'utente continua a seguire (stickToBottom resta true anche se il
  // fondo si è spostato: cambia solo se l'utente scrolla)
  requestAnimationFrame(() => {
    if (force || stickToBottom) el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      if (force || stickToBottom) el.scrollTop = el.scrollHeight;
    });
  });
}

function openAssistantBubble(): void {
  currentMsg = addMsg("assistant");
  // il pensiero va SEMPRE prima del testo in streaming (e nel risultato finale)
  thinkingSlot = document.createElement("div");
  thinkingSlot.className = "thinking-slot";
  currentMsg.appendChild(thinkingSlot);
  currentText = document.createElement("div");
  currentText.className = "md";
  currentMsg.appendChild(currentText);
  markdownAccum = "";
  renderPending = false;
  thinkingEl = null;
  thinkingContentEl = null;
  thinkingSpinnerEl = null;
  thinkingTimerEl = null;
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
  thinkingStartedAt = 0;
  thinkingAccum = "";
  thinkingContentRendered = false;
  toolsEl = null;
  toolsPre = null;
  toolsText = "";
}

// --- streaming markdown -------------------------------------------------------

function scheduleMarkdownRender(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    if (currentText) {
      currentText.innerHTML = renderMarkdown(markdownAccum);
    }
  });
}

// --- pensiero con loader (niente <details>: barra + label + rotella + timer) --

function makeThinkingHead(withSpinner = true): {
  head: HTMLElement;
  label: HTMLElement;
  spinner?: HTMLElement;
  timer?: HTMLElement;
  stop?: HTMLElement;
} {
  const head = document.createElement("div");
  head.className = "thinking-head";
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = t("thought");
  const timer = document.createElement("span");
  timer.className = "thinking-timer";
  timer.textContent = "0s";
  if (withSpinner) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    head.append(label, spinner, timer);
    return { head, label, spinner, timer };
  }
  head.append(label, timer);
  return { head, label, timer };
}


function startThinkingTimer(): void {
  thinkingStartedAt = performance.now();
  if (thinkingTimerEl) thinkingTimerEl.textContent = "0s";
  if (thinkingTimer) clearInterval(thinkingTimer);
  thinkingTimer = setInterval(() => {
    if (!thinkingTimerEl) return;
    const secs = Math.round((performance.now() - thinkingStartedAt) / 1000);
    thinkingTimerEl.textContent = `${secs}s`;
  }, 500);
}

function stopThinkingTimer(): void {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
  }
  if (thinkingTimerEl && thinkingStartedAt > 0) {
    const secs = Math.max(1, Math.round((performance.now() - thinkingStartedAt) / 1000));
    thinkingTimerEl.textContent = `${secs}s`;
  }
}

function ensureThinkingLoader(): HTMLElement {
  if (!thinkingEl && thinkingSlot) {
    thinkingEl = document.createElement("div");
    thinkingEl.className = "thinking-card";
    const { head, spinner, timer } = makeThinkingHead();
    thinkingSpinnerEl = spinner ?? null;
    thinkingTimerEl = timer ?? null;
    thinkingContentEl = document.createElement("div");
    thinkingContentEl.className = "thinking-content";
    thinkingContentEl.hidden = true; // collassato per default (streaming comunque live)
    // cattura locale: ogni blocco toggla il PROPRIO contenuto
    const contentEl = thinkingContentEl;
    head.addEventListener("click", () => {
      contentEl.hidden = !contentEl.hidden;
    });
    thinkingEl.append(head, thinkingContentEl);
    thinkingSlot.appendChild(thinkingEl);
    applyToolChain(); // primo blocco pensiero: valuta il gap 3px con il precedente
    startThinkingTimer();
    scrollToBottom();
  }
  return thinkingEl as HTMLElement;
}

// a fine pensiero: via la rotella, il contenuto resta espandibile
function finishThinking(): void {
  if (!thinkingEl) return;
  stopThinkingTimer();
  thinkingSpinnerEl?.remove();
  thinkingSpinnerEl = null;
  const content = thinkingAccum.trim();
  if (content) {
    if (thinkingContentEl) thinkingContentEl.textContent = content;
    thinkingContentRendered = true;
  } else {
    thinkingEl.remove();
    thinkingEl = null;
    thinkingContentEl = null;
  }
}

// --- blocco "Extensions" (attesa pre-stream > 3s) -----------------------------
// Dopo un invio, se le estensioni (es. hook pesanti come vision-handoff al
// resume) tengono occupato pi per più di 3s senza che arrivi il primo output,
// mostriamo un blocco con loader + timer come il Thinking, così l'utente capisce
// che qualcosa sta lavorando. Sparisce al primo output reale (o a fine turno).

const EXTENSIONS_DELAY_MS = 3000;
let extensionsWrapper: HTMLElement | null = null;
let extensionsTimerEl: HTMLElement | null = null;
let extensionsStartedAt = 0;
let extensionsClock: ReturnType<typeof setInterval> | null = null;
let extensionsTimeout: ReturnType<typeof setTimeout> | null = null;

function showExtensionsBlock(): void {
  if (extensionsWrapper) return;
  const wrapper = addMsg("status");
  wrapper.className = "msg status extensions-msg";
  extensionsWrapper = wrapper;
  const card = document.createElement("div");
  card.className = "thinking-card";
  const head = document.createElement("div");
  head.className = "thinking-head";
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = t("extensions");
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  extensionsTimerEl = document.createElement("span");
  extensionsTimerEl.className = "thinking-timer";
  extensionsTimerEl.textContent = "0s";
  head.append(label, spinner, extensionsTimerEl);
  card.appendChild(head);
  wrapper.appendChild(card);
  extensionsStartedAt = performance.now();
  extensionsClock = setInterval(() => {
    if (!extensionsTimerEl) return;
    extensionsTimerEl.textContent = `${Math.round((performance.now() - extensionsStartedAt) / 1000)}s`;
  }, 500);
  scrollToBottom();
}

function hideExtensionsBlock(): void {
  if (extensionsTimeout) {
    clearTimeout(extensionsTimeout);
    extensionsTimeout = null;
  }
  if (extensionsClock) {
    clearInterval(extensionsClock);
    extensionsClock = null;
  }
  if (extensionsWrapper) {
    extensionsWrapper.remove();
    extensionsWrapper = null;
    extensionsTimerEl = null;
  }
}

// armato a ogni invio: se entro 3s non arriva il primo output, mostra il blocco
function armExtensionsBlock(): void {
  hideExtensionsBlock();
  extensionsTimeout = setTimeout(() => {
    extensionsTimeout = null;
    if (working) showExtensionsBlock();
  }, EXTENSIONS_DELAY_MS);
}

// --- loader di invio sul messaggio utente -------------------------------------
// Appena l'utente invia, il suo messaggio mostra una rotella + timer che conta
// i secondi dall'invio alla prima risposta del modello (pensiero, testo o tool).
// Indipendente dal blocco "Estensioni" (che segnala il lavoro pre-stream):
// questo dà subito feedback che il messaggio è stato consegnato e si attende.

let sentLoaderEl: HTMLElement | null = null;
let sentLoaderSpinnerEl: HTMLElement | null = null;
let sentLoaderTimerEl: HTMLElement | null = null;
let sentLoaderStartedAt = 0;
let sentLoaderClock: ReturnType<typeof setInterval> | null = null;

function showSentLoader(wrapper: HTMLElement): void {
  hideSentLoader();
  const row = document.createElement("div");
  row.className = "sent-loader";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  sentLoaderTimerEl = document.createElement("span");
  sentLoaderTimerEl.className = "thinking-timer";
  sentLoaderTimerEl.textContent = "0s";
  row.append(spinner, sentLoaderTimerEl);
  wrapper.appendChild(row);
  sentLoaderEl = row;
  sentLoaderSpinnerEl = spinner;
  sentLoaderStartedAt = performance.now();
  sentLoaderClock = setInterval(() => {
    if (!sentLoaderTimerEl) return;
    const secs = Math.round((performance.now() - sentLoaderStartedAt) / 1000);
    sentLoaderTimerEl.textContent = `${secs}s`;
  }, 500);
}

// al primo contenuto reale del modello: via la rotella, il timer resta
// congelato sul messaggio come memoria di quanto ci ha messo a rispondere
function settleSentLoader(): void {
  if (sentLoaderClock) {
    clearInterval(sentLoaderClock);
    sentLoaderClock = null;
  }
  if (!sentLoaderEl) return;
  // già congelato: i delta successivi (es. ogni thinking_delta) NON devono
  // riscrivere il timer — il valore resta quello della prima risposta
  if (sentLoaderEl.classList.contains("settled")) return;
  const secs = Math.max(1, Math.round((performance.now() - sentLoaderStartedAt) / 1000));
  if (sentLoaderTimerEl) sentLoaderTimerEl.textContent = `${secs}s`;
  sentLoaderEl.classList.add("settled");
  sentLoaderSpinnerEl?.remove();
  sentLoaderSpinnerEl = null;
}

// rimosso completo (solo su abort): via rotella e timer
function hideSentLoader(): void {
  if (sentLoaderClock) {
    clearInterval(sentLoaderClock);
    sentLoaderClock = null;
  }
  if (sentLoaderEl) {
    sentLoaderEl.remove();
    sentLoaderEl = null;
    sentLoaderTimerEl = null;
    sentLoaderSpinnerEl = null;
  }
}

// --- slot del footer riempiti dalle ESTENSIONI pi (ctx.ui.setStatus) --------
// pi-webview è un renderer passivo: ogni estensione chiama setStatus(key, text)
// (già inoltrato come extension_ui_request in modalità RPC) e la webview
// mostra uno slot per chiave; setStatus(key, undefined) pulisce lo slot.
// Es. pi-tokens-per-second → ⚡ 43 tokens in 0.7s (59.1 t/s).

const statusSlots = new Map<string, string>();

// --- ANSI SGR → HTML con colori mappati sul tema ------------------------------
// Le estensioni formattano per il terminale: invece di buttare via i codici,
// li parsiamo (SGR: fg 16/256 colori, bold) e li rendiamo con i token del
// tema (--ansi-N), leggibili sia in dark sia in light.

// RGB standard xterm per ridurre i 256 colori al più vicino dei 16
const XTERM_RGB: Array<[number, number, number]> = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

function ansi256To16(n: number): number {
  if (n < 16) return n;
  if (n >= 232) return n >= 244 ? 15 : 8; // scala di grigi
  const i = n - 16;
  const cube = [0, 95, 135, 175, 215, 255];
  const r = cube[Math.floor(i / 36) % 6]!;
  const g = cube[Math.floor(i / 6) % 6]!;
  const b = cube[i % 6]!;
  let best = 7;
  let bestD = Infinity;
  for (let k = 0; k < 16; k++) {
    const [x, y, z] = XTERM_RGB[k]!;
    const d = (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function ansiEscapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}

// testo con sequenze ANSI → HTML sicuro (escape prima, poi wrap colorato)
function renderAnsiToHtml(text: string): string {
  // via le sequenze OSC (es. titoli di terminale); restano i CSI SGR
  const s = text.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
  const tokens = s.split(/(\u001b\[[0-9;]*m)/);
  let out = "";
  let fg: number | null = null;
  let bold = false;
  for (const tok of tokens) {
    const m = /^\u001b\[([0-9;]*)m$/.exec(tok);
    if (m) {
      const params = m[1] === "" ? [0] : m[1]!.split(";").map(Number);
      for (let i = 0; i < params.length; i++) {
        const p = params[i]!;
        if (p === 0) {
          fg = null;
          bold = false;
        } else if (p === 1) bold = true;
        else if (p === 22) bold = false;
        else if (p === 39) fg = null;
        else if (p >= 30 && p <= 37) fg = p - 30;
        else if (p >= 90 && p <= 97) fg = 8 + (p - 90);
        else if (p === 38 && params[i + 1] === 5) {
          fg = ansi256To16(params[i + 2] ?? 7);
          i += 2;
        }
      }
      continue;
    }
    const esc = ansiEscapeHtml(tok);
    if (fg !== null || bold) {
      const style =
        (bold ? "font-weight:600;" : "") +
        (fg !== null ? `color:var(--ansi-${fg});` : "");
      out += `<span style="${style}">${esc}</span>`;
    } else {
      out += esc;
    }
  }
  return out;
}

// solo testo pulito (per tooltip): toglie OSC e CSI
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
}

// richieste UI delle estensioni pi (ctx.ui.*): in VS Code le gestisce il
// companion con UI nativa (select/confirm/input), qui (standalone/piw) la
// webview risponde con i propri modali. Mai lasciare l'estensione in attesa.
function handleExtensionUiRequest(evt: RpcEvent): void {
  const id = evt.id as string | undefined;
  const method = evt.method as string | undefined;
  const respond = (payload: Record<string, unknown>) => {
    if (!id || !transport) return;
    transport.send({
      channel: "rpc",
      payload: { type: "extension_ui_response", id, ...payload },
    });
  };
  switch (method) {
    case "setStatus": {
      const key = evt.statusKey as string | undefined;
      if (!key) return;
      const text = evt.statusText as string | undefined;
      if (text && text.length > 0) statusSlots.set(key, text);
      else statusSlots.delete(key);
      renderStatusSlots();
      return;
    }
    case "select": {
      // il comando ha risposto (dialogo): ferma il timer del loader inviato
      settleSentLoader();
      hideExtensionsBlock();
      const title = (evt.title as string | undefined) ?? "";
      const options = (evt.options as string[] | undefined) ?? [];
      // ask_user: la prima domanda divide la card in N card (header = domanda
      // ellipsis, timer in fondo) — gli args JSON sono già nel body della card
      if (askUserQuestionCounter === 0) prepareAskUserCards();
      askUserQuestionCounter++;
      // INLINE in fondo alla chat (niente modale overlay): l'utente legge la
      // cronologia e risponde dal thread
      void inlineSelect(title, options).then((v) =>
        respond(v === undefined ? { cancelled: true } : { value: v }),
      );
      return;
    }
    case "confirm": {
      settleSentLoader();
      hideExtensionsBlock();
      const msg = (evt.message as string | undefined) ?? (evt.title as string) ?? "";
      void inlineConfirm(msg).then((ok) => respond({ confirmed: ok }));
      return;
    }
    case "input": {
      settleSentLoader();
      hideExtensionsBlock();
      const title = (evt.title as string | undefined) ?? "";
      const prefill = (evt.prefill as string | undefined) ?? "";
      void inlinePrompt(prefill, title).then((v) =>
        respond(v === null ? { cancelled: true } : { value: v }),
      );
      return;
    }
    case "editor": {
      // testo precompilato (es. modifica): stesso blocco di input
      settleSentLoader();
      hideExtensionsBlock();
      const title = (evt.title as string | undefined) ?? "";
      const prefill = (evt.prefill as string | undefined) ?? "";
      void inlinePrompt(prefill, title).then((v) =>
        respond(v === null ? { cancelled: true } : { value: v }),
      );
      return;
    }
    case "notify": {
      // risposta del comando estensione: ferma il timer del loader inviato
      // (i comandi non emettono agent_start/delta) e mostra la notifica in chat
      settleSentLoader();
      hideExtensionsBlock();
      const msg = (evt.message as string | undefined) ?? (evt.title as string) ?? "";
      if (msg) addStatusLine(msg);
      return;
    }
    default:
      // metodi fire-and-forget (setWidget/setTitle/…): nessuna risposta
      return;
  }
}

// modale di selezione (estensione pi, ctx.ui.select): lista opzioni con
// tastiera ↑/↓ + Invio, Esc/click fuori = annulla
// --- dialoghi estensione INLINE in fondo alla chat ---------------------------
// L'utente deve poter LEGGERE chat e cronologia mentre risponde: il dialogo
// (select/confirm/input da extension_ui_request) è un blocco in coda al
// thread, non un modale overlay. Una richiesta alla volta (le estensioni
// chiedono sequenzialmente); Esc o ✕ = annulla.
// Alla risposta il blocco COLLASSA in una card tool (come edit/write): una
// sola riga in ellipsis con la risposta e il timer secondi in fondo.
let inlineDialog: { el: HTMLElement; cancel: () => void } | null = null;

function closeInlineDialog(): void {
  const d = inlineDialog;
  if (!d) return;
  inlineDialog = null;
  d.cancel();
}

// card base del dialogo inline (titolo + timer live + ✕ + corpo), in fondo al
// thread. dismiss() = annulla (niente card); collapse() = risposta: la card
// diventa la riga tool compatta (nome + risposta ellipsis + timer congelato).
function inlineDialogCard(
  title: string,
  body: HTMLElement,
  onCancel: () => void,
): {
  el: HTMLElement;
  dismiss: () => void;
  collapse: (answer: string) => void;
} {
  const wrapper = addMsg("status");
  wrapper.className = "msg status inline-dialog-msg";
  const card = document.createElement("div");
  card.className = "inline-dialog";
  const head = document.createElement("div");
  head.className = "inline-dialog-head";
  const titleEl = document.createElement("span");
  titleEl.className = "inline-dialog-title";
  titleEl.textContent = title || "…";
  const x = document.createElement("button");
  x.type = "button";
  x.className = "inline-dialog-x";
  x.textContent = "✕";
  x.title = t("cancel");
  x.addEventListener("click", onCancel);
  head.append(titleEl, x);
  card.append(head, body);
  wrapper.appendChild(card);
  // FORZA l'autoscroll: è una domanda in attesa di risposta — va vista anche
  // se l'utente stava leggendo la cronologia più sopra (addMsg usa
  // stickToBottom e non strapperebbe la vista)
  scrollToBottom(true);
  const cleanup = () => {
    document.removeEventListener("keydown", esc, true);
  };
  const dismiss = () => {
    cleanup();
    wrapper.remove();
  };
  // risposta: NON creare una seconda card — aggiorna la card tool reale
  // (quella di toolcall_start, che pi finalizza con il risultato) e rimuovi
  // il blocco dialogo. Un solo box, con la risposta nella riga ellipsis e il
  // timer in fondo (la card reale lo fa già girare fino a tool_call_end).
  const collapse = (answer: string) => {
    cleanup();
    // ask_user: aggiorna la card della domanda corrente e chiudi (una card
    // per domanda, riga → risposta)
    if (collapseAskUserAnswer(answer)) {
      wrapper.remove();
      return;
    }
    const cards = Array.from(
      wrapper.parentElement?.querySelectorAll(".tool-card") ?? [],
    );
    let target: HTMLElement | null = null;
    for (const c of cards) {
      if (c.querySelector(".tool-name")?.textContent === "ask_user") {
        target = c as HTMLElement;
      }
    }
    if (target) {
      const args = target.querySelector<HTMLElement>(".tool-args");
      // multi-domanda nella stessa call: accoda alla riga (separatore ·)
      const wasAnswered = target.dataset.answered === "true";
      target.dataset.answered = "true";
      if (args) {
        const text = answer || "—";
        args.textContent = wasAnswered
          ? `${args.textContent} · ${text}`
          : ` ${text}`;
        args.title = answer;
      }
      wrapper.remove();
      return;
    }
    // fallback (dialogo senza card tool): crea la riga compatta nel wrapper
    const d = document.createElement("details");
    d.className = "tool-card";
    const s = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = "ask_user";
    const args2 = document.createElement("span");
    args2.className = "tool-args";
    args2.textContent = answer || "—";
    args2.title = answer;
    s.append(name, args2);
    // corpo espandibile: domanda + risposta (come gli args degli altri tool)
    const cb = document.createElement("div");
    cb.className = "code-block";
    const ch = document.createElement("div");
    ch.className = "code-header";
    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent = "ask_user";
    ch.appendChild(label);
    const pre = document.createElement("pre");
    pre.textContent = title ? `${title}\n→ ${answer ?? ""}` : (answer ?? "");
    cb.append(ch, pre);
    d.append(s, cb);
    wrapper.replaceChildren(d);
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };
  document.addEventListener("keydown", esc, true);
  return { el: wrapper, dismiss, collapse };
}

// selezione con opzioni (ctx.ui.select / ask_user)
function inlineSelect(title: string, options: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    closeInlineDialog();
    let settled = false;
    const finish = (v: string | undefined) => {
      if (settled) return;
      settled = true;
      inlineDialog = null;
      if (v === undefined) dialog.dismiss();
      else dialog.collapse(v);
      resolve(v);
    };
    const body = document.createElement("div");
    body.className = "inline-dialog-options";
    for (const opt of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "inline-dialog-option";
      b.textContent = opt;
      b.addEventListener("click", () => finish(opt));
      body.appendChild(b);
    }
    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "pop-empty";
      empty.textContent = t("noOptions");
      body.appendChild(empty);
    }
    const dialog = inlineDialogCard(title, body, () => finish(undefined));
    inlineDialog = { el: dialog.el, cancel: () => finish(undefined) };
  });
}

// conferma (ctx.ui.confirm)
function inlineConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    closeInlineDialog();
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      inlineDialog = null;
      if (!v) dialog.dismiss();
      else dialog.collapse(t("ok"));
      resolve(v);
    };
    const body = document.createElement("div");
    body.className = "inline-dialog-options inline-dialog-confirm";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn inline-dialog-ok";
    ok.textContent = t("ok");
    ok.addEventListener("click", () => finish(true));
    body.appendChild(ok);
    const dialog = inlineDialogCard(message, body, () => finish(false));
    inlineDialog = { el: dialog.el, cancel: () => finish(false) };
  });
}

// input di testo (ctx.ui.input / editor / "Other" di ask_user)
function inlinePrompt(prefill: string, title: string): Promise<string | null> {
  return new Promise((resolve) => {
    closeInlineDialog();
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      inlineDialog = null;
      if (v === null) dialog.dismiss();
      else dialog.collapse(v);
      resolve(v);
    };
    const body = document.createElement("div");
    body.className = "inline-dialog-prompt";
    const input = document.createElement("textarea");
    input.className = "inline-dialog-input";
    input.rows = 2;
    input.placeholder = title || t("dialogPlaceholder");
    input.value = prefill;
    const send = document.createElement("button");
    send.type = "button";
    send.className = "btn inline-dialog-ok";
    send.textContent = t("send");
    send.addEventListener("click", () => finish(input.value));
    body.append(input, send);
    const dialog = inlineDialogCard(title, body, () => finish(null));
    inlineDialog = { el: dialog.el, cancel: () => finish(null) };
    // Invio = invia, Shift+Invio = nuova riga
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finish(input.value);
      }
    });
    input.focus();
  });
}

function renderStatusSlots(): void {
  els.statsSlots.textContent = "";
  for (const [key, text] of statusSlots) {
    const slot = document.createElement("span");
    slot.className = "stats-slot";
    // ANSI del terminale → colori mappati sul tema (textContent no: serve HTML)
    slot.innerHTML = renderAnsiToHtml(text);
    slot.title = stripAnsi(text);
    els.statsSlots.appendChild(slot);
  }
  updateStatsTitle();
}

// titolo completo (tooltip) del badge: solo % di contesto + suggerimento click
// + soglia auto-compaction di pi tra parentesi (niente conteggi token: il
// contesto è già leggibile nella label del gauger)
let compactionSettings: { enabled: boolean; reserveTokens: number } | null = null;

function updateStatsTitle(): void {
  const parts: string[] = [];
  if (contextStats) {
    parts.push(
      contextStats.percent != null
        ? `${Math.round(contextStats.percent)}%`
        : "…",
    );
  }
  parts.push(t("clickToCompact"));
  if (compactionSettings) {
    if (compactionSettings.enabled && contextStats?.contextWindow) {
      const threshold = Math.round(
        ((contextStats.contextWindow - compactionSettings.reserveTokens) /
          contextStats.contextWindow) *
          100,
      );
      parts.push(`(${tpl(t("autoCompactAt"), { pct: String(threshold) })})`);
    } else if (!compactionSettings.enabled) {
      parts.push(`(${t("autoCompactOff")})`);
    }
  }
  for (const text of statusSlots.values()) parts.push(stripAnsi(text));
  els.statsBadge.title = parts.join(" · ");
}

// --- responsive: niente hiding a blocchi, solo ellipsis CSS standard ----------
// Il blocco contesto resta intero (flex: 0 0 auto); gli slot delle estensioni
// si restringono (flex: 1 1 auto + min-width: 0) e l'ultimo visibile mostra
// l'ellipsis nativo. Nessun JS necessario.

// --- gauger circolare del contesto (sempre visibile, barra teal) --------------

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 15.5;
let contextStats: {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
} | null = null;

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function renderContextGauge(): void {
  // dopo la compact pi non conosce i token finché non arriva una risposta:
  // percent null → anello a 0, label con la sola finestra (…/200K)
  const pct =
    contextStats?.percent != null
      ? Math.min(100, Math.max(0, contextStats.percent))
      : 0;
  els.ctxFill.style.strokeDashoffset = String(
    GAUGE_CIRCUMFERENCE * (1 - pct / 100),
  );
  els.ctxLabel.textContent = contextStats
    ? contextStats.tokens != null
      ? `${fmtK(contextStats.tokens)}/${fmtK(contextStats.contextWindow)}`
      : `…/${fmtK(contextStats.contextWindow)}`
    : "–";
  updateStatsTitle();
}

// saldo reale del provider (deepseek/openrouter): via companion/bridge
// (legge la key da auth.json, la webview riceve solo { currency, balance })
async function fetchBalance(): Promise<void> {
  if (!currentModel?.provider) return;
  const res = await ideRequest({
    type: "getBalance",
    provider: currentModel.provider,
  });
  const b = res?.ok ? (res.data as { currency?: string; balance?: number } | null) : null;
  if (b && typeof b.balance === "number" && b.currency) {
    creditCurrency = b.currency === "CNY" ? "¥" : "$";
    creditText = `${creditCurrency}${b.balance.toFixed(2)}`;
    creditBalance = b.balance;
  } else {
    creditText = ""; // provider senza endpoint di balance: niente saldo
    creditBalance = 0;
  }
  renderModelInfo();
}

// stats di sessione (token/contexto): poll dopo ogni turno e ai boot
async function fetchSessionStats(): Promise<void> {
  try {
    const res = await rpcRequest(rpc.getSessionStats());
    const data = res.data as
      | {
          cost?: number;
          contextUsage?: {
            tokens?: number | null;
            contextWindow?: number | null;
            percent?: number | null;
          };
        }
      | undefined;
    // costo totale della sessione (calcolato dal core di pi da usage reali)
    if (typeof data?.cost === "number") sessionCost = data.cost;
    const cu = data?.contextUsage;
    // dopo la compact pi torna { tokens: null, contextWindow, percent: null }:
    // la finestra è comunque nota → mostriamo …/finestra finché non c'è una
    // risposta successiva alla compattazione
    if (cu && typeof cu.contextWindow === "number") {
      contextStats = {
        tokens: typeof cu.tokens === "number" ? cu.tokens : null,
        contextWindow: cu.contextWindow,
        percent: typeof cu.percent === "number" ? cu.percent : null,
      };
    } else {
      contextStats = null;
    }
    renderContextGauge();
    renderBalanceChip(); // il costo sessione si aggiorna a ogni turno
  } catch {
    // pi non ancora pronto: il gauger resta su “–”
  }
}

// --- card dei tool con copia --------------------------------------------------

function ensureToolCard(name?: string): HTMLElement {
  if (!toolsEl && currentMsg) {
    // nome vero se già noto (toolcall_start), altrimenti placeholder neutro
    toolsEl = buildToolCard({ id: "", name: name || t("tool"), args: "" });
    toolsPre = toolsEl.querySelector<HTMLPreElement>("pre");
    currentMsg.appendChild(toolsEl);
    applyToolChainIfToolFirst(); // primo blocco tool: valuta il gap 3px
  }
  return toolsEl as HTMLElement;
}

// --- copia (componente unico, stesso stile ovunque) ---------------------------

function makeCopyButton(text: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.innerHTML = copyIcon();
  btn.title = t("copy");
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      btn.innerHTML = checkIcon();
      btn.title = t("copied");
      setTimeout(() => {
        btn.innerHTML = copyIcon();
        btn.title = t("copy");
      }, 1500);
    } catch {
      // clipboard non disponibile (es. webview senza permessi)
    }
  });
  return btn;
}

function addCopyButton(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = makeCopyButton(text);
  container.appendChild(btn);
  return btn;
}

// trasforma i <pre> di marked nel pattern unico code-block (header + copia)
function enhanceCodeBlocks(container: HTMLElement): void {
  for (const pre of Array.from(container.querySelectorAll("pre"))) {
    if (pre.parentElement?.classList.contains("code-block")) continue;
    const code = pre.querySelector("code");
    const lang =
      code?.className.match(/language-(\w+)/)?.[1] ?? code?.dataset.lang ?? "code";
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    const header = document.createElement("div");
    header.className = "code-header";
    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent = lang;
    header.append(label);
    addCopyButton(header, pre.textContent ?? "");
    pre.parentElement?.insertBefore(wrapper, pre);
    wrapper.append(header, pre);
  }
}

// --- finalizzazione messaggio -------------------------------------------------

// header card tool: nome in pill (accent pieno), argomenti attenuati accanto
function renderToolHeader(el: HTMLElement, summary: ToolSummary): void {
  el.textContent = summary.name;
  el.parentElement?.querySelector(".tool-args")?.remove();
  if (summary.args) {
    const args = document.createElement("span");
    args.className = "tool-args";
    args.textContent = ` ${summary.args}`;
    el.after(args);
  }
}

function finalizeMessage(msg: FinalizedMessage): void {
  if (currentText) {
    // pensiero prima del testo: lo slot è già prima di .md nel DOM
    if (thinkingEl && !thinkingContentRendered) finishThinking();
    if (msg.thinking.trim() && !thinkingContentRendered) {
      const card = document.createElement("div");
      card.className = "thinking-card";
      const { head } = makeThinkingHead(false);
      const body = document.createElement("div");
      body.className = "thinking-content";
      body.textContent = msg.thinking.trim();
      body.hidden = true; // collassato per default
      head.addEventListener("click", () => {
        body.hidden = !body.hidden;
      });
      card.append(head, body);
      thinkingSlot?.appendChild(card);
      thinkingContentRendered = true;
    }
    if (thinkingSlot && !thinkingSlot.hasChildNodes()) thinkingSlot.remove();
    markdownAccum = msg.text;
    currentText.innerHTML = renderMarkdown(msg.text);
    enhanceCodeBlocks(currentText);
    // tool call: riusa la card di streaming per il primo (evita duplicati)
    const toolCalls = msg.toolCalls;
    if (toolCalls.length > 0) {
      const first = toolCalls[0];
      if (first) {
        if (toolsEl) {
          renderToolHeader(
            toolsEl.querySelector(".tool-name")!,
            toolSummary(first.name, first.args, workspacePath ?? undefined),
          );
          const lbl = toolsEl.querySelector(".code-label");
          if (lbl) lbl.textContent = first.name;
          if (toolsPre) toolsPre.textContent = first.args;
          const header = toolsEl.querySelector<HTMLElement>(".code-header");
          if (header && !header.querySelector(".copy-btn"))
            addCopyButton(header, first.args);
          if (first.id) toolCardsById.set(first.id, toolsEl as HTMLElement);
        } else {
          createToolCard(first);
        }
      }
      for (const tc of toolCalls.slice(1)) createToolCard(tc);
    }
  }
  // wrapper assistant senza contenuto (es. stream vuoto): rimuovilo, altrimenti
  // crea gap fantasma tra i blocchi tool nella cronologia
  if (currentMsg) {
    const hasContent =
      !!currentMsg.querySelector(".thinking-card") ||
      !!currentMsg.querySelector(".tool-card") ||
      (currentText ? currentText.textContent.trim().length > 0 : false);
    if (!hasContent) currentMsg.remove();
  }
  currentMsg = null;
  currentText = null;
  thinkingSlot = null;
}

function createToolCard(tc: ToolCallInfo): void {
  const card = buildToolCard(tc);
  currentMsg?.appendChild(card);
  if (tc.id) toolCardsById.set(tc.id, card);
}

function buildToolCard(tc: ToolCallInfo): HTMLElement {
  const d = document.createElement("details");
  d.className = "tool-card";
  const s = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "tool-name";
  // il nome va attaccato PRIMA di renderToolHeader: el.after() su un nodo
  // staccato crea e scarta lo span args in silenzio (niente comando nel summary)
  s.appendChild(name);
  renderToolHeader(name, toolSummary(tc.name, tc.args, workspacePath ?? undefined));
  const timer = document.createElement("span");
  timer.className = "tool-timer";
  s.appendChild(timer);
  const body = document.createElement("div");
  body.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-header";
  const label = document.createElement("span");
  label.className = "code-label";
  label.textContent = tc.name;
  const pre = document.createElement("pre");
  pre.textContent = tc.args;
  header.append(label);
  addCopyButton(header, tc.args);
  body.append(header, pre);
  d.append(s, body);
  return d;
}

function buildThinkingCard(content: string, durationMs = 0): HTMLElement {
  const card = document.createElement("div");
  card.className = "thinking-card";
  const head = document.createElement("div");
  head.className = "thinking-head";
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = t("thought");
  head.appendChild(label);
  // durata stimata: timestamp assistant − timestamp messaggio precedente
  // (nel loop di tool quel gap è il tempo di ragionamento LLM, dominato dal
  // pensiero) — stesso formato dei timer live (min 1s, arrotondato)
  if (durationMs > 0) {
    const timer = document.createElement("span");
    timer.className = "thinking-timer";
    timer.textContent = `${Math.max(1, Math.round(durationMs / 1000))}s`;
    head.appendChild(timer);
  }
  const body = document.createElement("div");
  body.className = "thinking-content";
  body.textContent = content;
  body.hidden = true;
  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
  });
  card.append(head, body);
  return card;
}

// card compatto per il risultato di un tool (output troncato)
function buildResultCard(toolName: string, output: string): HTMLElement {
  const d = document.createElement("details");
  d.className = "tool-card";
  const s = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = toolName;
  const tag = document.createElement("span");
  tag.className = "tool-args";
  tag.textContent = `· ${t("result")}`;
  s.append(name, tag);
  const body = document.createElement("div");
  body.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-header";
  const label = document.createElement("span");
  label.className = "code-label";
  label.textContent = "output";
  const MAX = 10_000;
  const truncated = output.length > MAX;
  const pre = document.createElement("pre");
  pre.textContent = truncated ? output.slice(0, MAX) + "\n… (troncato)" : output;
  header.append(label);
  addCopyButton(header, output);
  body.append(header, pre);
  d.append(s, body);
  return d;
}

// --- output live dei tool -----------------------------------------------------
// la card creata durante lo streaming mostra anche il RISULTATO del tool
// (tool_execution_start/update/end), come nella cronologia.

const toolCardsById = new Map<string, HTMLElement>();

// --- timer di esecuzione dei tool ---------------------------------------------

const toolTimers = new Map<
  HTMLElement,
  {
    startedAt: number;
    clock: ReturnType<typeof setInterval> | null;
    el: HTMLElement | null;
  }
>();

function fmtToolTime(ms: number): string {
  // sotto il secondo mostra i millisecondi veri (3ms, 142ms): lo 0.0s
  // dell'arrotondamento nascondeva operazioni reali ma velocissime
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const s = ms / 1000;
  return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
}

function startToolTimer(card: HTMLElement): void {
  if (toolTimers.has(card)) return;
  const el = card.querySelector<HTMLElement>(".tool-timer");
  const state = {
    startedAt: performance.now(),
    clock: null as ReturnType<typeof setInterval> | null,
    el,
  };
  if (el) el.textContent = "0s";
  state.clock = setInterval(() => {
    if (el) el.textContent = fmtToolTime(performance.now() - state.startedAt);
  }, 200);
  toolTimers.set(card, state);
}

function stopToolTimer(card: HTMLElement): void {
  const state = toolTimers.get(card);
  if (!state) return;
  if (state.clock) clearInterval(state.clock);
  if (state.el) state.el.textContent = fmtToolTime(performance.now() - state.startedAt);
  toolTimers.delete(card);
}

function clearToolTimers(): void {
  for (const [, state] of toolTimers) {
    if (state.clock) clearInterval(state.clock);
  }
  toolTimers.clear();
}
const toolOutputPre = new Map<string, HTMLPreElement>();
// timestamp di partenza dei tool nella cronologia (assistant → toolResult)
const toolStartTimes = new Map<string, number>();

// --- ask_user: UNA CARD PER DOMANDA -------------------------------------------
// pi chiama ask_user UNA volta con N domande nel payload; la webview divide la
// card in N card (header = domanda ellipsis + timer), aggiornate alla risposta
// (header → risposta, risultato nel corpo). Stato persistito anche al resume.
interface AskUserInfo {
  cards: HTMLElement[];
  questions: string[];
}
const askUserInfoByTool = new Map<string, AskUserInfo>();
let askUserQuestionCounter = 0; // domanda corrente (1-based) del tool in corso
let currentAskUserToolId = "";

// parsing degli args di ask_user: JSON { questions: [...] } (o singolo oggetto)
function parseAskUserQuestions(
  argsJson: string,
): Array<{ question: string; options?: unknown[] }> | null {
  try {
    const parsed = JSON.parse(argsJson);
    const raw = Array.isArray(parsed?.questions)
      ? parsed.questions
      : parsed && typeof parsed === "object"
        ? [parsed]
        : [];
    if (raw.length === 0) return null;
    return raw.map((q: unknown) => ({
      question:
        typeof (q as { question?: unknown })?.question === "string"
          ? ((q as { question?: string }).question as string)
          : JSON.stringify(q),
      options: Array.isArray((q as { options?: unknown })?.options)
        ? ((q as { options?: unknown[] }).options as unknown[])
        : undefined,
    }));
  } catch {
    return null;
  }
}

// header della card ask_user: nome + testo (domanda o risposta) ellipsis + timer
function setAskUserHeader(card: HTMLElement, text: string): void {
  const name = card.querySelector(".tool-name")!;
  name.textContent = "ask_user";
  card.querySelector(".tool-args")?.remove();
  const args = document.createElement("span");
  args.className = "tool-args";
  args.textContent = ` ${text || "…"}`;
  args.title = text;
  name.after(args);
}

// divide la card singola in N card (una per domanda), header = domanda
function splitAskUserCard(
  firstCard: HTMLElement,
  toolId: string,
  questions: Array<{ question: string; options?: unknown[] }>,
): HTMLElement[] {
  const cards: HTMLElement[] = [firstCard];
  firstCard.dataset.askUser = "true";
  setAskUserHeader(firstCard, questions[0]?.question ?? "");
  const label = firstCard.querySelector(".code-label");
  if (label) label.textContent = "ask_user";
  const firstPre = firstCard.querySelector<HTMLPreElement>(".code-block pre");
  if (firstPre) firstPre.textContent = questions[0]?.question ?? "";
  // niente timer per le domande: non servono (rimuovi anche dalla prima card,
  // che lo aveva da buildToolCard)
  firstCard.querySelector(".tool-timer")?.remove();
  let prev = firstCard;
  for (let i = 1; i < questions.length; i++) {
    const card = buildToolCard({ id: "", name: "ask_user", args: "" });
    card.dataset.askUser = "true";
    setAskUserHeader(card, questions[i]?.question ?? "");
    const pre = card.querySelector<HTMLPreElement>(".code-block pre");
    if (pre) pre.textContent = questions[i]?.question ?? "";
    card.querySelector(".tool-timer")?.remove();
    prev.insertAdjacentElement("afterend", card);
    cards.push(card);
    prev = card;
  }
  if (toolId) {
    askUserInfoByTool.set(toolId, {
      cards,
      questions: questions.map((q) => q.question),
    });
  }
  return cards;
}

// applica fn a tutte le card del tool (ask_user: N card; altri: 1)
function forEachToolCard(toolId: string, fn: (c: HTMLElement) => void): void {
  const info = askUserInfoByTool.get(toolId);
  if (info && info.cards.length > 0) info.cards.forEach(fn);
  else {
    const first = toolCardsById.get(toolId);
    if (first) fn(first);
  }
}

// il risultato di ask_user ("Q1: …\nA1: …\n\nQ2: …\nA2: …") viene distribuito
// per domanda: ogni card riceve il suo segmento nel corpo e la risposta nella
// riga (stato finale, identico anche al resume)
function distributeAskUserResult(toolId: string, resultText: string): boolean {
  const info = askUserInfoByTool.get(toolId);
  if (!info || info.cards.length === 0) return false;
  const segments = resultText
    .split(/(?=Q\d+:)/)
    .map((s) => s.trim())
    .filter(Boolean);
  info.cards.forEach((card, i) => {
    const seg = segments[i];
    if (!seg) return;
    const pre = ensureToolOutput(card, `${toolId}-q${i}`);
    pre.textContent = seg;
    const m = seg.match(/^A\d+:\s*([\s\S]*)$/m);
    const g = m?.[1];
    const answer = g ? g.trim() : "";
    if (answer) {
      card.dataset.answered = "true";
      const args = card.querySelector<HTMLElement>(".tool-args");
      if (args) {
        args.textContent = ` ${answer}`;
        args.title = answer;
      }
    }
  });
  return true;
}

// alla risposta del dialogo: aggiorna la card della domanda corrente (header →
// risposta, risultato subito nel corpo — la distribuzione di
// tool_execution_end lo sovrascrive con lo stesso contenuto, idempotente)
function collapseAskUserAnswer(answer: string): boolean {
  if (!currentAskUserToolId) return false;
  const info = askUserInfoByTool.get(currentAskUserToolId);
  const i = askUserQuestionCounter - 1;
  const card = info?.cards[i];
  if (!card) return false;
  card.dataset.answered = "true";
  const args = card.querySelector<HTMLElement>(".tool-args");
  if (args) {
    args.textContent = ` ${answer || "—"}`;
    args.title = answer;
  }
  const question = info.questions[i] ?? "";
  const pre = ensureToolOutput(card, `${currentAskUserToolId}-q${i}`);
  pre.textContent = `Q${i + 1}: ${question}\nA${i + 1}: ${answer}`;
  scrollToBottom();
  return true;
}

// primo dialogo di un ask_user: gli args (JSON questions) sono già nel body
// della card → divide in N card e registra lo stato per le risposte
function prepareAskUserCards(): void {
  let card: HTMLElement | null = null;
  for (const c of Array.from(
    els.thread.querySelectorAll<HTMLElement>(".tool-card"),
  )) {
    if (c.querySelector(".tool-name")?.textContent === "ask_user") card = c;
  }
  if (!card) return;
  let toolId = "";
  for (const [id, c] of toolCardsById) {
    if (c === card) toolId = id;
  }
  const pre = card.querySelector<HTMLPreElement>(".code-block pre");
  const questions = parseAskUserQuestions(pre?.textContent ?? "");
  if (!questions || questions.length === 0) return;
  currentAskUserToolId = toolId;
  splitAskUserCard(card, toolId, questions);
}

// timestamp del messaggio (numero epoch ms o string ISO), 0 se assente/non valido
function parseTs(msg: unknown): number {
  const raw = (msg as { timestamp?: unknown }).timestamp;
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b as { type?: string; text?: string }).text ?? "")
      .join("");
  }
  return "";
}

function ensureToolOutput(card: HTMLElement, id: string): HTMLPreElement {
  let pre = toolOutputPre.get(id);
  if (!pre || !card.contains(pre)) {
    const body = document.createElement("div");
    body.className = "code-block tool-output";
    const header = document.createElement("div");
    header.className = "code-header";
    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent = t("result");
    pre = document.createElement("pre");
    header.append(label);
    body.append(header, pre);
    card.appendChild(body);
    toolOutputPre.set(id, pre);
  }
  return pre;
}

// --- statistiche di diff (righe aggiunte/rimosse/modificate) -------------------
// Parsa un diff unificato (details.diff di edit/write/edit-diff): una riga “-”
// seguita da righe “+” è una MODIFICA in place (contata una volta), altrimenti
// conteggi puri di aggiunte/rimozioni.

interface DiffStats {
  added: number;
  removed: number;
  modified: number;
}

function diffStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  let modified = 0;
  let pendingRemoved = 0;
  let pendingAdded = 0;
  const flush = (): void => {
    if (pendingRemoved > 0 && pendingAdded > 0) {
      // gruppo di righe rimpiazzate in place: contato come modifica
      modified += Math.max(pendingRemoved, pendingAdded);
    } else {
      added += pendingAdded;
      removed += pendingRemoved;
    }
    pendingRemoved = 0;
    pendingAdded = 0;
  };
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+")) pendingAdded++;
    else if (line.startsWith("-")) pendingRemoved++;
    else flush(); // contesto o header: chiude il gruppo corrente
  }
  flush();
  return { added, removed, modified };
}

// badge nel summary della card, PRIMA del timer, separato da pipe mute
function renderToolDiff(card: HTMLElement, diff: string): void {
  const s = diffStats(diff);
  if (s.added === 0 && s.removed === 0 && s.modified === 0) return;
  // rimuovi un eventuale badge precedente (es. il +N del write) prima del nuovo
  card.querySelector(".tool-diff")?.remove();
  const el = document.createElement("span");
  el.className = "tool-diff";
  const parts: Array<[string, string, string]> = [
    ["d-add", "+", String(s.added)],
    ["d-rem", "−", String(s.removed)],
    ["d-mod", "~", String(s.modified)],
  ];
  for (const [cls, sign, count] of parts) {
    // MAI zeri: insert puro → +100, delete puro → −200, sostituzione → +N −M
    if (count === "0") continue;
    const p = document.createElement("span");
    p.className = cls;
    p.textContent = `${sign}${count}`;
    el.appendChild(p);
  }
  // prima del timer (che sta nel summary)
  card.querySelector(".tool-timer")?.before(el);
}

// righe del contenuto di write: il valore "content" negli args (\n escaped).
// ATTENZIONE: il modello emette "content": "..." (spazio dopo i due punti)
// e il contenuto può contenere \" (quote escaped) — regex whitespace-tollerante
function writeLinesFromArgs(argsJson: string): number {
  const m = argsJson.match(/"content"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/);
  const content = m?.[1] ?? "";
  return content ? (content.match(/\\n/g) ?? []).length + 1 : 0;
}

// badge +N delle righe scritte (write non ha diff da pi: lo calcoliamo noi)
function renderWriteLines(card: HTMLElement, lines: number): void {
  if (lines <= 0) return;
  card.querySelector(".tool-diff")?.remove();
  const el = document.createElement("span");
  el.className = "tool-diff";
  const p = document.createElement("span");
  p.className = "d-add";
  p.textContent = `+${lines}`;
  el.appendChild(p);
  card.querySelector(".tool-timer")?.before(el);
}

// applica fn a tutte le card del tool (ask_user: N card; altri: 1)
function handleToolExecution(evt: RpcEvent): void {
  const id = evt.toolCallId as string | undefined;
  if (!id) return;
  const card = toolCardsById.get(id);
  if (!card) return;
  if (evt.type === "tool_execution_start") {
    // timer su TUTTE le card (ask_user ne ha una per domanda)
    forEachToolCard(id, (c) => startToolTimer(c));
    const pre = ensureToolOutput(card, id);
    pre.textContent = "";
  } else if (evt.type === "tool_execution_update") {
    const part = evt.partialResult as { content?: unknown } | undefined;
    const text = extractTextContent(part?.content);
    if (text) {
      const pre = ensureToolOutput(card, id);
      pre.textContent += text;
      scrollToBottom();
    }
  } else if (evt.type === "tool_execution_end") {
    forEachToolCard(id, (c) => stopToolTimer(c));
    const res = evt.result as
      { content?: unknown; details?: { diff?: string } } | undefined;
    // righe aggiunte/rimosse/modificate dal diff (edit/write/edit-diff)
    const diff = res?.details?.diff;
    if (diff) renderToolDiff(card, diff);
    const text = extractTextContent(res?.content);
    if (text) {
      // ask_user: distribuisci il risultato per domanda (una card ciascuna)
      if (distributeAskUserResult(id, text)) {
        scrollToBottom();
        return;
      }
      const pre = ensureToolOutput(card, id);
      pre.textContent = text;
      scrollToBottom();
    }
  }
}

function renderRpcEvent(evt: RpcEvent): void {
  trackWorking(evt);
  // stearing: consegna al punto di pi.dev (dopo i tool call del turno) e
  // riconciliazione con la coda nativa di pi
  if (evt.type === "turn_end") {
    if (working) deliverSteering(); // in streaming: prompt(streamingBehavior:"steer")
    return;
  }
  if (evt.type === "message_start") {
    const msg = (evt as {
      message?: { role?: string; customType?: string; content?: unknown; display?: unknown };
    }).message;
    const role = msg?.role;
    if (role === "user") {
      // stearing iniettato (o messaggio inviato normalmente: già reso)
      handleUserMessageStart(evt);
      return;
    }
    if (msg && role === "custom" && msg.display !== false) {
      // messaggio iniettato da un'ALTRA sessione (es. session-control
      // `send`): bubble in arrivo — la chat deve mostrarlo
      renderCustomMessageBubble(msg);
      return;
    }
  }
  // compattazione: mostra il blocco anche se avviata da pi (auto-compaction)
  if (evt.type === "compaction_start") {
    showCompactionBlock();
  } else if (evt.type === "compaction_end") {
    // esito REALE da pi: errorMessage presente → fallita (il client non può
    // fidarsi della sola response: arriva dopo l'evento)
    const errMsg = evt.errorMessage as string | undefined;
    finishCompaction(!!errMsg, errMsg);
    // stearing: dopo la compattazione riparte la consegna della coda
    deliverSteering();
  } else if (evt.type === "connection_closed") {
    if (evt.reason === "restart") {
      // riavvio VOLUTO (Applica CLI flags): pi sta ripartendo con la nuova
      // riga di comando → niente errore; il re-init arriva con pi_restarted
      piRestarting = true;
      updateSendButton();
      return;
    }
    // pi è morto (processo terminato): sblocca tutto e avvisa
    if (compacting) finishCompaction(true, (evt.errorMessage as string) ?? undefined);
    hideSentLoader();
    hideExtensionsBlock();
    working = false;
    updateSendButton();
    addStatusLine(t("piDied"));
  } else if (evt.type === "panel_mode") {
    // webview in un PANNELLO editor (non sidebar): la selezione allegata è
    // inaffidabile (il focus sul pannello azzera il contesto dell'editor
    // attivo) → inibisci il blocco selezione
    panelMode = evt.enabled === true;
    if (panelMode) els.selectionPanel.hidden = true;
  } else if (evt.type === "pi_restarted") {
    // riavvio completato: ri-inizializza SENZA reload (trasparente): stato
    // sessione + config; la sessione corrente è ripresa dal companion con
    // --session, currentSessionPath è ancora in memoria
    piRestarting = false;
    updateSendButton();
    // reset UI Applica: i valori applicati sono ora quelli salvati
    els.cliApply.disabled = false;
    els.cliApplyRow.hidden = true;
    els.cliApplyHint.textContent = "";
    savedCliValues = currentCliValues();
    if (compacting) finishCompaction(true, "riavvio");
    requestConfig();
    if (!demoMode) void refreshSessions();
  }
  // richieste UI delle estensioni pi (ctx.ui.*) → modali webview (standalone)
  if (evt.type === "extension_ui_request") {
    handleExtensionUiRequest(evt);
    return;
  }
  if (
    evt.type === "tool_execution_start" ||
    evt.type === "tool_execution_update" ||
    evt.type === "tool_execution_end"
  ) {
    handleToolExecution(evt);
    if (evt.type === "tool_execution_start") settleSentLoader(); // primo output reale
    if (evt.type === "tool_execution_start") hideExtensionsBlock(); // primo output reale
    return;
  }
  const action: UiAction = handleRpcEvent(stream, evt);
  switch (action.kind) {
    case "stream_start":
      // NOTA: message_start arriva appena aperto lo stream del provider, NON
      // al primo token: qui il loader di invio deve restare (lo tolgono i delta)
      hideExtensionsBlock();
      openAssistantBubble();
      break;
    case "text_delta":
      settleSentLoader();
      hideExtensionsBlock();
      markdownAccum += action.delta;
      scheduleMarkdownRender();
      scrollToBottom();
      break;
    case "thinking_delta":
      settleSentLoader();
      hideExtensionsBlock();
      ensureThinkingLoader();
      thinkingAccum += action.delta;
      if (thinkingContentEl) thinkingContentEl.textContent = thinkingAccum;
      scrollToBottom();
      break;
    case "thinking_end":
      finishThinking();
      break;
    case "tool_call_start":
      // il nome arriva con toolcall_start (partial.content[index].name):
      // la card nasce GIÀ col nome vero, senza placeholder "tool"
      settleSentLoader();
      hideExtensionsBlock();
      {
        const tc = action.toolCall;
        if (tc.name) {
          // nuovo tool ask_user: reset contatore — le card si dividono al
          // primo select (gli args arrivano con i delta, non qui)
          if (tc.name === "ask_user") {
            askUserQuestionCounter = 0;
            currentAskUserToolId = "";
          }
          const card = ensureToolCard(tc.name);
          // il timer parte APPENA nasce la card (generazione args inclusa),
          // non a tool_execution_start: mentre i contatori diff scorrono il
          // timer gira già. startToolTimer è idempotente (il secondo avvio a
          // execution_start è un no-op) e stopToolTimer a execution_end lo
          // congela.
          startToolTimer(card);
          // nuovo tool: azzera gli args del tool precedente (multi-tool)
          toolsText = "";
          if (toolsPre) toolsPre.textContent = "";
          renderToolHeader(
            card.querySelector(".tool-name")!,
            toolSummary(tc.name, "", workspacePath ?? undefined),
          );
          // write/edit: span args VUOTO già da ora — senza, durante lo
          // streaming il badge diff (flex:0) resta attaccato al nome a
          // sinistra; l'args (flex:1, anche vuoto) lo spinge a destra prima
          // del timer, come a fine esecuzione
          if (tc.name === "write" || tc.name === "edit") {
            if (!card.querySelector(".tool-args")) {
              const argsEl = document.createElement("span");
              argsEl.className = "tool-args";
              card.querySelector(".tool-name")?.after(argsEl);
            }
          }
          const label = card.querySelector(".code-label");
          if (label) label.textContent = tc.name;
          if (tc.id) toolCardsById.set(tc.id, card);
        }
      }
      break;
    case "tool_args_delta":
      settleSentLoader();
      hideExtensionsBlock();
      ensureToolCard();
      toolsText += action.delta;
      if (toolsPre) toolsPre.textContent = toolsText;
      // write: contatore LIVE delle righe — qui i delta SCORRONO davvero (il
      // contenuto è lungo) e il numero sale in tempo reale. Gli edit NO (args
      // in raffica): per loro resta solo il diff esatto a fine esecuzione.
      if (toolsEl) {
        const tName = toolsEl.querySelector(".tool-name")?.textContent;
        if (tName === "write") {
          const lines = (toolsText.match(/\\n/g) ?? []).length;
          let badge = toolsEl.querySelector<HTMLElement>(".tool-diff");
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "tool-diff";
            const timerEl = toolsEl.querySelector(".tool-timer");
            if (timerEl) timerEl.before(badge);
            else toolsEl.querySelector("summary")?.appendChild(badge);
          }
          let p = badge.querySelector<HTMLElement>(".d-add");
          if (!p) {
            p = document.createElement("span");
            p.className = "d-add";
            badge.appendChild(p);
          }
          p.textContent = `+${lines}`;
        }
      }
      scrollToBottom();
      break;
    case "tool_call":
      settleSentLoader();
      hideExtensionsBlock();
      if (toolsEl) {
        const tcName = action.toolCall.name;
        // ask_user: la riga mostra la domanda/risposta (card divise o risposta
        // dal dialogo inline) — NON sovrascriverla con gli args al tool_call_end
        if (toolsEl.dataset.answered !== "true" && toolsEl.dataset.askUser !== "true") {
          renderToolHeader(
            toolsEl.querySelector(".tool-name")!,
            toolSummary(tcName, action.toolCall.args, workspacePath ?? undefined),
          );
        }
        const label = toolsEl.querySelector(".code-label");
        if (label) label.textContent = tcName;
        if (action.toolCall.id)
          toolCardsById.set(action.toolCall.id, toolsEl as HTMLElement);
        // write: pi NON restituisce il diff (solo "wrote X bytes") — il +N
        // delle righe scritte lo calcola la webview dal contenuto negli args.
        // Fallback su toolsText (JSON grezzo dai delta): a volte il tool_call
        // arriva con args wrappati come stringa (JSON.stringify di una stringa)
        // e il regex sul contenuto non matcha.
        if (tcName === "write") {
          const argsJson =
            typeof action.toolCall.args === "string"
              ? action.toolCall.args
              : JSON.stringify(action.toolCall.args ?? {});
          let lines = writeLinesFromArgs(argsJson);
          if (lines <= 0) lines = writeLinesFromArgs(toolsText);
          if (lines <= 0 && toolsPre) lines = writeLinesFromArgs(toolsPre.textContent ?? "");
          renderWriteLines(toolsEl, lines);
        }
      }
      break;
    case "message_end":
      finalizeMessage(action.message);
      break;
    default:
      break;
  }
}

function addStatusLine(text: string): void {
  const wrapper = addMsg("status");
  const line = document.createElement("div");
  line.className = "status-line";
  line.textContent = text;
  wrapper.appendChild(line);
  // NB: addMsg scolla PRIMA che il box esista (wrapper vuoto): il contenuto
  // multilinea lo fa crescere dopo → re-scroll qui, altrimenti il box resta
  // tagliato sotto il fondo visibile ("quasi in fondo ma non del tutto")
  scrollToBottom();
}

// card per messaggi INIETTATI da un'altra sessione (role custom, es.
// session-control): collassabile come i tool (<details>) — UNA riga con
// ellipsis chiusa, click per espandere, markdown interpretato dentro
function buildSessionCard(customType: string, text: string): HTMLElement {
  const d = document.createElement("details");
  d.className = "session-card";
  const s = document.createElement("summary");
  const tag = document.createElement("span");
  tag.className = "session-tag";
  tag.textContent = customType;
  const preview = document.createElement("span");
  preview.className = "session-preview";
  preview.textContent = text; // CSS: nowrap + ellipsis → una riga
  preview.title = text;
  s.append(tag, preview);
  const body = document.createElement("div");
  body.className = "session-body";
  body.innerHTML = renderMarkdown(text);
  d.append(s, body);
  return d;
}

function renderCustomMessageBubble(msg: {
  customType?: string;
  content?: unknown;
}): void {
  const raw = extractTextContent(msg.content);
  const text = raw.replace(/<sender_info>[\s\S]*?<\/sender_info>/g, "").trim();
  if (!text) return;
  const wrapper = addMsg("user");
  const card = buildSessionCard(msg.customType ?? "session", text);
  card.style.width = "100%";
  wrapper.appendChild(card);
  scrollToBottom();
}

function renderIdeEvent(evt: IdeEvent): void {
  if (evt.type === "selection_changed" || evt.type === "selection_cleared") {
    // pannello editor: blocco selezione INIBITO (il focus sul pannello
    // azzera il contesto dell'editor attivo → mostrarlo sarebbe confuso)
    if (panelMode) return;
    if (evt.type === "selection_changed") {
      // blocco dedicato (una riga, come lo stearing): appare con la selezione
      const n = evt.ranges?.length ?? 0;
      const base = evt.filePath?.split(/[\\/]/).pop() ?? evt.filePath ?? "?";
      els.selectionPanel.textContent = `${t("selection")}: ${base} (${n})`;
      els.selectionPanel.title = `${t("selection")}: ${evt.filePath ?? "?"} — ${n} ${t("ranges")}`;
      const wasHidden = els.selectionPanel.hidden;
      els.selectionPanel.hidden = false;
      if (wasHidden) scrollToBottom(true); // il blocco copre l'ultimo messaggio
    } else {
      els.selectionPanel.hidden = true;
    }
    return;
  }
  if (evt.type === "at_mentioned") {
    addStatusLine(`@ ${evt.filePath ?? "?"}`);
  }
}

// --- cronologia (dopo switch sessione / al primo caricamento) ----------------

type HistoryBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
};

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as HistoryBlock;
        if (typeof block.text === "string") return block.text;
        if (block.type === "thinking" && typeof block.thinking === "string")
          return block.thinking;
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

// cronologia fedele: testo, pensiero e CARD dei tool usati (come la vista live)
function renderHistory(messages: unknown[]): void {
  els.thread.textContent = "";
  toolCardsById.clear();
  clearToolTimers();
  toolOutputPre.clear();
  toolStartTimes.clear();
  askUserInfoByTool.clear();
  askUserQuestionCounter = 0;
  currentAskUserToolId = "";
  // timestamp dell'ultimo messaggio processato (per stimare la durata del
  // pensiero: gap dal messaggio precedente al messaggio assistant corrente)
  let lastTs = 0;
  for (const m of messages) {
    const msg = m as {
      role?: string;
      content?: unknown;
      toolName?: string;
      output?: string;
      command?: string;
      isError?: boolean;
    };
    const ts = parseTs(msg);
    if (msg.role === "user") {
      const wrapper = addMsg("user");
      const bubble = document.createElement("div");
      bubble.className = "bubble user";
      bubble.textContent = contentToText(msg.content);
      wrapper.appendChild(bubble);
    } else if (msg.role === "custom" && (msg as { display?: unknown }).display !== false) {
      // messaggio iniettato da un'altra sessione (session-control send):
      // card collassabile come i tool, anche in cronologia (altrimenti
      // sparirebbe al reload)
      const raw = contentToText(msg.content);
      const text = raw.replace(/<sender_info>[\s\S]*?<\/sender_info>/g, "").trim();
      if (!text) continue;
      const wrapper = addMsg("user");
      const card = buildSessionCard(
        (msg as { customType?: string }).customType ?? "session",
        text,
      );
      card.style.width = "100%";
      wrapper.appendChild(card);
    } else if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content) ? (msg.content as HistoryBlock[]) : [];
      const assistantTs = parseTs(msg);
      // durata stimata del pensiero: gap dal messaggio precedente (ultimo
      // messaggio processato — user o toolResult) al timestamp di questo
      const thinkDur =
        assistantTs > 0 && lastTs > 0 && assistantTs >= lastTs ? assistantTs - lastTs : 0;
      const textParts: string[] = [];
      const thinkingCards: HTMLElement[] = [];
      const toolCards: HTMLElement[] = [];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string") textParts.push(b.text);
        else if (b.type === "thinking" && typeof b.thinking === "string")
          thinkingCards.push(buildThinkingCard(b.thinking, thinkDur));
        else if (b.type === "toolCall" && typeof b.name === "string") {
          // stessa costruzione del runtime; args può essere stringa JSON o oggetto
          const raw = b.arguments;
          const argsJson = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
          const card = buildToolCard({
            id: b.id ?? "",
            name: b.name,
            args: argsJson,
          });
          // registra la card per id: il toolResult successivo ci appende il
          // risultato (stessa visualizzazione del runtime)
          if (b.id) toolCardsById.set(b.id, card);
          if (b.id && assistantTs > 0) toolStartTimes.set(b.id, assistantTs);
          // ask_user con N domande → N card (header = domanda, poi risposta)
          if (b.name === "ask_user" && b.id) {
            const questions = parseAskUserQuestions(argsJson);
            if (questions && questions.length > 0) {
              const cards = splitAskUserCard(card, b.id, questions);
              toolCards.push(...cards);
              continue;
            }
          }
          // write: +N righe (pi non salva il diff → lo calcola dagli args)
          if (b.name === "write") {
            renderWriteLines(card, writeLinesFromArgs(argsJson));
          }
          toolCards.push(card);
        }
      }
      const text = textParts.join("\n").trim();
      if (!text && thinkingCards.length === 0 && toolCards.length === 0) continue;
      const wrapper = addMsg("assistant");
      // aggregazione 3px valutata alla creazione: il messaggio inizia con
      // pensiero/tool (pensiero presente, o solo tool senza testo) e il
      // precedente finisce con pensiero/tool
      const startsThinkTool =
        thinkingCards.length > 0 || (text === "" && toolCards.length > 0);
      const prevMsg = wrapper.previousElementSibling;
      if (
        startsThinkTool &&
        prevMsg?.classList.contains("msg") &&
        msgEndsWithThinkTool(prevMsg as Element)
      ) {
        wrapper.classList.add("tool-chain");
        wrapper.style.marginTop = "-11px";
      }
      // ordine come in live: pensiero → testo → card dei tool
      for (const c of thinkingCards) wrapper.appendChild(c);
      if (text) {
        const md = document.createElement("div");
        md.className = "md";
        md.innerHTML = renderMarkdown(text);
        enhanceCodeBlocks(md);
        wrapper.appendChild(md);
      }
      for (const c of toolCards) wrapper.appendChild(c);
    } else if (msg.role === "toolResult" || msg.role === "bashExecution") {
      const output =
        msg.role === "bashExecution"
          ? String(msg.output ?? msg.command ?? "")
          : contentToText(msg.content);
      const tcId = (msg as { toolCallId?: string }).toolCallId;
      const card = tcId ? toolCardsById.get(tcId) : undefined;
      if (card && tcId) {
        const start = toolStartTimes.get(tcId);
        const ts = parseTs(msg);
        // ask_user: distribuisci il risultato per domanda (header → risposta,
        // segmento nel corpo) e timer su TUTTE le card — stato finale al resume
        if (distributeAskUserResult(tcId, output)) {
          if (start !== undefined && ts > 0 && ts >= start) {
            forEachToolCard(tcId, (c) => {
              const timerEl = c.querySelector<HTMLElement>(".tool-timer");
              if (timerEl) timerEl.textContent = fmtToolTime(ts - start);
            });
          }
          scrollToBottom();
        } else {
          // risultato DENTRO la card del tool (come nel runtime)
          const pre = ensureToolOutput(card, tcId);
          pre.textContent = output;
          // diff badge (edit): il diff è nei details a livello message
          const det = (msg as { details?: { diff?: string } }).details;
          const diff = det?.diff;
          if (diff) renderToolDiff(card, diff);
          // durata reale del tool: timestamp toolResult − timestamp assistant
          if (start !== undefined && ts > 0 && ts >= start) {
            const timerEl = card.querySelector<HTMLElement>(".tool-timer");
            if (timerEl) timerEl.textContent = fmtToolTime(ts - start);
          }
          scrollToBottom();
        }
      } else {
        // nessun match (es. sessioni vecchie): card risultato separata
        const wrapper = addMsg("assistant");
        wrapper.appendChild(buildResultCard(msg.toolName ?? "bash", output));
      }
    }
    if (ts > 0) lastTs = ts; // base per la durata del pensiero successivo
  }
  const main = els.messages;
  main.scrollTop = main.scrollHeight;
}

// --- pulsante "torna in fondo" ------------------------------------------------

// oltre questo margine dal fondo compare il pulsante per tornare giù
const SCROLL_BTN_MARGIN = 220;

els.scrollBottom.innerHTML = scrollDownIcon();
els.newChat.innerHTML = newChatIcon();
els.settingsBtn.innerHTML = settingsIcon();
els.scrollBottom.title = t("scrollToBottom");
els.scrollBottom.addEventListener("click", () => {
  els.messages.scrollTo({ top: els.messages.scrollHeight, behavior: "smooth" });
});
els.messages.addEventListener(
  "scroll",
  () => {
    const dist =
      els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight;
    stickToBottom = dist < SCROLL_RESUME_MARGIN;
    els.scrollBottom.hidden = dist < SCROLL_BTN_MARGIN;
  },
  { passive: true },
);
// immagini caricate in ritardo (markdown) crescono il contenuto dopo lo
// scroll: se l'utente sta seguendo, riallinea al load
els.thread.addEventListener(
  "load",
  (e) => {
    if (e.target instanceof HTMLImageElement && stickToBottom) {
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  },
  true,
);

// finestra più stretta → ellipsis CSS nativo sul badge (nessun JS)

// click su gauger/label del contesto: se una compattazione È in corso chiede
// se fermarla, altrimenti la conferma normale. NB: fermare la compact non è
// possibile via RPC oggi (abortCompaction è solo in-process nel TUI) — alla
// conferma si mostra l'esito onesto con riferimento alla gap pi-core.
els.statsCtx.addEventListener("click", () => {
  if (compacting) {
    void showConfirm(t("compactStopAsk")).then((ok) => {
      if (ok) {
        // niente RPC per abortire la compact: blocco informativo (pattern
        // comandi non implementati) finché il core non espone abort_compaction
        const link = PI_CORE_ISSUE_URL ? `\n${PI_CORE_ISSUE_URL}` : "";
        addStatusLine(`${t("compactStopUnavailable")}${link}`);
      }
    });
    return;
  }
  const msg = working ? t("compactAskWorking") : t("compactAsk");
  void showConfirm(msg).then((ok) => {
    if (ok) startCompactionFromUi();
  });
});

// --- compattazione sessione ---------------------------------------------------
// Alla conferma: gauger in loading (rotazione), composer bloccata (working,
// come durante l'attesa di una risposta) e in chat un blocco di stato con
// spinner + secondi che scorrono. A fine compattazione il blocco resta con
// “Compattato” e i secondi passati (stesso pattern del sent-loader).

let compacting = false;
let compactWrapper: HTMLElement | null = null;
let compactTimerEl: HTMLElement | null = null;
let compactStartedAt = 0;
let compactClock: ReturnType<typeof setInterval> | null = null;

function showCompactionBlock(): void {
  if (compacting) return;
  compacting = true;
  working = true; // guardia composer: niente invii durante la compattazione
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
  els.statsCtx.classList.add("loading");
  const wrapper = addMsg("status");
  wrapper.className = "msg status compact-msg";
  compactWrapper = wrapper;
  const card = document.createElement("div");
  card.className = "thinking-card";
  const head = document.createElement("div");
  head.className = "thinking-head";
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = t("compacting");
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  compactTimerEl = document.createElement("span");
  compactTimerEl.className = "thinking-timer";
  compactTimerEl.textContent = "0s";
  head.append(label, spinner, compactTimerEl);
  card.appendChild(head);
  wrapper.appendChild(card);
  compactStartedAt = performance.now();
  compactClock = setInterval(() => {
    if (compactTimerEl) {
      compactTimerEl.textContent = `${Math.round((performance.now() - compactStartedAt) / 1000)}s`;
    }
  }, 500);
  scrollToBottom();
}

function finishCompaction(error: boolean, errMsg?: string): void {
  if (!compacting) return;
  compacting = false;
  if (compactClock) {
    clearInterval(compactClock);
    compactClock = null;
  }
  if (compactWrapper) {
    const label = compactWrapper.querySelector(".thinking-label");
    const spinner = compactWrapper.querySelector(".spinner");
    if (spinner) spinner.remove(); // resta solo testo + secondi passati
    if (label) {
      label.textContent = error ? t("compactionError") : t("compacted");
      label.classList.toggle("error", error);
      if (errMsg) (label as HTMLElement).title = errMsg; // dettaglio tecnico al passaggio del mouse
    }
  }
  compactWrapper = null;
  compactTimerEl = null;
  // SEMPRE ripristino: la compact abortisce il turno in corso, quindi lo stato
  // lavorativo del client potrebbe essere rimasto sporco (niente agent_settled)
  working = false;
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
  els.statsCtx.classList.remove("loading");
  void fetchSessionStats(); // il gauger si aggiorna (azzerato dopo compact)
}

// dal click sul gauger/label: mostra il blocco e invia la RPC compact
// NOTA: nessun timeout (la compact può impiegare decine di secondi);
// l'esito arriva dall'evento compaction_end (esito reale) o dalla response
function startCompactionFromUi(): void {
  if (compacting) return;
  // se c'è un turno in corso, pi lo interromperà (compact fa abort): prima si
  // riportano gli stearing nell'editor (dequeue), poi si compatta
  if (working) dequeueSteering();
  showCompactionBlock();
  rpcRequest(rpc.compact(), undefined, 0).then(
    (res) => {
      const failed = (res as { success?: boolean; error?: string }).success === false;
      finishCompaction(failed, (res as { error?: string }).error);
    },
    (err: unknown) =>
      finishCompaction(true, err instanceof Error ? err.message : String(err)),
  );
}

// --- azioni utente -----------------------------------------------------------

// --- pulsante invio/stop e info box (modello, credito, trust) -----------------

let working = false;
// riavvio VOLUTO di pi in corso (Applica CLI flags): la send resta disabilitata
let piRestarting = false;
// webview in un pannello editor (non sidebar): il blocco selezione è inibito
let panelMode = false;
let modelInfoText = "";
let creditText = ""; // pi non espone il credito rimanente: resta vuoto finché disponibile
let creditBalance = 0; // saldo numerico (per la soglia di colore della chip)
let creditCurrency = "$"; // simbolo valuta del provider (per il costo sessione)
let sessionCost = 0; // costo totale sessione da get_session_stats (core di pi)

// --- stearing (piano 0004) ---------------------------------------------------
// Coda OMBRA nella webview (modificabile via dequeue, persistita solo il
// testo) + consegna via coda nativa di pi (semantica pi.dev): durante lo
// streaming si invia prompt(streamingBehavior:"steer") al punto di consegna
// (turn_end), da idle un prompt normale (agent_settled).
interface QueuedMessage {
  id: string;
  text: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
}
let steerShadow: QueuedMessage[] = []; // da consegnare (dequeue lo riporta nell'editor)
let steerPending: QueuedMessage[] = []; // inviato a pi, in attesa di iniezione
let steerSeq = 0;
let steeringMode: "one-at-a-time" | "all" = "one-at-a-time";
let thinkingLevel = "";
let currentModel: { provider?: string; name?: string; id?: string } | null = null;

function updateSendButton(): void {
  // il pulsante è SEMPRE Invia (mai più STOP): durante l'elaborazione assume
  // un'evidenza diversa (classe .working) e Invio accoda (stearing); lo STOP
  // sta nel blocco pensiero (piano 0004). Durante il riavvio di pi (Applica
  // CLI flags) è disabilitato.
  els.send.innerHTML = sendIcon();
  els.send.title = working ? t("steerSendHint") : t("send");
  els.send.classList.toggle("working", working);
  els.send.disabled = piRestarting;
}

function renderModelInfo(): void {
  // ordine: provider PRIMA del modello. A larghezze strette (container
  // query) spariscono provider e poi il nome; i separatori " · " sono CSS
  // (.model-name::before) così non restano punti orfani.
  // Il balance NON è più qui: vive nella chip separata #balance-chip.
  const provider = currentModel?.provider ?? "";
  const name = currentModel?.name ?? currentModel?.id ?? "";
  els.modelInfo.textContent = "";
  if (provider) {
    const p = document.createElement("span");
    p.className = "model-provider";
    p.textContent = provider;
    els.modelInfo.appendChild(p);
  }
  if (name) {
    const n = document.createElement("span");
    n.className = "model-name";
    n.textContent = name;
    els.modelInfo.appendChild(n);
  }
  els.modelInfo.title = [provider, name].filter(Boolean).join(" · ");
  renderBalanceChip();
}

// soglie del balance (come la convenzione di pi.dev): verde quando normale,
// giallo quando basso, rosso quando quasi esaurito. Colori del tema (--ok/
// --warn/--err), mai hard-coded.
function balanceTone(balance: number): "ok" | "warn" | "low" {
  if (balance >= 5) return "ok"; // normale → verde
  if (balance >= 1) return "warn"; // basso → giallo
  return "low"; // quasi esaurito → rosso
}

function renderBalanceChip(): void {
  const chip = els.balanceChip;
  chip.textContent = "";
  if (!creditText) {
    chip.hidden = true;
    chip.title = "";
    chip.className = "balance-chip";
    return;
  }
  chip.hidden = false;
  // costo sessione / saldo: il COLORE sta SOLO sul balance, costo e slash
  // restano col colore muto (e spariscono insieme sotto i 600px)
  if (sessionCost > 0) {
    const cost = document.createElement("span");
    cost.className = "chip-cost";
    cost.textContent = `${creditCurrency}${sessionCost.toFixed(2)}`;
    const slash = document.createElement("span");
    slash.className = "chip-slash";
    slash.textContent = "/";
    chip.append(cost, slash);
  }
  const bal = document.createElement("span");
  bal.className = "chip-balance";
  bal.textContent = creditText;
  chip.appendChild(bal);
  chip.title = t("balanceTitle");
  chip.className = `balance-chip tone-${balanceTone(creditBalance)}`;
}

// saldo numerico separato dal testo formattato (per la soglia di colore)

// colore dell'icona thinking in base al livello: scala lineare di tinta
// verde (off) → giallo (medio) → rosso (massimo), con le tonalità intermedie
function thinkingColor(level: string): string {
  const order = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const idx = order.indexOf(level);
  if (idx < 0) return "";
  const t = idx / (order.length - 1); // 0..1
  const hue = Math.round(140 - t * 140); // 140 = verde, 70 = giallo, 0 = rosso
  return `hsl(${hue} 65% 58%)`;
}

function renderThinkingInfo(): void {
  // icona pensiero (chat) sempre visibile, colorata per livello; label
  // nascosta <600, valore nascosto <340 (container query)
  els.thinkingInfo.textContent = "";
  const icon = document.createElement("span");
  icon.className = "thinking-icon";
  icon.innerHTML = chatIcon();
  const color = thinkingColor(thinkingLevel);
  if (color) icon.style.color = color;
  els.thinkingInfo.appendChild(icon);
  if (thinkingLevel) {
    const label = document.createElement("span");
    label.className = "thinking-label";
    label.textContent = `${t("thinkingLevel")}:`;
    const value = document.createElement("span");
    value.className = "thinking-value";
    value.textContent = translateThinkingLevel(thinkingLevel);
    // il valore ha lo stesso colore dell'icona (come il trust)
    if (color) value.style.color = color;
    els.thinkingInfo.append(label, value);
    els.thinkingInfo.title = `${t("thinkingLevel")}: ${translateThinkingLevel(thinkingLevel)}`;
  }
}

// traduzione dei livelli di thinking di pi (stringhe del modello)
function translateThinkingLevel(level: string): string {
  const key =
    level === "off"
      ? "levelOff"
      : level === "minimal"
        ? "levelMinimal"
        : level === "low"
          ? "levelLow"
          : level === "medium"
            ? "levelMedium"
            : level === "high"
              ? "levelHigh"
              : level === "xhigh"
                ? "levelXHigh"
                : level === "max"
                  ? "levelMax"
                  : null;
  return key ? t(key) : level;
}

function renderTrust(res: { status?: string } | null): void {
  const status = res?.status ?? "ask";
  const key =
    status === "trusted" ? "trusted" : status === "untrusted" ? "untrusted" : "trustAsk";
  // icone Material: scudo (chiedi) · triangolo alert vuoto (limitato) · pieno (full)
  const kind: TrustIconKind =
    status === "trusted"
      ? "warn-filled"
      : status === "untrusted"
        ? "warn-outline"
        : "shield";
  els.trustIcon.innerHTML = trustIcon(kind);
  els.trustLabel.textContent = t(key);
  els.trust.title = t(key);
  els.trust.dataset.status = status;
}

// --- popover per le chip della toolbar (modello, pensiero, trust) -------------

function closePopover(): void {
  document.querySelector(".pop-menu")?.remove();
  popoverAnchor = null;
  detachPopover?.();
  detachPopover = null;
}

let popoverAnchor: HTMLElement | null = null;
let detachPopover: (() => void) | null = null;

function popItem(
  menu: HTMLElement,
  label: string,
  meta: string,
  active: boolean,
  onClick: () => void,
  icon = "",
  tone = "",
  color = "",
): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pop-item";
  btn.classList.toggle("active", active);
  if (tone) btn.dataset.tone = tone;
  // colore del testo per la riga (es. livelli thinking)
  if (color) btn.style.color = color;
  if (icon) {
    const ic = document.createElement("span");
    ic.className = "pop-item-icon";
    ic.innerHTML = icon;
    btn.appendChild(ic);
  }
  const lbl = document.createElement("span");
  lbl.className = "pop-item-label";
  lbl.textContent = label;
  const m = document.createElement("span");
  m.className = "pop-item-meta";
  // con tone (trust): segno "✓" sulla voce attiva
  m.textContent = tone ? (active ? "✓" : "") : meta;
  btn.append(lbl, m);
  btn.addEventListener("click", (e) => {
    // il menu vive dentro il pulsante-anchor: senza stop il click risalirebbe
    // fino al bottone, che riaprirebbe il popover subito dopo la chiusura
    e.stopPropagation();
    closePopover();
    onClick();
  });
  menu.appendChild(btn);
}

function openPopover(anchor: HTMLElement, build: (menu: HTMLElement) => void): void {
  // toggle: riclick sullo stesso pulsante chiude
  if (popoverAnchor === anchor) {
    closePopover();
    return;
  }
  closePopover();
  const menu = document.createElement("div");
  menu.className = "pop-menu";
  build(menu);
  anchor.appendChild(menu);
  popoverAnchor = anchor;

  // Il menu è assoluto dentro la chip: con `left: 0` una chip vicina al bordo
  // destro spingerebbe il menu fuori dal viewport (barra di scorrimento del
  // body). Qui misuriamo e teniamo SEMPRE il popover dentro lo schermo,
  // spostandolo/ridimensionandolo; il riclamp segue anche i resize.
  const VIEWPORT_MARGIN = 8;
  const OPEN_GAP = 6; // uguale al calc(100% + 6px) del CSS
  const clampPopover = (): void => {
    const aRect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // --- orizzontale: dentro il viewport, preferibilmente allineato all'anchor ---
    let w = menu.offsetWidth;
    const maxW = Math.max(160, vw - 2 * VIEWPORT_MARGIN);
    if (w > maxW) {
      menu.style.maxWidth = `${maxW}px`;
      w = menu.offsetWidth;
    }
    const leftV = Math.max(
      VIEWPORT_MARGIN,
      Math.min(aRect.left, vw - VIEWPORT_MARGIN - w),
    );
    menu.style.left = `${leftV - aRect.left}px`;
    // --- verticale: preferisce aprire verso l'alto, altrimenti sotto ---
    const h = menu.offsetHeight;
    const spaceAbove = aRect.top - VIEWPORT_MARGIN - OPEN_GAP;
    const spaceBelow = vh - aRect.bottom - VIEWPORT_MARGIN - OPEN_GAP;
    const fitAbove = h <= spaceAbove;
    const fitBelow = h <= spaceBelow;
    const useAbove = fitAbove || (!fitBelow && spaceAbove >= spaceBelow);
    const openAbove = getComputedStyle(menu).bottom !== "auto";
    if (useAbove) {
      if (!openAbove) {
        menu.style.bottom = "calc(100% + 6px)";
        menu.style.top = "auto";
      }
      menu.style.maxHeight = fitAbove ? "" : `${Math.max(60, spaceAbove)}px`;
    } else {
      if (openAbove) {
        menu.style.bottom = "auto";
        menu.style.top = "calc(100% + 6px)";
      }
      menu.style.maxHeight = fitBelow ? "" : `${Math.max(60, spaceBelow)}px`;
    }
  };

  clampPopover();
  const onDoc = (e: Event) => {
    if (menu.contains(e.target as Node)) return;
    closePopover();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === "Escape") closePopover();
  };
  const onResize = () => clampPopover();
  detachPopover = () => {
    document.removeEventListener("click", onDoc);
    document.removeEventListener("keydown", onEsc);
    window.removeEventListener("resize", onResize);
  };
  setTimeout(() => document.addEventListener("click", onDoc), 0);
  document.addEventListener("keydown", onEsc);
  window.addEventListener("resize", onResize);
}

async function openModelPopover(): Promise<void> {
  const res = await rpcRequest(rpc.getAvailableModels()).catch(() => null);
  const models =
    (
      res?.data as
        | {
            models?: Array<{
              id: string;
              name?: string;
              provider?: string;
              input?: string[];
            }>;
          }
        | undefined
    )?.models ?? [];
  openPopover(els.btnModel, (menu) => {
    // ricerca: campo in cima, la lista si aggiorna appena si scrive almeno
    // una lettera (filtro su nome, id e provider, case-insensitive)
    const search = document.createElement("input");
    search.type = "text";
    search.className = "pop-search";
    search.placeholder = t("searchModels");
    search.spellcheck = false;
    const list = document.createElement("div");
    list.className = "pop-list";
    menu.append(search, list);

    const render = (query: string): void => {
      list.textContent = "";
      const q = query.trim().toLowerCase();
      const filtered = q
        ? models.filter(
            (m) =>
              (m.name ?? "").toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q) ||
              (m.provider ?? "").toLowerCase().includes(q),
          )
        : models;
      for (const m of filtered) {
        popItem(list, m.name ?? m.id, m.provider ?? "", currentModel?.id === m.id, () => {
          void rpcRequest(rpc.setModel(m.provider ?? "", m.id)).then((r) => {
            if (r.success) {
              currentModel = m;
              modelSupportsVision = Array.isArray(m.input) && m.input.includes("image");
              modelInfoText = [m.provider, m.name ?? m.id].filter(Boolean).join(" · ");
              renderModelInfo();
              renderAttachments(); // i chip aggiornano thumbnail ↔ icona file
              void fetchSessionStats(); // context window del nuovo modello
              void fetchBalance(); // saldo del nuovo provider
            }
          });
        });
      }
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pop-empty";
        empty.textContent = "—";
        list.appendChild(empty);
      }
    };

    search.addEventListener("input", () => render(search.value));
    // il menu vive DENTRO il bottone: senza questi accorgimenti un click sul
    // campo chiuderebbe il popover (toggle del pulsante) e il bottone
    // ruberebbe il focus all'input (mousedown default)
    search.addEventListener("mousedown", (e) => e.preventDefault());
    search.addEventListener("click", (e) => {
      e.stopPropagation();
      search.focus();
    });
    render("");
  });
  // focus immediato sul campo di ricerca (se il popover si è aperto)
  els.btnModel.querySelector<HTMLInputElement>(".pop-search")?.focus();
}

async function openThinkingPopover(): Promise<void> {
  const res = await rpcRequest(rpc.getAvailableThinkingLevels()).catch(() => null);
  const levels = (res?.data as { levels?: string[] } | undefined)?.levels ?? [];
  openPopover(els.btnThinking, (menu) => {
    for (const lvl of levels) {
      popItem(
        menu,
        translateThinkingLevel(lvl),
        "",
        lvl === thinkingLevel,
        () => {
          void rpcRequest(rpc.setThinkingLevel(lvl)).then((r) => {
            if (r.success) {
              thinkingLevel = lvl;
              renderThinkingInfo();
            }
          });
        },
        chatIcon(),
        "",
        thinkingColor(lvl), // colore del livello nella dropdown
      );
    }
  });
}

function openTrustPopover(): void {
  const current = (els.trust.dataset.status ?? "ask") as "trusted" | "untrusted" | "ask";
  const opts: Array<{
    status: "trusted" | "untrusted" | "ask";
    key: string;
    icon: string;
  }> = [
    { status: "trusted", key: "trusted", icon: trustIcon("warn-filled") },
    { status: "untrusted", key: "untrusted", icon: trustIcon("warn-outline") },
    { status: "ask", key: "trustAsk", icon: trustIcon("shield") },
  ];
  const applyTrust = (status: "trusted" | "untrusted" | "ask") => {
    void ideRequest({ type: "setTrust", status }).then((r) => {
      if (r?.ok) renderTrust(r.data as { status?: string } | null);
    });
  };
  openPopover(els.trust, (menu) => {
    for (const o of opts) {
      popItem(
        menu,
        t(o.key),
        "",
        o.status === current,
        () => {
          // l'accesso completo è pericoloso: modale di conferma (non window.confirm)
          if (o.status === "trusted") {
            void showConfirm(t("trustFullConfirm")).then((ok) => {
              if (ok) applyTrust(o.status);
            });
            return;
          }
          applyTrust(o.status);
        },
        o.icon,
        o.status,
      );
    }
  });
}

// --- modale di conferma (stesso comportamento in browser e webview VS Code) ----

// lightbox: immagine allegata ingrandita (click fuori o ESC per chiudere)
function openImageLightbox(src: string, name: string): void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const img = document.createElement("img");
  img.className = "lightbox-img";
  img.src = src;
  img.alt = name;
  backdrop.appendChild(img);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", esc);
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", esc);
  document.body.appendChild(backdrop);
}

function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const icon = document.createElement("div");
    icon.className = "modal-icon";
    icon.innerHTML = trustIcon("warn-filled");
    const msg = document.createElement("div");
    msg.className = "modal-message";
    msg.textContent = message;
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = t("cancel");
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn danger";
    ok.textContent = t("confirm");
    actions.append(cancel, ok);
    card.append(icon, msg, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const close = (value: boolean) => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(value);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", esc);
    ok.focus();
  });
}

els.btnModel.addEventListener("click", (e) => {
  e.stopPropagation();
  void openModelPopover();
});
els.btnThinking.addEventListener("click", (e) => {
  e.stopPropagation();
  void openThinkingPopover();
});
els.trust.addEventListener("click", (e) => {
  e.stopPropagation();
  openTrustPopover();
});

function sendOrStop(): void {
  if (!transport) return;
  // elaborazione (o compattazione) in corso → STEARING: il messaggio entra
  // nella coda locale (dequeue lo riporta nell'editor), mai abort automatico
  if (working || compacting) {
    submitSteering();
    return;
  }
  const text = els.input.value.trim();
  if (!text && attachments.length === 0) return;
  if (text) pushMessageHistory(text);
  const wrapper = addMsg("user");
  // allegati PRIMA del testo: immagini in griglia (click → lightbox), poi file
  const imageAtts = modelSupportsVision
    ? attachments.filter((a) => a.mimeType.startsWith("image/") && a.dataBase64)
    : [];
  const fileAtts = attachments.filter((a) => !imageAtts.includes(a));
  if (imageAtts.length > 0) {
    const grid = document.createElement("div");
    grid.className = "chat-image-grid";
    // una sola immagine: cella più grande, senza crop aggressivo
    if (imageAtts.length === 1) grid.classList.add("single");
    for (const a of imageAtts) {
      const img = document.createElement("img");
      img.className = "chat-image";
      img.src = `data:${a.mimeType};base64,${a.dataBase64}`;
      img.alt = a.name;
      img.title = a.name;
      img.addEventListener("click", () => openImageLightbox(img.src, a.name));
      grid.appendChild(img);
    }
    wrapper.appendChild(grid);
  }
  for (const a of fileAtts) {
    const chip = document.createElement("div");
    chip.className = "chat-file";
    const icon = document.createElement("span");
    icon.className = "chat-file-icon";
    icon.innerHTML = attachFileIcon();
    const name = document.createElement("span");
    name.className = "chat-file-name";
    name.textContent = a.name;
    name.title = a.path;
    chip.append(icon, name);
    wrapper.appendChild(chip);
  }
  // immagini inline solo se il modello è vision; altrimenti (e per i file) il path
  const inlineImages = imageAtts.map((a) => ({
    type: "image" as const,
    data: a.dataBase64!,
    mimeType: a.mimeType,
  }));
  const fileMentions = fileAtts.map((a) => `[attachment: ${a.path}]`);
  // il testo va DOPO gli allegati
  if (text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble user";
    bubble.textContent = text;
    wrapper.appendChild(bubble);
  }
  const message = [text, ...fileMentions].filter(Boolean).join("\n\n");
  transport.send({
    channel: "rpc",
    payload: rpc.prompt(
      message,
      inlineImages.length > 0 ? { images: inlineImages } : undefined,
    ),
  });
  // loader di invio: rotella + timer finché non arriva la prima risposta
  showSentLoader(wrapper);
  // comando slash inviato: dopo che la bolla utente è in chat, segnala che
  // i comandi estensione richiedono una modifica del core di pi.dev
  if (message.trim().startsWith("/")) notifyCmdNotImplemented();
  // a invio completato (bolla + allegati + badge) si va SEMPRE in fondo: il
  // vecchio scroll forzato prima della bolla non bastava — il contenuto
  // aggiunto dopo lo lasciava sopra, e il follow "smart" poi credeva
  // che l'utente avesse scrollato (dist > margine) e non si muoveva più
  scrollToBottom(true);
  armExtensionsBlock(); // blocco "Extensions" se il primo output tarda > 3s
  els.input.value = "";
  resetInputHeight();
  clearAttachments();
  els.input.focus();
}

// --- stearing: coda locale + pannello (piano 0004) ---------------------------

// Invio durante elaborazione/compattazione: accoda nella coda ombra.
// Le immagini viaggiano in memoria (solo testo persistito); i file restano
// come menzione [attachment: path] nel testo.
function submitSteering(): void {
  const text = els.input.value.trim();
  const imageAtts = attachments.filter(
    (a) => a.mimeType.startsWith("image/") && a.dataBase64,
  );
  const fileAtts = attachments.filter((a) => !imageAtts.includes(a));
  const message = [text, ...fileAtts.map((a) => `[attachment: ${a.path}]`)]
    .filter(Boolean)
    .join("\n\n");
  if (!message && imageAtts.length === 0) return;
  steerShadow.push({
    id: `st-${++steerSeq}`,
    text: message,
    images: imageAtts.map((a) => ({
      type: "image" as const,
      data: a.dataBase64!,
      mimeType: a.mimeType,
    })),
  });
  persistSteerQueue();
  renderSteerPanel();
  updateSteerPlaceholder();
  els.input.value = "";
  resetInputHeight();
  clearAttachments();
  els.input.focus();
}

function persistSteerQueue(): void {
  // solo il testo sopravvive al reload (le immagini no: troppo pesanti)
  void ideRequest({
    type: "storeSteerQueue",
    items: steerShadow.map((m) => ({ text: m.text })),
  });
}

async function loadSteerQueue(): Promise<void> {
  const res = await ideRequest({ type: "getSteerQueue" });
  const items = res?.ok
    ? (res.data as { items?: Array<{ text: string }> } | undefined)?.items
    : undefined;
  if (items && items.length > 0) {
    steerShadow = items.map((i) => ({ id: `st-${++steerSeq}`, text: i.text }));
    renderSteerPanel();
  }
}

// placeholder della textarea: segnala che Invio accoda durante l'elaborazione
function updateSteerPlaceholder(): void {
  if (working || compacting) {
    els.input.placeholder = t("steerPlaceholder");
    return;
  }
  els.input.placeholder =
    messageHistory.length > 0
      ? `${t("messagePlaceholder")} · ${t("historyHint")}`
      : t("messagePlaceholder");
}

// pannello tra thread e composer: mostra i messaggi ANCORA da inviare (coda
// ombra, stile normale) e quelli GIÀ consegnati a pi ma non ancora iniettati
// (steerPending: stile muted + spinner, NON più dequeuabili — la coda di pi
// non è mutabile via RPC). Appena pi li processa (message_start) spariscono.
function renderSteerPanel(): void {
  const panel = els.steerPanel;
  const wasHidden = panel.hidden;
  panel.textContent = "";
  const total = steerShadow.length + steerPending.length;
  if (total === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  // il pannello prende spazio tra chat e composer: porta la chat in fondo
  // così l'ultimo messaggio NON resta nascosto sotto il pannello
  if (wasHidden) scrollToBottom(true);
  // header: titolo con conteggio + dequeue
  const head = document.createElement("div");
  head.className = "steer-head";
  const title = document.createElement("span");
  title.className = "steer-title";
  title.textContent = tpl(t("steerQueueCount"), {
    n: String(total),
  });
  head.appendChild(title);
  const dequeue = document.createElement("button");
  dequeue.type = "button";
  dequeue.className = "steer-dequeue";
  dequeue.textContent = t("steerDequeue");
  // solo i messaggi NON ancora inviati tornano nell'editor: gli in-invio
  // sono già nelle mani di pi e non possono essere recuperati
  dequeue.title = t("steerDequeueHint");
  dequeue.disabled = steerShadow.length === 0;
  dequeue.addEventListener("click", () => dequeueSteering());
  head.appendChild(dequeue);
  panel.appendChild(head);
  // ORDINE DI INSERIMENTO PRESERVATO: coda ombra e in-invio uniti per sequenza
  // (id st-N) — msg1 (in invio) resta al suo posto, msg2, msg3 sotto
  const seqOf = (m: QueuedMessage): number => {
    const n = /^st-(\d+)$/.exec(m.id);
    return n ? Number(n[1]) : 0;
  };
  const merged = [...steerShadow, ...steerPending].sort(
    (a, b) => seqOf(a) - seqOf(b),
  );
  for (const m of merged) {
    appendSteerRow(panel, m.text, steerPending.includes(m));
  }
}

function appendSteerRow(panel: HTMLElement, text: string, sending: boolean): void {
  const row = document.createElement("div");
  row.className = sending ? "steer-row steer-row-sending" : "steer-row";
  if (sending) {
    const icon = document.createElement("span");
    icon.className = "steer-sending-icon";
    row.appendChild(icon);
  }
  const tspan = document.createElement("span");
  tspan.className = "steer-text";
  tspan.textContent = text;
  tspan.title = text;
  row.appendChild(tspan);
  panel.appendChild(row);
}

// dequeue (parità Alt+↑ di pi.dev): riporta TUTTI i messaggi da inviare
// nell'editor (uniti), svuota la coda ombra. Gli item già inviati a pi no.
function dequeueSteering(): void {
  if (steerShadow.length === 0) return;
  const texts = steerShadow.map((m) => m.text).join("\n\n");
  steerShadow = [];
  persistSteerQueue();
  const current = els.input.value;
  els.input.value = current.trim() ? `${texts}\n\n${current}` : texts;
  autogrowInput();
  renderSteerPanel();
  els.input.focus();
}

// consegna al punto di pi.dev: streaming → prompt con streamingBehavior "steer"
// (pi inietta dopo i tool call del turno, prima della prossima LLM call);
// idle (agent_settled) → prompt normale. Modalità: one-at-a-time / all.
function deliverSteering(): void {
  if (steerShadow.length === 0) return;
  if (compacting) return; // durante la compattazione niente consegna: ci pensa compaction_end
  const n = steeringMode === "all" ? steerShadow.length : 1;
  const toSend = steerShadow.splice(0, n);
  persistSteerQueue();
  const behavior = working ? ("steer" as const) : undefined;
  for (const m of toSend) {
    steerPending.push(m);
    renderSteerPanel();
    const opts: {
      images?: Array<{ type: "image"; data: string; mimeType: string }>;
      streamingBehavior?: "steer";
    } = {};
    if (m.images && m.images.length > 0) opts.images = m.images;
    if (behavior) opts.streamingBehavior = behavior;
    void rpcRequest(rpc.prompt(m.text, opts), `st-${++steerSeq}`, 0)
      .then(() => {
        // ok: resta in steerPending finché message_start/queue_update lo toglie
      })
      .catch(() => {
        // errore di preflight: torna in coda (se non è già stato iniettato)
        const i = steerPending.indexOf(m);
        if (i >= 0) steerPending.splice(i, 1);
        if (!steerPending.includes(m)) {
          steerShadow.unshift(m);
          persistSteerQueue();
        }
        renderSteerPanel();
        addStatusLine(t("steerSendFailed"));
      });
  }
}

// riconciliazione con la coda nativa di pi: NON più mostrata — quando un
// messaggio viene consegnato sparisce subito dalla box. Resta solo la pulizia
// interna (message_start rimuove l'item consegnato e mostra la bolla in chat).

// gli "in invio" rimasti fermi quando pi è idle: pi li ha accodati (steer
// arrivato dopo il check di continuation del turno) ma non parte MAI un turno
// per iniettarli (la coda steer di pi viene drenata solo all'inizio del turno
// successivo). Se pi ora non li ha più in coda (pendingMessageCount 0) sono
// persi/scartati → tornano nella coda ombra e vengono rilanciati come prompt
// NORMALI (idle → pi li processa subito, niente duplicati perché pi non li ha).
async function reconcileStuckPending(): Promise<void> {
  if (steerPending.length === 0) return;
  try {
    const res = await rpcRequest(rpc.getState(), "st-reconcile", 4000);
    if (!res.success) return;
    const data = res.data as
      | { pendingMessageCount?: number; isStreaming?: boolean }
      | undefined;
    if (!data) return;
    if (data.isStreaming === false && (data.pendingMessageCount ?? 0) === 0) {
      const lost = steerPending;
      steerPending = [];
      steerShadow.unshift(...lost);
      persistSteerQueue();
      renderSteerPanel();
      deliverSteering(); // idle → prompt normali → processati subito
    }
  } catch {
    // timeout / errore: lascia stare, la prossima occasione riprova
  }
}

// messaggio utente iniettato da pi (message_start ruolo user): se era un item
// in steerPending viene rimosso e mostrato in chat (non era ottimistico); se
// è il messaggio inviato normalmente è già reso → nessuna bolla extra.
function handleUserMessageStart(evt: RpcEvent): void {
  const content = (evt as { message?: { content?: unknown } }).message?.content;
  const text = extractTextContent(content);
  // pulisce da ENTRAMBE le code: l'item consegnato può trovarsi in
  // steerPending (in attesa di iniezione) o essere tornato in steerShadow
  const pIdx = steerPending.findIndex((m) => m.text === text);
  const sIdx = steerShadow.findIndex((m) => m.text === text);
  if (pIdx >= 0) steerPending.splice(pIdx, 1);
  if (sIdx >= 0) steerShadow.splice(sIdx, 1);
  if (pIdx < 0 && sIdx < 0) return;
  persistSteerQueue();
  renderSteerPanel();
  // bolla utente reale (lo stearing non era stato mostrato ottimisticamente)
  const wrapper = addMsg("user");
  const bubble = document.createElement("div");
  bubble.className = "bubble user";
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  scrollToBottom();
}

// --- aggregazione blocchi pensiero/tool (3px) -------------------------------
// Regole: 1) blocco pensiero e tools CONSECUTIVI → gap 3px; 2) dopo un
// pensiero/tool, se il successivo NON è pensiero/tool → gap 14px.
// Valutato appena il primo blocco del messaggio si materializza (mai
// retroattivo): nessun saltone.
function msgEndsWithThinkTool(msg: Element): boolean {
  const last = msg.lastElementChild;
  if (!last) return false;
  if (last.classList.contains("tool-card")) return true;
  // slot del pensiero come ultimo figlio: conta solo se contiene la card
  if (last.classList.contains("thinking-slot")) {
    return !!last.querySelector(".thinking-card");
  }
  return false;
}

function msgStartsWithThinkTool(msg: Element): boolean {
  const first = msg.firstElementChild;
  if (!first) return false;
  if (first.classList.contains("tool-card")) return true;
  if (first.classList.contains("thinking-slot")) {
    return !!first.querySelector(".thinking-card");
  }
  return false;
}

// applica il gap 3px (14 − 11) se il messaggio precedente finisce con
// pensiero/tool e il corrente inizia con pensiero/tool
function setToolChain(msg: Element): void {
  msg.classList.add("tool-chain");
  (msg as HTMLElement).style.marginTop = "-11px";
}

function applyToolChain(): void {
  if (!currentMsg) return;
  const prev = currentMsg.previousElementSibling;
  if (
    prev?.classList.contains("msg") &&
    msgEndsWithThinkTool(prev) &&
    msgStartsWithThinkTool(currentMsg)
  ) {
    setToolChain(currentMsg);
  }
}

// il messaggio inizia col tool solo se non c'è pensiero né testo prima.
// NB: il primo figlio è SEMPRE lo slot del pensiero (anche vuoto) → qui la
// chain va impostata DIRETTAMENTE, senza passare da msgStartsWithThinkTool.
function applyToolChainIfToolFirst(): void {
  if (!currentMsg) return;
  if (currentMsg.querySelector(".thinking-card")) return;
  if ((currentText?.textContent ?? "").trim().length > 0) return;
  const prev = currentMsg.previousElementSibling;
  if (prev?.classList.contains("msg") && msgEndsWithThinkTool(prev)) {
    setToolChain(currentMsg);
  }
}

// --- palette comandi slash (piano 0003): SOLO comandi estensione ------------
interface SlashCommand {
  name: string; // senza "/" iniziale
  description?: string;
}
let slashCommands: SlashCommand[] = [];
let cmdOpen = false;
let cmdSelected = 0;
let cmdMatches: SlashCommand[] = [];

// lista comandi estensione da get_commands (source "extension"), fetch a
// boot e lazy al primo "/" (la lista può cambiare con le estensioni)
async function fetchSlashCommands(): Promise<void> {
  try {
    const res = await rpcRequest(rpc.getCommands(), `cmds-${++cmdSeq}`, 8000);
    const cmds = (res.data as
      | { commands?: Array<{ name?: string; description?: string; source?: string }> }
      | undefined)?.commands;
    slashCommands = (cmds ?? [])
      .filter(
        (c) =>
          c.source === "extension" && typeof c.name === "string" && c.name.length > 0,
      )
      .map((c) => ({
        name: c.name!.replace(/^\/+/, ""),
        description: c.description ?? "",
      }));
  } catch {
    // pi non ancora pronto: resta vuota; il lazy fetch ritenta al prossimo "/"
  }
}
let cmdSeq = 0;

// chiude il dropdown (senza toccare il testo)
function closeCmdDropdown(): void {
  cmdOpen = false;
  els.cmdDropdown.hidden = true;
}

// filtraggio + render: il comando è il primo token (prima dello spazio); se
// l'utente sta già digitando argomenti (spazio) il comando è scelto → chiuso
function updateCmdDropdown(): void {
  const raw = els.input.value;
  if (!raw.startsWith("/")) {
    closeCmdDropdown();
    return;
  }
  const firstSpace = raw.indexOf(" ");
  if (firstSpace !== -1) {
    closeCmdDropdown(); // args in corso: l'estensione gestisce il resto
    return;
  }
  const q = raw.slice(1).toLowerCase();
  void (async () => {
    if (slashCommands.length === 0) await fetchSlashCommands();
    const matches = slashCommands.filter(
      (c) => !q || c.name.toLowerCase().includes(q),
    );
    cmdMatches = matches;
    cmdSelected = 0;
    if (matches.length === 0) {
      closeCmdDropdown();
      return;
    }
    cmdOpen = true;
    els.cmdDropdown.hidden = false;
    els.cmdList.textContent = "";
    for (const c of matches) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "cmd-item";
      item.dataset.name = c.name;
      const n = document.createElement("span");
      n.className = "cmd-item-name";
      n.textContent = `/${c.name}`;
      const d = document.createElement("span");
      d.className = "cmd-item-desc";
      d.textContent = c.description ?? "";
      item.append(n, d);
      item.addEventListener("click", () => acceptCmd(c.name));
      els.cmdList.appendChild(item);
    }
    renderCmdSelection();
  })();
}

function renderCmdSelection(): void {
  const items = els.cmdList.querySelectorAll<HTMLButtonElement>(".cmd-item");
  items.forEach((el, i) => {
    el.classList.toggle("selected", i === cmdSelected);
    if (i === cmdSelected) el.scrollIntoView({ block: "nearest" });
  });
  els.cmdCounter.textContent = `(${cmdSelected + 1}/${cmdMatches.length})`;
}

// link della issue pi-core (vuoto finché non apriamo la issue upstream):
// quando impostato, il blocco "non ancora implementato" lo mostra
const PI_CORE_ISSUE_URL = "";

// blocco informativo: il comando estensione richiede il supporto del core
// di pi.dev (ui.custom) non ancora disponibile — vedi docs/issues/pi-core
function notifyCmdNotImplemented(): void {
  const link = PI_CORE_ISSUE_URL ? `\n${PI_CORE_ISSUE_URL}` : "";
  addStatusLine(`${t("cmdNotImplemented")}${link}`);
}

// accetta il comando selezionato: riempie la composer con "/name " (spazio
// per gli eventuali sottocomandi) e chiude il dropdown — NIENTE invio.
// I comandi estensione richiedono il core di pi.dev (ui.custom): lo si
// segnala subito con un blocco informativo.
function acceptCmd(name: string): void {
  els.input.value = `/${name} `;
  const len = els.input.value.length;
  els.input.setSelectionRange(len, len);
  closeCmdDropdown();
  els.input.focus();
}

// palette esplorativa (Ctrl+K): modale con ricerca, Invio/click riempie la
// composer; Esc/click fuori chiude
function openCmdPalette(): void {
  void (async () => {
    if (slashCommands.length === 0) await fetchSlashCommands();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const msg = document.createElement("div");
    msg.className = "modal-message";
    msg.textContent = t("cmdPaletteTitle");
    const search = document.createElement("input");
    search.type = "text";
    search.className = "pop-search";
    search.placeholder = t("cmdSearchPlaceholder");
    const list = document.createElement("div");
    list.className = "modal-select";
    let sel = 0;
    const render = () => {
      const q = search.value.toLowerCase();
      const matches = slashCommands.filter(
        (c) => !q || c.name.toLowerCase().includes(q),
      );
      list.textContent = "";
      if (matches.length === 0) {
        const e = document.createElement("div");
        e.className = "pop-empty";
        e.textContent = t("noOptions");
        list.appendChild(e);
        return;
      }
      sel = Math.min(sel, matches.length - 1);
      matches.forEach((c, i) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "modal-option";
        const name = document.createElement("span");
        name.className = "cmd-item-name";
        name.textContent = `/${c.name}`;
        const desc = document.createElement("span");
        desc.className = "cmd-item-desc";
        desc.textContent = c.description ?? "";
        const inner = document.createElement("span");
        inner.style.display = "flex";
        inner.style.gap = "8px";
        inner.style.alignItems = "center";
        inner.append(name, desc);
        row.append(inner);
        row.addEventListener("click", () => close(`/${c.name}`));
        row.classList.toggle("selected", i === sel);
        list.appendChild(row);
      });
    };
    const close = (v?: string) => {
      backdrop.remove();
      document.removeEventListener("keydown", key, true);
      if (v) {
        els.input.value = v + " ";
        const len = els.input.value.length;
        els.input.setSelectionRange(len, len);
        els.input.focus();
      }
    };
    const key = (e: KeyboardEvent) => {
      const rows = list.querySelectorAll<HTMLButtonElement>(".modal-option");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rows.length) {
          sel = (sel + 1) % rows.length;
          rows.forEach((r, i) => r.classList.toggle("selected", i === sel));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rows.length) {
          sel = (sel - 1 + rows.length) % rows.length;
          rows.forEach((r, i) => r.classList.toggle("selected", i === sel));
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[sel];
        if (row) close(row.textContent ?? undefined);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    search.addEventListener("input", () => {
      sel = 0;
      render();
    });
    render();
    card.append(msg, search, list);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", key, true);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
    search.focus();
  })();
}

// --- allegati (paste di file e immagini reali) -------------------------------

interface PendingAttachment {
  path: string;
  name: string;
  mimeType: string;
  dataBase64?: string; // presente solo per le immagini (anteprima + invio inline)
}

let attachments: PendingAttachment[] = [];
let modelSupportsVision = false;

function addAttachment(att: PendingAttachment): void {
  attachments.push(att);
  renderAttachments();
}

function removeAttachment(index: number): void {
  attachments.splice(index, 1);
  renderAttachments();
}

function clearAttachments(): void {
  attachments = [];
  renderAttachments();
}

function renderAttachments(): void {
  els.attachmentRow.textContent = "";
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i]!;
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const thumb = document.createElement("span");
    thumb.className = "attachment-thumb";
    // thumbnail solo per modelli vision; altrimenti icona file (niente blob)
    if (modelSupportsVision && a.dataBase64 && a.mimeType.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = `data:${a.mimeType};base64,${a.dataBase64}`;
      img.alt = a.name;
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = attachFileIcon();
    }
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = a.name;
    name.title = a.path;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "attachment-remove";
    x.textContent = "×";
    x.title = t("remove");
    x.addEventListener("click", () => removeAttachment(i));
    chip.append(thumb, name, x);
    els.attachmentRow.appendChild(chip);
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("lettura file fallita"));
    reader.readAsDataURL(file);
  });
}

// --- compressione immagini (client-side) -------------------------------------

const MAX_IMAGE_EDGE = 1024; // px: lato massimo dopo il downscale
const MAX_IMAGE_BYTES = 150 * 1024; // sotto questa soglia non ricomprimiamo
const IMAGE_QUALITY = 0.8; // JPEG/WebP

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decodifica immagine fallita"));
    img.src = url;
  });
}

// Rileva il canale alpha campionando (step 8px) il canvas ridimensionato.
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const step = 8;
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * step) {
    if ((data[i] ?? 255) < 255) return true;
  }
  return false;
}

// Comprime le immagini incollate/trascinate PRIMA del salvataggio e dell'invio:
// downscale a max 1024px + JPEG q0.8 (PNG se c'è trasparenza). Il blob base64
// che pi salva in sessione scende da MB a ~50-150KB, così i re-invii di pi a
// ogni turno restano piccoli e veloci. GIF e immagini già piccole: invariate.
async function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
  const original = await fileToBase64(file);
  if (
    file.type !== "image/png" &&
    file.type !== "image/jpeg" &&
    file.type !== "image/webp"
  ) {
    return { base64: original, mimeType: file.type };
  }
  if (file.size <= MAX_IMAGE_BYTES) {
    return { base64: original, mimeType: file.type };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight),
    );
    if (scale >= 1) {
      return { base64: original, mimeType: file.type };
    }
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { base64: original, mimeType: file.type };
    }
    ctx.drawImage(img, 0, 0, w, h);
    const mimeType = hasTransparency(ctx, w, h) ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mimeType, IMAGE_QUALITY);
    const base64 = dataUrl.split(",")[1] ?? "";
    if (!base64) {
      return { base64: original, mimeType: file.type };
    }
    return { base64, mimeType };
  } catch {
    return { base64: original, mimeType: file.type };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function extForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return "";
  }
}

function renameForMime(name: string, mimeType: string): string {
  const ext = extForMime(mimeType);
  if (!ext) return name;
  return name.replace(/\.[a-z0-9]+$/i, ext) || name + ext;
}

async function handlePastedFile(file: File): Promise<void> {
  const isImage = file.type.startsWith("image/");
  let base64 = "";
  let mimeType = file.type;
  try {
    const compressed = await compressImage(file);
    base64 = compressed.base64;
    mimeType = compressed.mimeType;
  } catch {
    return;
  }
  const name =
    mimeType === file.type
      ? file.name || "allegato"
      : renameForMime(file.name || "allegato", mimeType);
  const res = await ideRequest({
    type: "saveAttachment",
    name,
    mimeType,
    dataBase64: base64,
  });
  const path = res ? (res.data as { path?: string } | undefined)?.path : undefined;
  if (path) {
    addAttachment({
      path,
      name,
      mimeType,
      // teniamo il base64 solo per le immagini (anteprima + invio inline se vision)
      dataBase64: isImage ? base64 : undefined,
    });
  }
}

els.input.addEventListener("paste", (e) => {
  const cd = e.clipboardData;
  if (!cd) return;
  const files: File[] = [];
  for (const item of cd.items) {
    const f = item.kind === "file" ? item.getAsFile() : null;
    if (f) files.push(f);
  }
  if (files.length > 0) {
    e.preventDefault();
    for (const f of files) void handlePastedFile(f);
  }
  // testo incollato: nessuna manipolazione — il paste default del browser lo
  // inserisce invariato (i path restano testo, mai convertiti in allegati)
});

// --- drag & drop: tutta la finestra è zona di drop con overlay -----------------

els.dropOverlayIcon.innerHTML = attachFileIcon();
els.dropOverlayText.textContent = t("dropToAttach");

let dragDepth = 0;

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function hideDropOverlay(): void {
  if (dragDepth <= 0) els.dropOverlay.hidden = true;
}

document.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.hidden = false;
});

document.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});

document.addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) hideDropOverlay();
});

document.addEventListener("drop", (e) => {
  dragDepth = 0;
  hideDropOverlay();
  if (!hasFiles(e)) return;
  e.preventDefault();
  const files = Array.from(e.dataTransfer?.files ?? []);
  for (const f of files) void handlePastedFile(f);
});

els.send.addEventListener("click", sendOrStop);
// nuova chat in un altro pannello: la gestisce il companion (solo in IDE;
// standalone la richiesta cade nel vuoto e la UI resta com'è)
// nuova chat: in IDE la gestisce il companion (nuova webview); in standalone
// apre una NUOVA TAB del browser con una nuova sessione (piano 0005)
els.newChat.addEventListener("click", () => {
  if (runtime.isVsCode) {
    void ideRequest({ type: "openNewChat" });
  } else {
    window.open(location.origin + "/?new=1", "_blank");
  }
});

// --- cronologia messaggi (↑/↓ con input vuoto) --------------------------------
// Il placeholder mostra l'ultimo messaggio inviato; TAB lo inserisce nella box,
// ESC torna al placeholder standard. Il placeholder standard suggerisce ↑/↓
// quando la cronologia esiste.

const HISTORY_KEY = "pi-webview-msg-history";
const messageHistory: string[] = (() => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
})();
let historyIndex = -1; // -1 = nessun preview

function setStandardPlaceholder(): void {
  // durante l'elaborazione il placeholder segnala lo stearing (Invio accoda)
  updateSteerPlaceholder();
}

function showHistoryPreview(index: number): void {
  historyIndex = index;
  const msg = messageHistory[index] ?? "";
  els.input.placeholder = `(${t("historyNav")})\n${msg}`;
}

function exitHistoryPreview(): void {
  if (historyIndex === -1) return;
  historyIndex = -1;
  setStandardPlaceholder();
}

function pushMessageHistory(text: string): void {
  messageHistory.push(text);
  if (messageHistory.length > 50) messageHistory.shift();
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messageHistory));
  } catch {
    // localStorage non disponibile: cronologia solo in memoria
  }
  setStandardPlaceholder();
}

// semina la cronologia dai messaggi utente della sessione caricata (una volta
// per sessione webview), così ↑ funziona anche dopo il resume
let historySeeded = false;

function seedMessageHistory(messages: unknown[]): void {
  if (historySeeded) return;
  historySeeded = true;
  const added: string[] = [];
  for (const m of messages) {
    const msg = m as { role?: string; content?: unknown };
    if (msg.role !== "user") continue;
    const text = contentToText(msg.content).trim();
    if (text) added.push(text);
  }
  if (added.length === 0) return;
  messageHistory.push(...added);
  if (messageHistory.length > 50) {
    messageHistory.splice(0, messageHistory.length - 50);
  }
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messageHistory));
  } catch {
    // ignore
  }
  setStandardPlaceholder();
}

els.input.addEventListener("keydown", (e) => {
  const previewing = historyIndex >= 0;
  if (previewing) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex > 0) showHistoryPreview(historyIndex - 1);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < messageHistory.length - 1) {
        showHistoryPreview(historyIndex + 1);
      } else {
        exitHistoryPreview();
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const msg = messageHistory[historyIndex];
      if (msg !== undefined) {
        els.input.value = msg;
        els.input.selectionStart = els.input.selectionEnd = msg.length;
      }
      exitHistoryPreview();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      exitHistoryPreview();
      return;
    }
  }
  // autocomplete comandi slash (piano 0003): quando il dropdown è aperto,
  // le frecce navigano, Enter/Tab accettano (mai invio/stearing), Esc chiude
  // (mai STOP)
  if (cmdOpen) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = cmdMatches.length;
      if (n > 0) {
        cmdSelected =
          e.key === "ArrowDown"
            ? (cmdSelected + 1) % n
            : (cmdSelected - 1 + n) % n;
        renderCmdSelection();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const c = cmdMatches[cmdSelected];
      if (c) acceptCmd(c.name);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const c = cmdMatches[cmdSelected];
      if (c) acceptCmd(c.name);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // NON innescare lo STOP
      closeCmdDropdown();
      return;
    }
  }
  // Invio SEMPRE possibile: durante l'elaborazione accoda (stearing),
  // da idle invia subito. Shift+Invio = a capo.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendOrStop();
    return;
  }
  // ↑ con input vuoto → naviga la cronologia (solo se esiste)
  if (
    e.key === "ArrowUp" &&
    !e.shiftKey &&
    !e.isComposing &&
    els.input.value === "" &&
    messageHistory.length > 0
  ) {
    e.preventDefault();
    showHistoryPreview(messageHistory.length - 1);
  }
});

// digitando durante il preview si torna al flusso normale
els.input.addEventListener("input", () => {
  if (historyIndex >= 0) exitHistoryPreview();
  updateCmdDropdown();
  autogrowInput(); // 2 righe di default → cresce fino a 5 digitando
});

// --- autogrow input: 2 righe di default, max 5 righe (line-height 22.5 +
// padding 15 → min 60px, max 128px; i valori rispecchiano il CSS) -----------
const INPUT_MAX_HEIGHT = 128;
function autogrowInput(): void {
  const el = els.input;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + "px";
}
function resetInputHeight(): void {
  els.input.style.height = "";
}

// palette comandi: Ctrl+K (o Meta+K su macOS)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCmdPalette();
  }
});

// lo stato di lavoro arriva dagli eventi di pi
function trackWorking(evt: RpcEvent): void {
  if (evt.type === "agent_start") {
    working = true;
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(true);
  } else if (evt.type === "agent_settled") {
    working = false;
    settleSentLoader(); // senza risposta: congela comunque il tempo atteso
    hideExtensionsBlock();
    // ferma i timer dei tool rimasti attivi (es. tool ABORTATO dallo STOP:
    // niente tool_execution_end → il timer girerà all'infinito)
    clearToolTimers();
    void fetchSessionStats(); // context/token aggiornati a fine turno
    void fetchBalance(); // il saldo cambia dopo l'uso
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(false);
    // a fine turno pi può aver assegnato il nome alla sessione (auto-title)
    void refreshSessionTitle();
    // stearing: da idle si consegna il prossimo messaggio accodato
    deliverSteering();
    // stearing: riconcilia gli "in invio" rimasti fermi (pi idle non li ha
    // più in coda → persi/scartati → torna in coda ombra e rilancio)
    void reconcileStuckPending();
  }
}

els.connectBtn.addEventListener("click", () => {
  const url = els.connectUrl.value.trim();
  if (url) void connect(url);
});

// --- demo (dev): conversazione di esempio, nessuna connessione ----------------

function renderDemo(): void {
  const user = addMsg("user");
  const ub = document.createElement("div");
  ub.className = "bubble user";
  ub.textContent = t("demoUser");
  user.appendChild(ub);

  const asst = addMsg("assistant");

  // pensiero PRIMA del testo (collassato per default)
  const thought = document.createElement("div");
  thought.className = "thinking-card";
  const { head } = makeThinkingHead(false);
  const tb = document.createElement("div");
  tb.className = "thinking-content";
  tb.textContent = t("demoThought");
  tb.hidden = true;
  head.addEventListener("click", () => {
    tb.hidden = !tb.hidden;
  });
  thought.append(head, tb);
  asst.appendChild(thought);

  const txt = document.createElement("div");
  txt.className = "md";
  txt.innerHTML = renderMarkdown(t("demoAssistant"));
  enhanceCodeBlocks(txt);
  asst.appendChild(txt);

  const tool = document.createElement("details");
  tool.className = "tool-card";
  tool.open = true;
  const s = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = "bash";
  s.appendChild(name);
  const body = document.createElement("div");
  body.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-header";
  const label = document.createElement("span");
  label.className = "code-label";
  label.textContent = "bash";
  const pre = document.createElement("pre");
  pre.textContent = `{"command":"${t("demoToolCommand")}"}`;
  header.append(label);
  addCopyButton(header, pre.textContent);
  body.append(header, pre);
  tool.append(s, body);
  asst.appendChild(tool);
}

// --- avvio -------------------------------------------------------------------

// init tema/stringhe immediato (a modulo scope): in webview VS Code senza
// questo il testo resterebbe col colore di default (nero su sfondo dell'IDE)
applyTheme(themePref);
applyUiStrings();

async function boot(): Promise<void> {
  if (demoMode) {
    renderDemo();
    hideBootLoader();
  }
  // modalità runtime: dentro un IDE (es. webview VS Code) si usa postMessage,
  // standalone il bridge WebSocket (src/web/environment.ts)
  if (runtime.isVsCode) {
    const vscode = createVsCodeTransport();
    if (vscode) {
      setupTransport(vscode);
      transport = vscode;
      els.connectPanel.hidden = true;
      return;
    }
  }
  const url = await resolveBridgeUrl();
  if (url) {
    void connect(url);
    return;
  }
  statusState = "closed";
  updateStatus();
  els.connectPanel.hidden = false;
  hideBootLoader();
}

void boot();
