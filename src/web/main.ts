// Web UI (plan 0001): pi message stream, input, abort, attach,
// theme (D7) and locale (i18n). Header: session dropdown + settings (gear).
// Does not depend on VS Code: it speaks the bridge protocol.

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
  notificationsLabel: document.getElementById("settings-notifications-label") as HTMLLabelElement,
  notifications: document.getElementById("notifications") as HTMLSelectElement,
  notificationsSessionLabel: document.getElementById("settings-notifications-session-label") as HTMLLabelElement,
  notificationsSession: document.getElementById("notifications-session") as HTMLSelectElement,
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
  ctxGauge: document.querySelector(".ctx-gauge") as unknown as SVGSVGElement,
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
  bootLoaderLogs: document.getElementById("boot-loader-logs") as HTMLDivElement,
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

// --- transport bootstrap ---------------------------------------------------
// Priority: VS Code webview (postMessage) → ?bridge= query → Vite env →
// /bridge-config.json served by the bridge (same origin, only --serve).

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
    // no bridge on the same origin
  }
  // channel intent (plan 0005): new=1 (new session) or
  // session=<path> (resume) propagated from the page query to the WebSocket
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

// boot loader: covers the UI until connection and initial data are ready
function hideBootLoader(): void {
  els.bootLoader.hidden = true;
}

// --- session loading (boot / session switch / pi restart) -------------------
// An extension may keep working (and logging to stderr) for a long time after
// the session file is loaded. While loading: the loader STAYS UP and the log
// lines collect in a box UNDER the spinner (never in the chat). Loading ends
// when the logs have been quiet for a while AND no agent run is active —
// pi exposes no "extensions done" event, the quiet period is the only
// reliable signal. A max wait is the safety net against endless loading.
let sessionLoading = false;
let loadingHistoryLoaded = false; // the chat history has been rendered
let loadingQuietTimer: ReturnType<typeof setTimeout> | null = null;
let loadingMaxTimer: ReturnType<typeof setTimeout> | null = null;
let loadingAgentActive = false;
// logs collected while loading: flushed into the chat (at the END of the
// resumed history) when the loading ends — never lost, never at the top
const loadingLogs: { level: "error" | "warn" | "info"; text: string }[] = [];
const LOADING_QUIET_MS = 1500; // logs silence that ends the loading
const LOADING_MAX_MS = 30000; // never load longer than this
const LOADING_LOG_CAP = 200; // lines kept in the box

function beginSessionLoading(): void {
  sessionLoading = true;
  loadingAgentActive = false;
  loadingHistoryLoaded = false;
  loadingLogs.length = 0;
  els.bootLoader.hidden = false;
  els.bootLoaderText.textContent = t("loading");
  els.bootLoaderLogs.hidden = true;
  els.bootLoaderLogs.textContent = "";
  // the quiet timer is NOT armed here: loading cannot end before the history
  // has been rendered (loadHistory arms it) — get_state retries at boot can
  // take much longer than the quiet window
  clearTimeout(loadingMaxTimer ?? undefined);
  loadingMaxTimer = setTimeout(loadingMaxTick, LOADING_MAX_MS);
}

// safety net against endless loading: while the history is not rendered yet
// pi is still booting (get_state retries ≈ 27s) → keep waiting
function loadingMaxTick(): void {
  if (!sessionLoading) return;
  if (!loadingHistoryLoaded) {
    loadingMaxTimer = setTimeout(loadingMaxTick, LOADING_MAX_MS);
    return;
  }
  endSessionLoading();
}

function armLoadingQuiet(): void {
  clearTimeout(loadingQuietTimer ?? undefined);
  loadingQuietTimer = setTimeout(() => {
    if (sessionLoading && loadingHistoryLoaded && !loadingAgentActive) {
      endSessionLoading();
    }
  }, LOADING_QUIET_MS);
}

function endSessionLoading(): void {
  if (!sessionLoading) return;
  sessionLoading = false;
  clearTimeout(loadingQuietTimer ?? undefined);
  clearTimeout(loadingMaxTimer ?? undefined);
  loadingQuietTimer = null;
  loadingMaxTimer = null;
  els.bootLoaderLogs.hidden = true;
  els.bootLoaderLogs.textContent = "";
  els.bootLoader.hidden = true;
}

/** routes an extension/pi log line DURING the loading: into the box under
 *  the spinner (every line re-arms the quiet timer) and into the collected
 *  list (flushed at the end of the resumed chat) */
function pushLoadingLog(level: "error" | "warn" | "info", line: string): void {
  if (!sessionLoading) return;
  loadingLogs.push({ level, text: line });
  while (loadingLogs.length > LOADING_LOG_CAP) loadingLogs.shift();
  const box = els.bootLoaderLogs;
  const div = document.createElement("div");
  div.className = `boot-loader-log level-${level}`;
  div.textContent = line;
  box.appendChild(div);
  while (box.childElementCount > LOADING_LOG_CAP) box.firstElementChild?.remove();
  box.hidden = false;
  box.scrollTop = box.scrollHeight;
  armLoadingQuiet();
}

/** copies the loading-collected logs into the chat at the END of the resumed
 *  history (called by loadHistory AFTER the render: the boxes survive the
 *  thread reset and land at the bottom, never at the top) */
function flushLoadingLogs(): void {
  if (loadingLogs.length === 0) return;
  const lines = loadingLogs.splice(0, loadingLogs.length);
  for (const l of lines) {
    const wrapper = addMsg("status");
    const line = document.createElement("div");
    line.className = `status-line level-${l.level}`;
    line.textContent = l.text;
    line.title = l.text;
    wrapper.appendChild(line);
  }
  scrollToBottom();
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
          // loading begins NOW (before get_state): slow extensions logging
          // during the resume must land in the loader box, not in the chat
          beginSessionLoading();
          await refreshSessions();
        })();
      }
    } else if (s.state === "closed") {
      endSessionLoading();
      hideBootLoader();
    }
  });
  tr.onFrame(handleFrame);
}

// --- request/response correlation (rpc and ide) ----------------------------

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

// --- theme and locale ------------------------------------------------------

const THEME_KEY: Record<ThemePreference, string> = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};

let themePref: ThemePreference = "system";

// limit of messages shown in history (resume and runtime): comes from the
// config (historyLimit), default 120 — the user changes it in the settings
const DEFAULT_HISTORY_LIMIT = 120;
let historyLimit = DEFAULT_HISTORY_LIMIT;
// notifications: `notificationsDefault` is the DEFAULT for NEW sessions
// (global config); the CURRENT session can override it — the override lives
// INSIDE the session jsonl file (SessionSettings), not in the global config.
let notificationsDefault: "desktop" | "vscode" | "off" = "desktop";
let sessionNotificationsOverride: "desktop" | "vscode" | "off" | undefined;

function effectiveNotifications(): "desktop" | "vscode" | "off" {
  return sessionNotificationsOverride ?? notificationsDefault;
}

// reads the current session's settings (override) from the host/bridge
function refreshSessionNotificationOverride(): void {
  sessionNotificationsOverride = undefined;
  updateNotificationsSessionUi();
  if (!currentSessionPath) return;
  void ideRequest({
    type: "getSessionSettings",
    sessionPath: currentSessionPath,
  }).then((res) => {
    const v = res?.ok
      ? (res.data as { notifications?: "desktop" | "vscode" | "off" } | null)
          ?.notifications
      : undefined;
    if (v === "desktop" || v === "vscode" || v === "off") {
      sessionNotificationsOverride = v;
    }
    updateNotificationsSessionUi();
  });
}

// syncs the per-session select with the override of the CURRENT session
// (called on locale changes AND on session switches)
function updateNotificationsSessionUi(): void {
  els.notificationsSession.value = sessionNotificationsOverride ?? "";
  // without a known session there is nothing to customize
  els.notificationsSession.disabled = !currentSessionPath;
}
let configId = 0;

// dev params ?theme= / ?lang= (to check without config)
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
  // notifications settings: the default (for NEW sessions) and the override
  // for the CURRENT session. Options depend on the runtime — VS Code offers
  // the in-app toast as well, the browser only desktop/off
  els.notificationsLabel.textContent = t("settingsNotificationsDefault");
  const notifyOptions: Array<{ value: "desktop" | "vscode" | "off"; label: string }> = [
    { value: "desktop", label: t("notifyDesktop") },
    ...(runtime.isVsCode ? [{ value: "vscode" as const, label: t("notifyVscode") }] : []),
    { value: "off", label: t("notifyOff") },
  ];
  if (els.notifications.options.length !== notifyOptions.length) {
    els.notifications.textContent = "";
    for (const o of notifyOptions) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      els.notifications.appendChild(opt);
    }
  }
  els.notifications.value = notificationsDefault;
  // per-session select: first option = follow the default (value "")
  els.notificationsSessionLabel.textContent = t("settingsNotificationsSession");
  if (
    els.notificationsSession.options.length !==
    notifyOptions.length + 1
  ) {
    els.notificationsSession.textContent = "";
    const inherit = document.createElement("option");
    inherit.value = "";
    inherit.textContent = t("notifyUseDefault");
    els.notificationsSession.appendChild(inherit);
    for (const o of notifyOptions) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      els.notificationsSession.appendChild(opt);
    }
  }
  updateNotificationsSessionUi();
  updateStatus();
  updateThemeButtons();
  populateSessionMenu();
  // theme: inside the VS Code webview the IDE manages it — no choice
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
      if (
        cfg.notifications === "desktop" ||
        cfg.notifications === "vscode" ||
        cfg.notifications === "off"
      ) {
        notificationsDefault = cfg.notifications;
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
    if (
      cfg.notifications === "desktop" ||
      cfg.notifications === "vscode" ||
      cfg.notifications === "off"
    ) {
      notificationsDefault = cfg.notifications;
    }
    applyUiStrings();
  }
}

// --- settings (gear) → modal dialog -----------------------------------------

// version row: the source depends on the runtime — in the VS Code webview it
// is the addon, standalone it is the piw package (both answer getVersion)
function refreshVersionInfo(): void {
  els.settingsVersionLabel.textContent =
    runtime.mode === "vscode" ? t("settingsVersionAddon") : t("settingsVersionPiw");
  void ideRequest({ type: "getVersion" }).then((res) => {
    const v = res?.ok ? (res.data as { version?: string | null } | undefined)?.version : null;
    els.settingsVersion.textContent = v ?? "–";
  });
}

// --- block 3: pi CLI flags (dynamic from the registered flags) -------------

let savedCliValues: CliFlags = {};
let cliDirty = false;

// current values in the form (flag → value): only the REALLY set ones
// (checked checkboxes, non-empty strings) — the comparison with the saved
// ones must not get dirty with defaults (false checkboxes / empty inputs)
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

// dynamic rows: ONLY the existing flags (if the extension is missing, the
// flag does not appear); boolean → checkbox, string → disabled input (soon)
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

// Apply: with an in-flight run → confirm + dequeue+stop (like STOP),
// then setCliFlags → the companion restarts pi transparently (connection_closed
// reason restart + pi_restarted → re-init without reload)
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

// --- session dropdown -------------------------------------------------------

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
  // "new session" action (top row, no path)
  if (item.dataset.action === "new") {
    // if the current session IS ALREADY a new session the row is highlighted
    // as active: clicking it closes the menu (like the current session)
    if (!!currentSessionPath && isNewSession(currentSession())) {
      els.sessionMenu.hidden = true;
      return;
    }
    void startNewSession();
    return;
  }
  if (!item.dataset.path) return;
  // rename/delete actions: stopPropagation, no session change
  if (action?.dataset.action === "rename") {
    void renameSessionFlow(item.dataset.path);
    return;
  }
  if (action?.dataset.action === "delete") {
    void deleteSessionFlow(item.dataset.path);
    return;
  }
  // click on the main area: current session → close only
  if ((e.target as HTMLElement).closest(".session-item-main")) {
    if (item.dataset.path === currentSessionPath) {
      els.sessionMenu.hidden = true;
      return;
    }
    void pickSession(item.dataset.path);
  }
});

// --- rename / delete session (dropdown) ------------------------------------

// dialog with prefilled text field: Enter applies, Escape cancels
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
  // initial value: assigned name or current label (first message)
  const initial =
    s.name && !hasCjk(s.name) ? s.name : sessionLabel(s);
  const next = await showPrompt(initial, t("renameSession"));
  if (next === null) return; // cancelled
  const newName = next.trim();
  if (!newName || newName === initial) return; // empty or unchanged
  const current = path === currentSessionPath;
  if (current) {
    // current session: the name lives in pi's memory (RPC)
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
  if (current) void refreshSessionTitle(); // updates box and title
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
  // current session deleted → start with a new session
  if (path === currentSessionPath) {
    els.thread.textContent = "";
    try {
      await rpcRequest({ type: "new_session" });
    } catch {
      // new_session failed: refreshSessions realigns with the pi state
    }
  }
  els.sessionMenu.hidden = false; // stays open: shows the updated list
  await refreshSessions();
}

// new session: closes the dropdown and reloads with the fresh session
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
      // pi may assign the name late: update box and title when it arrives
      pollSessionTitle();
    }
  } catch {
    // new_session failed: the current session stays
  }
  switchingSession = false;
  els.sessionBtn.disabled = false;
  populateSessionMenu();
}

// session pick: same folder → switch; elsewhere → fork (like pi)
async function pickSession(path: string): Promise<void> {
  if (switchingSession) return;
  const s = sessions.find((x) => x.path === path);
  const crossFolder = s?.cwd && workspacePath && s.cwd !== workspacePath;
  if (!crossFolder) {
    switchSession(path);
    return;
  }
  // session of another folder: ask fork confirmation (custom modal, not
  // window.confirm: it does not work in VS Code webviews)
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

// history limit: saved in the config and re-applied right away (truncates from the top)
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
  void loadHistory(); // re-applies the truncation to the current history
});

els.notifications.addEventListener("change", () => {
  const v = els.notifications.value;
  if (v !== "desktop" && v !== "vscode" && v !== "off") return;
  notificationsDefault = v; // default for NEW sessions
  transport?.send({
    channel: "ide",
    payload: {
      type: "setConfig",
      patch: { notifications: v },
      id: `cfg-${++configId}`,
    },
  });
});

els.notificationsSession.addEventListener("change", () => {
  const v = els.notificationsSession.value;
  if (!currentSessionPath) return;
  if (v === "") {
    sessionNotificationsOverride = undefined; // follow the default again
  } else if (v === "desktop" || v === "vscode" || v === "off") {
    sessionNotificationsOverride = v;
  } else {
    return;
  }
  // the override lives INSIDE the session jsonl (custom entry), never in the
  // global config: one key per session would grow it forever
  transport?.send({
    channel: "ide",
    payload: {
      type: "setSessionSettings",
      sessionPath: currentSessionPath,
      settings: sessionNotificationsOverride
        ? { notifications: sessionNotificationsOverride }
        : {},
      id: `cfg-${++configId}`,
    },
  });
});

watchThemeChanges(() => applyTheme(themePref));

// --- sessions (dropdown) -----------------------------------------------------

let sessions: SessionInfo[] = [];
let currentSessionPath: string | null = null;
let switchingSession = false;
let workspaceLabel = "";
let workspacePath: string | null = null;
let filterMode: "folder" | "all" = "folder";

// Auto-generated names (pi-spark) can come out in CJK even with Italian
// prompts: in that case we prefer the first message.
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

// relative time like in the pi /resume selector ("now", "22m", "2h", "3d")
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

// new session = no message saved yet
function isNewSession(s?: SessionInfo): boolean {
  return !s || !s.messageCount || s.messageCount === 0;
}

function populateSessionMenu(): void {
  els.sessionFilters.textContent = "";
  els.sessionItems.textContent = "";

  // filter on the same row: ./folder | All (segmented control)
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
  // standalone only: folder icon to change workspace (in IDE webviews
  // the workspace is decided by the host)
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

  // "new session" action row: ALWAYS present. When the current session IS
  // already a new session it is highlighted as active (like the others).
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
    // the current session may not be in the list (just created, not saved);
    // if it is NEW it is already represented by the highlighted action row above
    const list = [...sessions];
    if (currentSessionPath && !currentIsNew && !list.some((s) => s.path === currentSessionPath)) {
      list.unshift({ path: currentSessionPath, name: t("newSession") });
    }
    for (const s of list) {
      // the current new session lives in the action row: no duplicate
      if (currentIsNew && s.path === currentSessionPath) continue;
      // container: main clickable area (name+meta) + rename/delete actions.
      // No nested <button>: the item is a flex div.
      const item = document.createElement("div");
      item.className = "session-item";
      item.dataset.path = s.path;
      item.classList.toggle("active", s.path === currentSessionPath);
      // the current new session is shown highlighted (like the action)
      item.classList.toggle(
        "new-session",
        s.path === currentSessionPath && isNewSession(s),
      );
      // in "All" mode, highlight the sessions of the current folder
      item.classList.toggle(
        "in-workspace",
        filterMode === "all" && !!workspacePath && s.cwd === workspacePath,
      );
      const main = document.createElement("button");
      main.type = "button";
      main.className = "session-item-main";
      const label = document.createElement("span");
      label.className = "session-item-label";
      // new session (0 messages) → explicit title in the dropdown
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
      // actions for EVERY session: rename + delete (with confirmation)
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

// current label reused by box and browser title
function currentSessionLabel(): string {
  const cur = currentSession();
  if (cur) return isNewSession(cur) ? t("newSession") : sessionLabel(cur);
  return currentSessionPath ? t("newSession") : t("noSessions");
}

// the browser title shows the session name, only outside the IDE
function updateDocumentTitle(): void {
  if (runtime.isVsCode) return; // in the IDE the title is managed by the host
  const label = currentSessionLabel();
  document.title =
    label && label !== t("noSessions") ? `${label} — pi-webview` : "pi-webview";
}

// re-reads the current session data (name assigned by pi, first message,
// count) and updates box + browser title
async function refreshSessionTitle(): Promise<void> {
  if (!currentSessionPath) return;
  // 1) name assigned by pi (e.g. auto-title) via get_state
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
    // get_state failed: fall back to the file read
  }
  // 2) fresh data from the file (first message, count, name in session_info)
  const res = await ideRequest({ type: "getSessionInfo", path: currentSessionPath });
  if (res?.ok) {
    const info = res.data as SessionInfo;
    const idx = sessions.findIndex((x) => x.path === currentSessionPath);
    if (idx >= 0) sessions[idx] = { ...sessions[idx], ...info };
    else sessions.unshift(info);
  }
  if (named || res?.ok) populateSessionMenu();
}

// after a new session pi may assign the name late: short polling
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
  // get_state can fail at startup (pi not ready yet in the webview):
  // retry until the process answers (short per-attempt timeout)
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
          persistSessionPath(); // resume the same session on VS Code reloads
          refreshSessionNotificationOverride(); // per-session select follows it
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
        break; // pi ready
      }
    } catch {
      // pi not up yet: retry shortly
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const trust = await ideRequest({ type: "getTrust" });
  if (trust?.ok) renderTrust(trust.data as { status?: string } | null);
  // workspace first (instant, no reading of all session files)
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
  // steering: persisted queue restored; if pi is idle, deliver right away
  await loadSteerQueue();
  updateSteerPlaceholder();
  deliverSteering();
  void fetchSlashCommands(); // extension commands for the palette (plan 0003)
}

async function loadHistory(): Promise<void> {
  try {
    const res = await rpcRequest(rpc.getMessages());
    const messages = (res.data as { messages?: unknown[] } | undefined)?.messages;
    if (messages) {
      // only the LAST historyLimit turns: the long history is
      // truncated from the top (never the whole session)
      renderHistory(messages.slice(-historyLimit));
      seedMessageHistory(messages.slice(-historyLimit));
    }
  } catch {
    // no history available
  }
  void fetchSessionStats(); // context gauge after every session change
  void fetchBalance(); // real provider balance (after currentModel is known)
  void fetchCompactionSettings(); // pi auto-compaction threshold for the tooltip
  // a session load (boot/switch/restart) cannot finish before the history is
  // rendered: only now may the loader close (quiet timer). The logs collected
  // under the spinner are appended at the END of the resumed chat.
  loadingHistoryLoaded = true;
  flushLoadingLogs();
  if (sessionLoading) armLoadingQuiet();
}

// pi auto-compaction thresholds (config ~/.pi/config.json): for the tooltip
// of the context block — "(auto-compact ≥ X%)"
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

// --- workspace change (standalone: folder browse + destination choice) -----

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

// folder navigation modal (bridge listDir): resolves with the chosen path
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
      // ".. (parent folder)" as the first element of the list
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

// 3-choice dialog: fork the session into the new folder, new session,
// or cancel
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
  if (target === workspacePath) return; // same folder: no change
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

// saves the current session in the companion (VS Code globalState): on
// window reloads pi is restarted with --session <path> and resumes the open
// conversation (only in VS Code webview mode)
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
        persistSessionPath(); // resume this session on VS Code reloads
        // loading overlay: slow extensions keep logging after the session
        // file is ready — the chat must stay clean until they settle
        beginSessionLoading();
        els.thread.textContent = "";
        await loadHistory();
        refreshSessionNotificationOverride(); // the override follows the new session
      }
    } catch {
      // switch failed: the current session stays
    }
    switchingSession = false;
    els.sessionBtn.disabled = false;
    populateSessionMenu();
    els.sessionMenu.hidden = true;
  })();
}

// --- message rendering -----------------------------------------------------

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
// the STOP button lives in the STATUS BAR (right of the context):
// red, visible only with an active turn, clickable independently
function updateThinkingStopBtn(visible: boolean): void {
  els.statsStop.hidden = !visible;
}

// STOP: like pi.dev's Escape — first brings the messages back into steering
// in the editor (dequeue), THEN stops the current turn
els.statsStop.innerHTML = stopIcon();
els.statsStop.title = t("stopWorking");

// STOP (▢ button or Esc key): like pi.dev's Escape — first brings the
// steering messages back into the editor (dequeue), THEN stops the current turn
function stopWorking(): void {
  if (!transport || !working) return;
  dequeueSteering(); // the queued messages return to the textarea (if any)
  transport.send({ channel: "rpc", payload: rpc.abort() });
  working = false;
  hideSentLoader();
  hideExtensionsBlock();
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
}

els.statsStop.addEventListener("click", stopWorking);

// Esc during processing = STOP (like pi.dev). The modals (confirm/
// prompt) already close on Esc in the capture phase with stopPropagation:
// nothing arrives here while a modal is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (els.settingsModal && !els.settingsModal.hidden) return; // settings open
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
  // runtime: the history never exceeds historyLimit — truncate from the top
  while (els.thread.children.length > historyLimit) {
    els.thread.firstElementChild?.remove();
  }
  scrollToBottom();
  return wrapper;
}

// margin to be considered "at the bottom" (and therefore follow the autoscroll).
// DELIBERATELY SMALL: just scrolling up a bit with the wheel inhibits the
// autoscroll. The content growth does NOT depend on this margin (it is
// handled by stickToBottom, see below).
const SCROLL_RESUME_MARGIN = 24;

// is the user following the chat? Updated ONLY by the scroll event (never by
// our realignments, which bring it back to true when back at the bottom).
// Separates the user's INTENT from the content growth: the async rendering
// moves the bottom but does not change the state → the streaming keeps
// following until the user really scrolls.
let stickToBottom = true;

// smart auto-scroll: follows only if the user is already at the bottom
function scrollToBottom(force = false): void {
  if (!force && !stickToBottom) return;
  const el = els.messages;
  el.scrollTop = el.scrollHeight;
  // the rendering is ASYNC (markdown re-render at rAF, images, code blocks):
  // the content grows AFTER the assignment → realign on the following frames
  // while the user keeps following (stickToBottom stays true even if the
  // bottom moved: it changes only if the user scrolls)
  requestAnimationFrame(() => {
    if (force || stickToBottom) el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      if (force || stickToBottom) el.scrollTop = el.scrollHeight;
    });
  });
}

function openAssistantBubble(): void {
  currentMsg = addMsg("assistant");
  // the thinking goes ALWAYS before the streaming text (and in the final result)
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

// --- markdown streaming -----------------------------------------------------

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

// --- thinking with loader (no <details>: bar + label + spinner + timer) -----

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
    thinkingContentEl.hidden = true; // collapsed by default (streaming still live)
    // local capture: each block toggles its OWN content
    const contentEl = thinkingContentEl;
    head.addEventListener("click", () => {
      contentEl.hidden = !contentEl.hidden;
    });
    thinkingEl.append(head, thinkingContentEl);
    thinkingSlot.appendChild(thinkingEl);
    applyToolChain(); // first thinking block: evaluate the 3px gap with the previous one
    startThinkingTimer();
    scrollToBottom();
  }
  return thinkingEl as HTMLElement;
}

// at thinking end: spinner removed, the content stays expandable
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

// --- "Extensions" block (pre-stream wait > 3s) -------------------------------
// After a send, if the extensions (e.g. heavy hooks like vision-handoff at
// resume) keep pi busy for more than 3s without the first output arriving,
// we show a block with loader + timer like the Thinking one, so the user
// understands something is working. It disappears at the first real output
// (or at turn end).

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
  head.className = "thinking-head extensions-head";
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
  // click → panel with what we CAN know about extensions at this moment
  // (pi does not expose which extension is executing): status signals
  // received via setStatus + available extension commands
  const panel = document.createElement("div");
  panel.className = "extensions-panel";
  panel.hidden = true;
  const note = document.createElement("div");
  note.className = "extensions-note";
  note.textContent = t("extPanelNoInfo");
  panel.appendChild(note);
  const statusList = document.createElement("div");
  statusList.className = "extensions-status";
  const statusLabel = document.createElement("div");
  statusLabel.className = "extensions-label";
  statusLabel.textContent = t("extPanelStatus");
  statusList.append(statusLabel);
  for (const text of statusSlots.values()) {
    const item = document.createElement("div");
    item.className = "extensions-item";
    item.textContent = stripAnsi(text);
    statusList.appendChild(item);
  }
  if (statusSlots.size === 0) {
    const none = document.createElement("div");
    none.className = "extensions-item muted";
    none.textContent = t("extPanelNone");
    statusList.appendChild(none);
  }
  panel.appendChild(statusList);
  const cmdList = document.createElement("div");
  cmdList.className = "extensions-status";
  const cmdLabel = document.createElement("div");
  cmdLabel.className = "extensions-label";
  cmdLabel.textContent = t("extPanelCommands");
  cmdList.append(cmdLabel);
  const cmds = slashCommands.slice(0, 12);
  if (cmds.length === 0) {
    const none = document.createElement("div");
    none.className = "extensions-item muted";
    none.textContent = t("extPanelNone");
    cmdList.appendChild(none);
  }
  for (const c of cmds) {
    const item = document.createElement("div");
    item.className = "extensions-item";
    item.textContent = `/${c.name}`;
    if (c.description) item.title = c.description;
    cmdList.appendChild(item);
  }
  panel.appendChild(cmdList);
  card.appendChild(panel);
  head.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });
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

// armed at every send: if the first output does not arrive within 3s, shows the block
function armExtensionsBlock(): void {
  hideExtensionsBlock();
  extensionsTimeout = setTimeout(() => {
    extensionsTimeout = null;
    if (working) showExtensionsBlock();
  }, EXTENSIONS_DELAY_MS);
}

// --- send loader on the user message -----------------------------------------
// As soon as the user sends, his message shows a spinner + timer counting
// the seconds from the send to the first model response (thinking, text or tool).
// Independent from the "Extensions" block (which signals pre-stream work):
// this gives immediate feedback that the message was delivered and is awaited.

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

// at the first real model content: spinner removed, the timer stays
// frozen on the message as a memory of how long it took to answer
function settleSentLoader(): void {
  if (sentLoaderClock) {
    clearInterval(sentLoaderClock);
    sentLoaderClock = null;
  }
  if (!sentLoaderEl) return;
  // already frozen: the later deltas (e.g. every thinking_delta) must NOT
  // rewrite the timer — the value stays that of the first response
  if (sentLoaderEl.classList.contains("settled")) return;
  const secs = Math.max(1, Math.round((performance.now() - sentLoaderStartedAt) / 1000));
  if (sentLoaderTimerEl) sentLoaderTimerEl.textContent = `${secs}s`;
  sentLoaderEl.classList.add("settled");
  sentLoaderSpinnerEl?.remove();
  sentLoaderSpinnerEl = null;
}

// fully removed (only on abort): spinner and timer gone
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

// --- footer slots filled by the pi EXTENSIONS (ctx.ui.setStatus) -----------
// pi-webview is a passive renderer: every extension calls setStatus(key, text)
// (already forwarded as extension_ui_request in RPC mode) and the webview
// shows one slot per key; setStatus(key, undefined) clears the slot.
// E.g. pi-tokens-per-second → ⚡ 43 tokens in 0.7s (59.1 t/s).

const statusSlots = new Map<string, string>();

// --- ANSI SGR → HTML with colors mapped on the theme ------------------------
// The extensions format for the terminal: instead of throwing away the codes,
// we parse them (SGR: 16/256-color fg, bold) and render them with the theme
// tokens (--ansi-N), readable both in dark and light.

// standard xterm RGB to reduce the 256 colors to the closest of the 16
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
  if (n >= 232) return n >= 244 ? 15 : 8; // gray scale
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

// text with ANSI sequences → safe HTML (escape first, then colored wrap)
function renderAnsiToHtml(text: string): string {
  // remove the OSC sequences (e.g. terminal titles); the CSI SGR remain
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

// plain text only (for tooltips): removes OSC and CSI
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
}

// UI requests of the pi extensions (ctx.ui.*): in VS Code the companion
// handles them with native UI (select/confirm/input), here (standalone/piw)
// the webview answers with its own modals. Never leave the extension waiting.
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
      // the command answered (dialog): stop the sent loader timer
      settleSentLoader();
      hideExtensionsBlock();
      const title = (evt.title as string | undefined) ?? "";
      const options = (evt.options as string[] | undefined) ?? [];
      // ask_user: the first question splits the card into N cards (header =
      // ellipsis question, timer at the end) — the JSON args are already in
      // the card body
      if (askUserQuestionCounter === 0) prepareAskUserCards();
      askUserQuestionCounter++;
      // INLINE at the bottom of the chat (no overlay modal): the user reads
      // the history and answers from the thread
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
      // prefilled text (e.g. edit): same input block
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
      // extension command response: stop the sent loader timer
      // (commands do not emit agent_start/delta) and show the notification in chat
      settleSentLoader();
      hideExtensionsBlock();
      const msg = (evt.message as string | undefined) ?? (evt.title as string) ?? "";
      if (msg) addStatusLine(msg);
      return;
    }
    default:
      // fire-and-forget methods (setWidget/setTitle/…): no response
      return;
  }
}

// selection modal (pi extension, ctx.ui.select): option list with
// keyboard ↑/↓ + Enter, Esc/outside click = cancel
// --- extension dialogs INLINE at the bottom of the chat ---------------------
// The user must be able to READ the chat and history while answering: the
// dialog (select/confirm/input from extension_ui_request) is a block at the
// end of the thread, not an overlay modal. One request at a time (the
// extensions ask sequentially); Esc or ✕ = cancel.
// At the answer the block COLLAPSES into a tool card (like edit/write): a
// single ellipsis row with the answer and the seconds timer at the end.
let inlineDialog: { el: HTMLElement; cancel: () => void } | null = null;

function closeInlineDialog(): void {
  const d = inlineDialog;
  if (!d) return;
  inlineDialog = null;
  d.cancel();
}

// base card of the inline dialog (title + live timer + ✕ + body), at the end
// of the thread. dismiss() = cancel (no card); collapse() = answer: the card
// becomes the compact tool row (name + ellipsis answer + frozen timer).
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
  // FORCES the autoscroll: it is a question awaiting an answer — it must be
  // seen even if the user was reading the history above (addMsg uses
  // stickToBottom and would not tear the view away)
  scrollToBottom(true);
  const cleanup = () => {
    document.removeEventListener("keydown", esc, true);
  };
  const dismiss = () => {
    cleanup();
    wrapper.remove();
  };
  // answer: do NOT create a second card — update the real tool card
  // (the toolcall_start one, finalized by pi with the result) and remove
  // the dialog block. One single box, with the answer in the ellipsis row
  // and the timer at the end (the real card already runs it until tool_call_end).
  const collapse = (answer: string) => {
    cleanup();
    // ask_user: update the card of the current question and close (one card
    // per question, row → answer)
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
      // multi-question in the same call: append to the row (separator ·)
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
    // fallback (dialog without a tool card): create the compact row in the wrapper
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
    // expandable body: question + answer (like the args of the other tools)
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

// selection with options (ctx.ui.select / ask_user)
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

// confirmation (ctx.ui.confirm)
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

// text input (ctx.ui.input / editor / "Other" of ask_user)
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
    // Enter = send, Shift+Enter = new line
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
    // terminal ANSI → colors mapped on the theme (textContent no: HTML is needed)
    slot.innerHTML = renderAnsiToHtml(text);
    slot.title = stripAnsi(text);
    els.statsSlots.appendChild(slot);
  }
  updateStatsTitle();
}

// full badge (tooltip) title: only % of context + click suggestion
// + pi auto-compaction threshold in parentheses (no token counts: the
// context is already readable in the gauge label)
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

// --- responsive: no block hiding, only standard CSS ellipsis ----------------
// The context block stays whole (flex: 0 0 auto); the extension slots
// shrink (flex: 1 1 auto + min-width: 0) and the last visible one shows the
// native ellipsis. No JS needed.

// --- circular context gauge (always visible, teal bar) ----------------------

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
  // after the compact pi does not know the tokens until a response arrives:
  // percent null → ring at 0, label with only the window (…/200K)
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

// real provider balance (deepseek/openrouter): via companion/bridge
// (reads the key from auth.json, the webview only gets { currency, balance })
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
    creditText = ""; // provider without a balance endpoint: no balance
    creditBalance = 0;
  }
  renderModelInfo();
}

// session stats (tokens/context): poll after every turn and at boot
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
    // total session cost (computed by the pi core from real usage)
    if (typeof data?.cost === "number") sessionCost = data.cost;
    const cu = data?.contextUsage;
    // after the compact pi returns { tokens: null, contextWindow, percent: null }:
    // the window is still known → we show …/window until there is a
    // response after the compaction
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
    renderBalanceChip(); // the session cost updates at every turn
  } catch {
    // pi not ready yet: the gauge stays on “–”
  }
}

// --- tool cards with copy ----------------------------------------------------

function ensureToolCard(name?: string): HTMLElement {
  if (!toolsEl && currentMsg) {
    // real name if already known (toolcall_start), otherwise a neutral placeholder
    toolsEl = buildToolCard({ id: "", name: name || t("tool"), args: "" });
    toolsPre = toolsEl.querySelector<HTMLPreElement>("pre");
    currentMsg.appendChild(toolsEl);
    applyToolChainIfToolFirst(); // first tool block: evaluate the 3px gap
  }
  return toolsEl as HTMLElement;
}

// --- copy (single component, same style everywhere) ---------------------------

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
      // clipboard unavailable (e.g. webview without permissions)
    }
  });
  return btn;
}

function addCopyButton(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = makeCopyButton(text);
  container.appendChild(btn);
  return btn;
}

// transforms the marked <pre> into the unique code-block pattern (header + copy)
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

// --- message finalization ---------------------------------------------------

// tool card header: name in pill (solid accent), muted arguments next to it
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

// track the last assistant text of the current turn: used to synthesize the
// turn-complete desktop notification at agent_settled (pi does not emit one)
let lastAssistantText = "";

function finalizeMessage(msg: FinalizedMessage): void {
  if (currentText) {
    // thinking before the text: the slot is already before .md in the DOM
    if (thinkingEl && !thinkingContentRendered) finishThinking();
    if (msg.thinking.trim() && !thinkingContentRendered) {
      const card = document.createElement("div");
      card.className = "thinking-card";
      const { head } = makeThinkingHead(false);
      const body = document.createElement("div");
      body.className = "thinking-content";
      body.textContent = msg.thinking.trim();
      body.hidden = true; // collapsed by default
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
    // tool call: reuse the streaming card for the first one (avoids duplicates)
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
  // assistant wrapper without content (e.g. empty stream): remove it,
  // otherwise it creates ghost gaps between the tool blocks in the history
  if (currentMsg) {
    const hasContent =
      !!currentMsg.querySelector(".thinking-card") ||
      !!currentMsg.querySelector(".tool-card") ||
      (currentText ? currentText.textContent.trim().length > 0 : false);
    if (!hasContent) currentMsg.remove();
  }
  // remember the answer for the turn-complete notification
  if (msg.text.trim()) lastAssistantText = msg.text.trim();
  // provider/turn failure: show the error as its own box (the terminal
  // console shows it, the webview must not swallow it)
  if (msg.errorMessage) addSystemBox("error", msg.errorMessage);
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
  // the name must be attached BEFORE renderToolHeader: el.after() on a
  // detached node creates and discards the args span silently (no command
  // in the summary)
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
  // estimated duration: assistant timestamp − previous message timestamp
  // (in the tool loop that gap is the LLM reasoning time, dominated by the
  // thinking) — same format as the live timers (min 1s, rounded)
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

// compact card for a tool result (truncated output)
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

// --- live tool output --------------------------------------------------------
// the card created during streaming also shows the tool RESULT
// (tool_execution_start/update/end), like in the history.

const toolCardsById = new Map<string, HTMLElement>();

// --- tool execution timers ---------------------------------------------------

const toolTimers = new Map<
  HTMLElement,
  {
    startedAt: number;
    clock: ReturnType<typeof setInterval> | null;
    el: HTMLElement | null;
  }
>();

function fmtToolTime(ms: number): string {
  // below one second shows the real milliseconds (3ms, 142ms): the 0.0s
  // rounding was hiding real but extremely fast operations
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
// start timestamps of the tools in the history (assistant → toolResult)
const toolStartTimes = new Map<string, number>();

// --- ask_user: ONE CARD PER QUESTION -----------------------------------------
// pi calls ask_user ONCE with N questions in the payload; the webview splits
// the card into N cards (header = ellipsis question + timer), updated at the
// answer (header → answer, result in the body). State also persisted at resume.
interface AskUserInfo {
  cards: HTMLElement[];
  questions: string[];
}
const askUserInfoByTool = new Map<string, AskUserInfo>();
let askUserQuestionCounter = 0; // current question (1-based) of the tool in progress
let currentAskUserToolId = "";

// parsing of the ask_user args: JSON { questions: [...] } (or a single object)
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

// ask_user card header: name + text (question or answer) ellipsis + timer
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

// splits the single card into N cards (one per question), header = question
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
  // no timer for the questions: not needed (also remove from the first card,
  // which had it from buildToolCard)
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

// applies fn to all the cards of the tool (ask_user: N cards; others: 1)
function forEachToolCard(toolId: string, fn: (c: HTMLElement) => void): void {
  const info = askUserInfoByTool.get(toolId);
  if (info && info.cards.length > 0) info.cards.forEach(fn);
  else {
    const first = toolCardsById.get(toolId);
    if (first) fn(first);
  }
}

// the ask_user result ("Q1: …\nA1: …\n\nQ2: …\nA2: …") is distributed
// per question: every card gets its segment in the body and the answer in
// the row (final state, identical also at resume)
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

// at the dialog answer: update the card of the current question (header →
// answer, result right away in the body — the tool_execution_end
// distribution overwrites it with the same content, idempotent)
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

// first dialog of an ask_user: the args (JSON questions) are already in the
// body of the card → splits into N cards and registers the state for the answers
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

// message timestamp (epoch ms number or ISO string), 0 if missing/invalid
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

// --- diff stats (added/removed/modified lines) -------------------------------
// Parses a unified diff (details.diff of edit/write/edit-diff): a “-” line
// followed by “+” lines is an in-place MODIFICATION (counted once), otherwise
// pure addition/removal counts.

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
      // group of lines replaced in place: counted as a modification
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
    else flush(); // context or header: closes the current group
  }
  flush();
  return { added, removed, modified };
}

// badge in the card summary, BEFORE the timer, separated by muted pipes
function renderToolDiff(card: HTMLElement, diff: string): void {
  const s = diffStats(diff);
  if (s.added === 0 && s.removed === 0 && s.modified === 0) return;
  // remove a possible previous badge (e.g. the +N of write) before the new one
  card.querySelector(".tool-diff")?.remove();
  const el = document.createElement("span");
  el.className = "tool-diff";
  const parts: Array<[string, string, string]> = [
    ["d-add", "+", String(s.added)],
    ["d-rem", "−", String(s.removed)],
    ["d-mod", "~", String(s.modified)],
  ];
  for (const [cls, sign, count] of parts) {
    // NEVER zeros: pure insert → +100, pure delete → −200, replacement → +N −M
    if (count === "0") continue;
    const p = document.createElement("span");
    p.className = cls;
    p.textContent = `${sign}${count}`;
    el.appendChild(p);
  }
  // before the timer (which lives in the summary)
  card.querySelector(".tool-timer")?.before(el);
}

// lines of the write content: the "content" value in the args (\n escaped).
// ATTENTION: the model emits "content": "..." (space after the colon)
// and the content can contain \" (escaped quotes) — whitespace-tolerant regex
function writeLinesFromArgs(argsJson: string): number {
  const m = argsJson.match(/"content"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/);
  const content = m?.[1] ?? "";
  return content ? (content.match(/\\n/g) ?? []).length + 1 : 0;
}

// +N badge of the written lines (write has no diff from pi: we compute it)
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

// stray duplicate comment (removed)
function handleToolExecution(evt: RpcEvent): void {
  const id = evt.toolCallId as string | undefined;
  if (!id) return;
  const card = toolCardsById.get(id);
  if (!card) return;
  if (evt.type === "tool_execution_start") {
    // timer on ALL the cards (ask_user has one per question)
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
    // added/removed/modified lines from the diff (edit/write/edit-diff)
    const diff = res?.details?.diff;
    if (diff) renderToolDiff(card, diff);
    const text = extractTextContent(res?.content);
    if (text) {
      // ask_user: distribute the result per question (one card each)
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
  // steering: deliver at pi.dev's point (after the turn's tool calls) and
  // reconciliation with the native pi queue
  if (evt.type === "turn_end") {
    if (working) deliverSteering(); // streaming: prompt(streamingBehavior:"steer")
    return;
  }
  if (evt.type === "message_start") {
    const msg = (evt as {
      message?: { role?: string; customType?: string; content?: unknown; display?: unknown };
    }).message;
    const role = msg?.role;
    if (role === "user") {
      // steering injected (or normally sent message: already rendered)
      handleUserMessageStart(evt);
      return;
    }
    if (msg && role === "custom" && msg.display !== false) {
      // message injected from ANOTHER session (e.g. session-control
      // `send`): incoming bubble — the chat must show it
      renderCustomMessageBubble(msg);
      return;
    }
  }
  // compaction: show the block even if started by pi (auto-compaction)
  if (evt.type === "compaction_start") {
    showCompactionBlock();
  } else if (evt.type === "compaction_end") {
    // REAL outcome from pi: errorMessage present → failed (the client cannot
    // trust the response alone: it arrives after the event)
    const errMsg = evt.errorMessage as string | undefined;
    finishCompaction(!!errMsg, errMsg);
    // steering: after the compaction the queue delivery restarts
    deliverSteering();
  } else if (evt.type === "connection_closed") {
    if (evt.reason === "restart") {
      // INTENTIONAL restart (Apply CLI flags): pi is restarting with the new
      // command line → no error; the re-init arrives with pi_restarted
      piRestarting = true;
      updateSendButton();
      return;
    }
    // pi is dead (process terminated) or failed to start: unlock everything
    // and warn. If the host passed the used command line, invite to verify pi
    // from a terminal (the real pi error is only visible by launching it by hand).
    // hideBootLoader: without it the loader stays until refreshSessions gives
    // up (get_state retries ≈ up to 27s) — the error must appear right away.
    endSessionLoading(); // also clears the loading timers
    hideBootLoader();
    if (compacting) finishCompaction(true, (evt.errorMessage as string) ?? undefined);
    hideSentLoader();
    hideExtensionsBlock();
    working = false;
    updateSendButton();
    const cmd = evt.command as string | undefined;
    addStatusLine(cmd ? tpl(t("piDiedHint"), { command: cmd }) : t("piDied"));
  } else if (evt.type === "panel_mode") {
    // webview in an EDITOR PANEL (not sidebar): the attached selection is
    // unreliable (panel focus clears the active-editor context) → disable
    // the selection block
    panelMode = evt.enabled === true;
    if (panelMode) els.selectionPanel.hidden = true;
  } else if (evt.type === "pi_restarted") {
    // restart completed: re-initialize WITHOUT reload (transparent): session
    // state + config; the current session is resumed by the companion with
    // --session, currentSessionPath is still in memory
    piRestarting = false;
    updateSendButton();
    // reset UI Applica: i valori applicati sono ora quelli salvati
    els.cliApply.disabled = false;
    els.cliApplyRow.hidden = true;
    els.cliApplyHint.textContent = "";
    savedCliValues = currentCliValues();
    if (compacting) finishCompaction(true, "restart");
    requestConfig();
    if (!demoMode) {
      // same loading semantics as the boot: extensions logging during the
      // re-init go under the spinner, the loader ends when they settle
      beginSessionLoading();
      void refreshSessions();
    }
  }
  // UI requests of the pi extensions (ctx.ui.*) → webview modals (standalone)
  if (evt.type === "extension_ui_request") {
    handleExtensionUiRequest(evt);
    return;
  }
  // extension errors (rpc-mode emits extension_error): one box per error
  if (evt.type === "extension_error") {
    const path = String(evt.extensionPath ?? "");
    const err = evt.error as { message?: unknown } | undefined;
    const msg = String(err?.message ?? evt.error ?? "Extension error");
    const line = path ? `${path}: ${msg}` : msg;
    addSystemBox("error", line);
    return;
  }
  // raw pi stderr lines (terminal parity): forwarded by the host/bridge.
  // Terminal protocol (OSC notify/title, CSI colors…) is stripped: pi.dev
  // renders it as UI, here it would be garbage.
  if (evt.type === "pi_stderr") {
    const line = cleanConsoleText(String(evt.line ?? ""));
    if (!line) return;
    const level = /^error|^fatal|^✗|error:/i.test(line)
      ? "error"
      : /^warning|^warn|⚠/i.test(line)
        ? "warn"
        : "info";
    addSystemBox(level, line);
    return;
  }
  // OSC 777 notify from pi (turn complete etc.): internal TUI notification —
  // never chat text; browser notification only when the window is hidden
  if (evt.type === "pi_notify") {
    const title = String(evt.title ?? "");
    const body = cleanConsoleText(String(evt.body ?? ""));
    if (body) {
      // debug: how many times the webview receives the notify (double check)
      transport?.send({
        channel: "ide",
        payload: { type: "debugNotify", count: ++webviewNotifyCount },
      });
      handlePiNotify(title, body);
    }
    return;
  }
  if (
    evt.type === "tool_execution_start" ||
    evt.type === "tool_execution_update" ||
    evt.type === "tool_execution_end"
  ) {
    handleToolExecution(evt);
    if (evt.type === "tool_execution_start") settleSentLoader(); // first real output
    if (evt.type === "tool_execution_start") hideExtensionsBlock(); // first real output
    return;
  }
  const action: UiAction = handleRpcEvent(stream, evt);
  switch (action.kind) {
    case "stream_start":
      // NOTE: message_start arrives as soon as the provider stream opens, NOT
      // at the first token: here the send loader must stay (the deltas remove it)
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
      // the name arrives with toolcall_start (partial.content[index].name):
      // the card is born ALREADY with the real name, no "tool" placeholder
      settleSentLoader();
      hideExtensionsBlock();
      {
        const tc = action.toolCall;
        if (tc.name) {
          // new ask_user tool: reset the counter — the cards split at the
          // first select (the args arrive with the deltas, not here)
          if (tc.name === "ask_user") {
            askUserQuestionCounter = 0;
            currentAskUserToolId = "";
          }
          const card = ensureToolCard(tc.name);
          // the timer starts AS SOON AS the card is born (args generation
          // included), not at tool_execution_start: while the diff counters
          // scroll the timer already runs. startToolTimer is idempotent (the
          // second start at execution_start is a no-op) and stopToolTimer at
          // execution_end freezes it.
          startToolTimer(card);
          // new tool: reset the args of the previous tool (multi-tool)
          toolsText = "";
          if (toolsPre) toolsPre.textContent = "";
          renderToolHeader(
            card.querySelector(".tool-name")!,
            toolSummary(tc.name, "", workspacePath ?? undefined),
          );
          // write/edit: EMPTY args span already now — without it, during
          // streaming the diff badge (flex:0) stays attached to the name on
          // the left; the args (flex:1, even empty) push it right before the
          // timer, like at execution end
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
      // write: LIVE line counter — here the deltas REALLY scroll (the
      // content is long) and the number rises in real time. The edits NO
      // (args in bursts): for them only the exact diff at execution end stays.
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
        // ask_user: the row shows the question/answer (split cards or answer
        // from the inline dialog) — do NOT overwrite it with the args at tool_call_end
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
        // write: pi does NOT return the diff (only "wrote X bytes") — the +N
        // of the written lines is computed by the webview from the content in
        // the args. Fallback on toolsText (raw JSON from the deltas): sometimes
        // the tool_call arrives with args wrapped as a string (stringify of a
        // string) and the regex on the content does not match.
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
    case "system_note":
      // one box per level (error/warn/info), like the terminal console
      addSystemBox(action.level, action.text);
      break;
    default:
      break;
  }
}

// strip terminal escape sequences (OSC/CSI: colors, titles, notify…) plus
// stray control chars — the terminal protocol pi writes must not reach the
// chat as garbage. Also strips UNTERMINATED OSC (sequence cut by the line
// split before its BEL) and stray BEL bytes.
function cleanConsoleText(text: string): string {
  return stripAnsi(text)
    .replace(/\u001b\][^\u0007\u001b]*$/g, "") // unterminated OSC tail
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

// "Error: 503: {\"type\":\"server_error\",\"message\":\"…\"}" →
// "503 Server error: …" — parse the provider error JSON and render it
// readable: <code> <type with spaces and capitalized>: <message>
function formatProviderError(text: string): string {
  // the JSON blob can be anywhere: `500: {…}`, `Error: 500: {…}` or embedded
  // in a longer line like `Retrying (1/3) in 2.0s — 500: {…}` → take the
  // first {...} span and try to parse it
  const start = text.indexOf("{");
  if (start < 0) return text;
  const end = text.lastIndexOf("}");
  if (end <= start) return text;
  let data: { type?: unknown; message?: unknown };
  try {
    data = JSON.parse(text.slice(start, end + 1)) as {
      type?: unknown;
      message?: unknown;
    };
  } catch {
    return text;
  }
  if (typeof data.message !== "string" || data.message === "") return text;
  // type: capitalized, underscores → spaces ("rate_limit" → "Rate limit")
  const type =
    typeof data.type === "string"
      ? data.type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
      : "";
  const formatted = type ? `${type}: ${data.message}` : data.message;
  // keep what comes before the JSON (code and/or retry info): `500`,
  // `Retrying (1/3) in 2.0s — 500`, … → `… . <Type>: <message>`
  const prefix = text
    .slice(0, start)
    .replace(/[\s:—–-]+$/, "") // trailing separators before the JSON
    .replace(/^Error:\s*/, ""); // avoid a doubled "Error:"
  return prefix ? `${prefix}. ${formatted}` : formatted;
}

// system box with a level: one per error/warn/info, styled by class
// (.level-error / .level-warn / .level-info). Prefix marker via CSS.
function addSystemBox(level: "error" | "warn" | "info", text: string): void {
  const clean = formatProviderError(cleanConsoleText(text));
  if (!clean) return;
  // during a session load every log line goes UNDER the spinner (collected
  // and flushed at the END of the resumed chat) — never into the thread that
  // the history render will reset anyway
  if (sessionLoading) {
    pushLoadingLog(level, clean);
    return;
  }
  const wrapper = addMsg("status");
  const line = document.createElement("div");
  line.className = `status-line level-${level}`;
  line.textContent = clean;
  line.title = clean;
  wrapper.appendChild(line);
  scrollToBottom();
}

// OSC 777 notify events received by the webview (debug: double-check)
let webviewNotifyCount = 0;

// browser notifications (standalone/piw) ---------------------------------
// pi's OSC 777 notify → real browser notification, only when the window is
// hidden (the user is looking elsewhere); when focused nothing is shown (the
// chat itself is the notification, like pi.dev).
let browserNotifyLastAt = 0;
function browserNotifyThrottled(fn: () => void): void {
  const now = Date.now();
  if (now - browserNotifyLastAt < 2000) return;
  browserNotifyLastAt = now;
  fn();
}
// request the notification permission on the FIRST user gesture (click/key):
// browsers reject/ignore requestPermission from a hidden/non-gesture context
let permissionRequested = false;
function requestNotifyPermission(): void {
  if (permissionRequested || !("Notification" in window)) return;
  permissionRequested = true;
  if (Notification.permission === "default") {
    void Notification.requestPermission().catch(() => {
      /* prompt unavailable: keep silent */
    });
  }
}
document.addEventListener("pointerdown", requestNotifyPermission, { once: true });
document.addEventListener("keydown", requestNotifyPermission, { once: true });

function handlePiNotify(title: string, body: string): void {
  // the EFFECTIVE notifications setting decides (per-session override first,
  // then the default; browser offers desktop/off only)
  if (effectiveNotifications() === "off") return;
  if (document.visibilityState !== "hidden" && document.hasFocus()) return;
  const showBox = () => addSystemBox("info", title ? `${title} — ${body}` : body);
  if (!("Notification" in window)) {
    // no Notifications API (insecure context etc.): never lose the info
    showBox();
    return;
  }
  const show = () =>
    browserNotifyThrottled(() => {
      try {
        // Chrome shows the origin as header (not changeable); the body carries
        // the app prefix + localized reason, then the message on a new line.
        // icon: served from dist/web/icon.png (copied at build time)
        new Notification("", {
          body: `π pi-webview - ${t("notifyTaskDone")}\n${body}`,
          icon: runtime.isVsCode ? undefined : "/icon.png",
        });
      } catch {
        showBox(); // creation failed: fall back to the chat box
      }
    });
  if (Notification.permission === "granted") show();
  else if (Notification.permission === "default") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") show();
      else showBox(); // denied: never lose the info
    });
  } else {
    showBox(); // denied previously: never lose the info
  }
}

function addStatusLine(text: string): void {
  const wrapper = addMsg("status");
  const line = document.createElement("div");
  line.className = "status-line";
  line.textContent = text;
  wrapper.appendChild(line);
  // NOTE: addMsg detaches BEFORE the box exists (empty wrapper): the
  // multiline content makes it grow after → re-scroll here, otherwise the
  // box stays cut under the visible bottom ("almost at the bottom but not quite")
  scrollToBottom();
}

// card for messages INJECTED from another session (custom role, e.g.
// session-control): collapsible like the tools (<details>) — ONE row with
// ellipsis closed, click to expand, markdown rendered inside
function buildSessionCard(customType: string, text: string): HTMLElement {
  const d = document.createElement("details");
  d.className = "session-card";
  const s = document.createElement("summary");
  const tag = document.createElement("span");
  tag.className = "session-tag";
  tag.textContent = customType;
  const preview = document.createElement("span");
  preview.className = "session-preview";
  preview.textContent = text; // CSS: nowrap + ellipsis → one row
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
    // editor panel: selection block DISABLED (panel focus clears the
    // active-editor context → showing it would be confusing)
    if (panelMode) return;
    if (evt.type === "selection_changed") {
      // dedicated block (one row, like the steering): appears with the selection
      const n = evt.ranges?.length ?? 0;
      const base = evt.filePath?.split(/[\\/]/).pop() ?? evt.filePath ?? "?";
      els.selectionPanel.textContent = `${t("selection")}: ${base} (${n})`;
      els.selectionPanel.title = `${t("selection")}: ${evt.filePath ?? "?"} — ${n} ${t("ranges")}`;
      const wasHidden = els.selectionPanel.hidden;
      els.selectionPanel.hidden = false;
      if (wasHidden) scrollToBottom(true); // the block covers the last message
    } else {
      els.selectionPanel.hidden = true;
    }
    return;
  }
  if (evt.type === "at_mentioned") {
    addStatusLine(`@ ${evt.filePath ?? "?"}`);
  }
}

// --- history (after session switch / at first load) ------------------------

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

// faithful history: text, thinking and CARDS of the used tools (like the live view)
function renderHistory(messages: unknown[]): void {
  els.thread.textContent = "";
  toolCardsById.clear();
  clearToolTimers();
  toolOutputPre.clear();
  toolStartTimes.clear();
  askUserInfoByTool.clear();
  askUserQuestionCounter = 0;
  currentAskUserToolId = "";
  // timestamp of the last processed message (to estimate the thinking
  // duration: gap from the previous message to the current assistant message)
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
      // message injected from another session (session-control send):
      // collapsible card like the tools, also in history (otherwise it
      // would disappear on reload)
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
      // estimated thinking duration: gap from the previous message (last
      // processed — user or toolResult) to the timestamp of this one
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
          // same construction as the runtime; args can be a JSON string or an object
          const raw = b.arguments;
          const argsJson = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
          const card = buildToolCard({
            id: b.id ?? "",
            name: b.name,
            args: argsJson,
          });
          // registers the card by id: the next toolResult appends its
          // result (same display as the runtime)
          if (b.id) toolCardsById.set(b.id, card);
          if (b.id && assistantTs > 0) toolStartTimes.set(b.id, assistantTs);
          // ask_user with N questions → N cards (header = question, then answer)
          if (b.name === "ask_user" && b.id) {
            const questions = parseAskUserQuestions(argsJson);
            if (questions && questions.length > 0) {
              const cards = splitAskUserCard(card, b.id, questions);
              toolCards.push(...cards);
              continue;
            }
          }
          // write: +N lines (pi does not save the diff → computed from the args)
          if (b.name === "write") {
            renderWriteLines(card, writeLinesFromArgs(argsJson));
          }
          toolCards.push(card);
        }
      }
      const text = textParts.join("\n").trim();
      if (!text && thinkingCards.length === 0 && toolCards.length === 0) continue;
      const wrapper = addMsg("assistant");
      // 3px aggregation evaluated at creation: the message starts with
      // thinking/tool (thinking present, or only tools without text) and the
      // previous one ends with thinking/tool
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
      // order like in live: thinking → text → tool cards
      for (const c of thinkingCards) wrapper.appendChild(c);
      if (text) {
        const md = document.createElement("div");
        md.className = "md";
        md.innerHTML = renderMarkdown(text);
        enhanceCodeBlocks(md);
        wrapper.appendChild(md);
      }
      for (const c of toolCards) wrapper.appendChild(c);
      // failed turn (provider error): the session entry keeps the error —
      // surface it in history too (terminal parity)
      const errMsg =
        (msg as { errorMessage?: unknown }).errorMessage ??
        (msg as { message?: { errorMessage?: unknown } }).message?.errorMessage;
      if (typeof errMsg === "string" && errMsg.length > 0) {
        addSystemBox("error", errMsg);
      }
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
        // ask_user: distribute the result per question (header → answer,
        // segment in the body) and timer on ALL the cards — final state at resume
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
    if (ts > 0) lastTs = ts; // base for the next thinking duration
  }
  const main = els.messages;
  main.scrollTop = main.scrollHeight;
}

// --- "back to bottom" button ------------------------------------------------

// beyond this margin from the bottom the button to go back down appears
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
// images loaded late (markdown) grow the content after the scroll:
// if the user is following, realign on load
els.thread.addEventListener(
  "load",
  (e) => {
    if (e.target instanceof HTMLImageElement && stickToBottom) {
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  },
  true,
);

// narrower window → native CSS ellipsis on the badge (no JS)

// click on gauge/context label: if a compaction IS running asks whether to
// stop it, otherwise the normal confirmation. NOTE: stopping the compact is
// not possible via RPC today (abortCompaction is only in-process in the TUI)
// → at the confirmation the honest outcome is shown with the pi-core gap reference.
els.statsCtx.addEventListener("click", () => {
  if (compacting) {
    void showConfirm(t("compactStopAsk")).then((ok) => {
      if (ok) {
        // no RPC to abort the compact: informative block (pattern of
        // unimplemented commands) until the core exposes abort_compaction
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

// --- session compaction ------------------------------------------------------
// At the confirmation: gauge in loading (spin), composer locked (working,
// like while waiting for a response) and in chat a status block with
// spinner + running seconds. At the end the block stays with "Compacted"
// and the elapsed seconds (same pattern as the sent-loader).

let compacting = false;
let compactWrapper: HTMLElement | null = null;
let compactTimerEl: HTMLElement | null = null;
let compactStartedAt = 0;
let compactClock: ReturnType<typeof setInterval> | null = null;

function showCompactionBlock(): void {
  if (compacting) return;
  compacting = true;
  working = true; // composer guard: no sends during the compaction
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
  els.ctxGauge.classList.add("loading");
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
    if (spinner) spinner.remove(); // only text + elapsed seconds remain
    if (label) {
      label.textContent = error ? t("compactionError") : t("compacted");
      label.classList.toggle("error", error);
      if (errMsg) (label as HTMLElement).title = errMsg; // technical detail on hover
    }
  }
  compactWrapper = null;
  compactTimerEl = null;
  // ALWAYS restore: the compact aborts the current turn, so the client's
  // working state could have stayed dirty (no agent_settled)
  working = false;
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
  els.ctxGauge.classList.remove("loading");
  void fetchSessionStats(); // the gauge updates (reset after compact)
}

// from the gauge/label click: shows the block and sends the compact RPC
// NOTE: no timeout (the compact can take tens of seconds); the outcome
// arrives from the compaction_end event (real outcome) or from the response
function startCompactionFromUi(): void {
  if (compacting) return;
  // if there is an in-flight turn, pi will interrupt it (compact aborts): first
  // bring the steering back into the editor (dequeue), then compact
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

// --- user actions -----------------------------------------------------------

// --- send/stop button and info boxes (model, credit, trust) -----------------

let working = false;
// INTENTIONAL pi restart in progress (Apply CLI flags): the send stays disabled
let piRestarting = false;
// webview in an editor panel (not sidebar): the selection block is disabled
let panelMode = false;
let modelInfoText = "";
let creditText = ""; // pi does not expose the remaining credit: stays empty until available
let creditBalance = 0; // numeric balance (for the chip color threshold)
let creditCurrency = "$"; // provider currency symbol (for the session cost)
let sessionCost = 0; // total session cost from get_session_stats (pi core)

// --- steering (plan 0004) ---------------------------------------------------
// SHADOW queue in the webview (editable via dequeue, only the text is
// persisted) + delivery via the native pi queue (pi.dev semantics): during
// streaming a prompt(streamingBehavior:"steer") is sent at the delivery
// point (turn_end), from idle a normal prompt (agent_settled).
interface QueuedMessage {
  id: string;
  text: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
}
let steerShadow: QueuedMessage[] = []; // to deliver (dequeue brings it back to the editor)
let steerPending: QueuedMessage[] = []; // sent to pi, waiting for injection
let steerSeq = 0;
let steeringMode: "one-at-a-time" | "all" = "one-at-a-time";
let thinkingLevel = "";
let currentModel: { provider?: string; name?: string; id?: string } | null = null;

function updateSendButton(): void {
  // the button is ALWAYS Send (never STOP anymore): while processing it takes
  // a different highlight (.working class) and Enter queues (steering); the
  // STOP lives in the thinking block (plan 0004). During the pi restart
  // (Apply CLI flags) it is disabled.
  els.send.innerHTML = sendIcon();
  els.send.title = working ? t("steerSendHint") : t("send");
  els.send.classList.toggle("working", working);
  els.send.disabled = piRestarting;
}

function renderModelInfo(): void {
  // order: provider BEFORE the model. At narrow widths (container
  // query) the provider and then the name disappear; the " · " separators
  // are CSS (.model-name::before) so no orphan dots remain.
  // The balance is NOT here anymore: it lives in the separate #balance-chip.
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

// balance thresholds (like the pi.dev convention): green when normal,
// yellow when low, red when almost exhausted. Theme colors (--ok/
// --warn/--err), never hard-coded.
function balanceTone(balance: number): "ok" | "warn" | "low" {
  if (balance >= 5) return "ok"; // normal → green
  if (balance >= 1) return "warn"; // low → yellow
  return "low"; // almost exhausted → red
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
  // session cost / balance: the COLOR lives ONLY on the balance, cost and
  // slash stay muted (and disappear together under 600px)
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

// numeric balance separated from the formatted text (for the color threshold)

// thinking icon color by level: linear hue scale
// green (off) → yellow (medium) → red (max), with the intermediate tones
function thinkingColor(level: string): string {
  const order = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const idx = order.indexOf(level);
  if (idx < 0) return "";
  const t = idx / (order.length - 1); // 0..1
  const hue = Math.round(140 - t * 140); // 140 = green, 70 = yellow, 0 = red
  return `hsl(${hue} 65% 58%)`;
}

function renderThinkingInfo(): void {
  // thinking icon (chat) always visible, colored by level; label
  // hidden <600, value hidden <340 (container query)
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
    // the value has the same color as the icon (like the trust)
    if (color) value.style.color = color;
    els.thinkingInfo.append(label, value);
    els.thinkingInfo.title = `${t("thinkingLevel")}: ${translateThinkingLevel(thinkingLevel)}`;
  }
}

// translation of the pi thinking levels (model strings)
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
  // Material icons: shield (ask) · empty alert triangle (limited) · filled (full)
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

// --- popover for the toolbar chips (model, thinking, trust) -----------------

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
  // text color for the row (e.g. thinking levels)
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
  // with tone (trust): "✓" sign on the active item
  m.textContent = tone ? (active ? "✓" : "") : meta;
  btn.append(lbl, m);
  btn.addEventListener("click", (e) => {
    // the menu lives inside the anchor button: without stop the click would
    // bubble up to the button, which would reopen the popover right after the close
    e.stopPropagation();
    closePopover();
    onClick();
  });
  menu.appendChild(btn);
}

function openPopover(anchor: HTMLElement, build: (menu: HTMLElement) => void): void {
  // toggle: clicking the same button again closes
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

  // The menu is absolute inside the chip: with `left: 0` a chip near the right
  // edge would push the menu out of the viewport (body scrollbar). Here we
  // measure and ALWAYS keep the popover inside the screen, moving/resizing it;
  // the reclamp also follows the resizes.
  const VIEWPORT_MARGIN = 8;
  const OPEN_GAP = 6; // uguale al calc(100% + 6px) del CSS
  const clampPopover = (): void => {
    const aRect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // --- horizontal: inside the viewport, preferably aligned to the anchor ---
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
    // --- vertical: prefers to open upward, otherwise below ---
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
    // search: field on top, the list updates as soon as at least
    // one letter is typed (filter on name, id and provider, case-insensitive)
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
              renderAttachments(); // the chips update thumbnail ↔ file icon
              void fetchSessionStats(); // context window of the new model
              void fetchBalance(); // balance of the new provider
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
    // the menu lives INSIDE the button: without these precautions a click on
    // the field would close the popover (button toggle) and the button would
    // steal the focus from the input (default mousedown)
    search.addEventListener("mousedown", (e) => e.preventDefault());
    search.addEventListener("click", (e) => {
      e.stopPropagation();
      search.focus();
    });
    render("");
  });
  // immediate focus on the search field (if the popover opened)
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
        thinkingColor(lvl), // level color in the dropdown
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
          // full access is dangerous: confirmation modal (not window.confirm)
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

// --- confirmation modal (same behavior in browser and VS Code webview) -------

// lightbox: enlarged attached image (outside click or ESC to close)
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
  // processing (or compaction) in progress → STEERING: the message enters
  // the local queue (dequeue brings it back to the editor), never auto-abort
  if (working || compacting) {
    submitSteering();
    return;
  }
  const text = els.input.value.trim();
  if (!text && attachments.length === 0) return;
  if (text) pushMessageHistory(text);
  const wrapper = addMsg("user");
  // attachments BEFORE the text: images in grid (click → lightbox), then files
  const imageAtts = modelSupportsVision
    ? attachments.filter((a) => a.mimeType.startsWith("image/") && a.dataBase64)
    : [];
  const fileAtts = attachments.filter((a) => !imageAtts.includes(a));
  if (imageAtts.length > 0) {
    const grid = document.createElement("div");
    grid.className = "chat-image-grid";
    // single image: bigger cell, no aggressive crop
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
  // inline images only if the model is vision; otherwise (and for files) the path
  const inlineImages = imageAtts.map((a) => ({
    type: "image" as const,
    data: a.dataBase64!,
    mimeType: a.mimeType,
  }));
  const fileMentions = fileAtts.map((a) => `[attachment: ${a.path}]`);
  // the text goes AFTER the attachments
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
  // send loader: spinner + timer until the first response arrives
  showSentLoader(wrapper);
  // slash command sent: after the user bubble is in chat, signal that
  // the extension commands need a pi.dev core change
  if (message.trim().startsWith("/")) notifyCmdNotImplemented();
  // at send completion (bubble + attachments + badge) ALWAYS go to the bottom:
  // the old forced scroll before the bubble was not enough — the content
  // added after left it above, and the "smart" follow then believed the
  // user had scrolled (dist > margin) and did not move anymore
  scrollToBottom(true);
  armExtensionsBlock(); // "Extensions" block if the first output takes > 3s
  els.input.value = "";
  resetInputHeight();
  clearAttachments();
  els.input.focus();
}

// --- steering: local queue + panel (plan 0004) ------------------------------

// Enter during processing/compaction: enqueue into the shadow queue.
// The images travel in memory (only text persisted); the files stay as
// [attachment: path] mentions in the text.
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
  // only the text survives the reload (the images no: too heavy)
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

// textarea placeholder: signals that Enter queues during processing
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

// panel between thread and composer: shows the messages STILL to send (shadow
// queue, normal style) and those ALREADY delivered to pi but not yet injected
// (steerPending: muted style + spinner, NOT dequeuable anymore — the pi queue
// cannot be mutated via RPC). As soon as pi processes them (message_start)
// they disappear.
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
  // the panel takes space between chat and composer: brings the chat to the
  // bottom so the last message does NOT stay hidden under the panel
  if (wasHidden) scrollToBottom(true);
  // header: title with count + dequeue
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
  // only the NOT-yet-sent messages return to the editor: the in-flight ones
  // are already in pi's hands and cannot be recovered
  dequeue.title = t("steerDequeueHint");
  dequeue.disabled = steerShadow.length === 0;
  dequeue.addEventListener("click", () => dequeueSteering());
  head.appendChild(dequeue);
  panel.appendChild(head);
  // INSERTION ORDER PRESERVED: shadow and in-flight queues merged by sequence
  // (id st-N) — msg1 (in flight) stays in its place, msg2, msg3 below
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

// dequeue (parity with pi.dev Alt+↑): brings ALL the to-send messages back
// into the editor (joined), empties the shadow queue. The items already sent
// to pi do not.
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

// delivery at pi.dev's point: streaming → prompt with streamingBehavior "steer"
// (pi injects after the turn's tool calls, before the next LLM call);
// idle (agent_settled) → normal prompt. Mode: one-at-a-time / all.
function deliverSteering(): void {
  if (steerShadow.length === 0) return;
  if (compacting) return; // during the compaction no delivery: compaction_end handles it
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
        // ok: stays in steerPending until message_start/queue_update removes it
      })
      .catch(() => {
        // preflight error: back to the queue (if not already injected)
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

// reconciliation with the native pi queue: NOT shown anymore — when a
// message is delivered it immediately disappears from the box. Only the
// internal cleanup stays (message_start removes the delivered item and
// shows the bubble in chat).

// the "in-flight" items stuck when pi is idle: pi queued them (steer arrived
// after the turn's continuation check) but NEVER starts a turn to inject them
// (the pi steer queue is drained only at the start of the next turn). If pi
// now no longer has them in the queue (pendingMessageCount 0) they are
// lost/discarded → they return to the shadow queue and are relaunched as
// NORMAL prompts (idle → pi processes them right away, no duplicates because
// pi does not have them).
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
      deliverSteering(); // idle → normal prompts → processed right away
    }
  } catch {
    // timeout / error: leave it, the next occasion retries
  }
}

// user message injected by pi (message_start user role): if it was an item in
// steerPending it is removed and shown in chat (it was not optimistic); if it
// is the normally sent message it is already rendered → no extra bubble.
function handleUserMessageStart(evt: RpcEvent): void {
  const content = (evt as { message?: { content?: unknown } }).message?.content;
  const text = extractTextContent(content);
  // cleans from BOTH queues: the delivered item can be in
  // steerPending (waiting for injection) or have returned to steerShadow
  const pIdx = steerPending.findIndex((m) => m.text === text);
  const sIdx = steerShadow.findIndex((m) => m.text === text);
  if (pIdx >= 0) steerPending.splice(pIdx, 1);
  if (sIdx >= 0) steerShadow.splice(sIdx, 1);
  if (pIdx < 0 && sIdx < 0) return;
  persistSteerQueue();
  renderSteerPanel();
  // real user bubble (the steering had not been shown optimistically)
  const wrapper = addMsg("user");
  const bubble = document.createElement("div");
  bubble.className = "bubble user";
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  scrollToBottom();
}

// --- thinking/tool block aggregation (3px) ---------------------------------
// Rules: 1) CONSECUTIVE thinking and tool blocks → 3px gap; 2) after a
// thinking/tool, if the next is NOT thinking/tool → 14px gap.
// Evaluated as soon as the message's first block materializes (never
// retroactive): no jumps.
function msgEndsWithThinkTool(msg: Element): boolean {
  const last = msg.lastElementChild;
  if (!last) return false;
  if (last.classList.contains("tool-card")) return true;
  // thinking slot as last child: counts only if it contains the card
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

// applies the 3px gap (14 − 11) if the previous message ends with
// thinking/tool and the current starts with thinking/tool
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

// the message starts with the tool only if there is no thinking nor text
// before. NOTE: the first child is ALWAYS the thinking slot (even empty)
// → here the chain must be set DIRECTLY, without going through
// msgStartsWithThinkTool.
function applyToolChainIfToolFirst(): void {
  if (!currentMsg) return;
  if (currentMsg.querySelector(".thinking-card")) return;
  if ((currentText?.textContent ?? "").trim().length > 0) return;
  const prev = currentMsg.previousElementSibling;
  if (prev?.classList.contains("msg") && msgEndsWithThinkTool(prev)) {
    setToolChain(currentMsg);
  }
}

// --- slash command palette (plan 0003): ONLY extension commands -------------
interface SlashCommand {
  name: string; // without the leading "/"
  description?: string;
}
let slashCommands: SlashCommand[] = [];
let cmdOpen = false;
let cmdSelected = 0;
let cmdMatches: SlashCommand[] = [];

// extension command list from get_commands (source "extension"), fetched at
// boot and lazily at the first "/" (the list can change with the extensions)
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
    // pi not ready yet: stays empty; the lazy fetch retries at the next "/"
  }
}
let cmdSeq = 0;

// closes the dropdown (without touching the text)
function closeCmdDropdown(): void {
  cmdOpen = false;
  els.cmdDropdown.hidden = true;
}

// filtering + render: the command is the first token (before the space); if
// the user is already typing arguments (space) the command is chosen → closed
function updateCmdDropdown(): void {
  const raw = els.input.value;
  if (!raw.startsWith("/")) {
    closeCmdDropdown();
    return;
  }
  const firstSpace = raw.indexOf(" ");
  if (firstSpace !== -1) {
    closeCmdDropdown(); // args in progress: the extension handles the rest
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

// pi-core issue link (empty until we open the upstream issue):
// when set, the "not yet implemented" block shows it
const PI_CORE_ISSUE_URL = "";

// informative block: the extension command requires the pi.dev core support
// (ui.custom) not yet available — see docs/issues/pi-core
function notifyCmdNotImplemented(): void {
  const link = PI_CORE_ISSUE_URL ? `\n${PI_CORE_ISSUE_URL}` : "";
  addStatusLine(`${t("cmdNotImplemented")}${link}`);
}

// accepts the selected command: fills the composer with "/name " (space
// for possible subcommands) and closes the dropdown — NO send.
// The extension commands require the pi.dev core (ui.custom): it is
// signaled right away with an informative block.
function acceptCmd(name: string): void {
  els.input.value = `/${name} `;
  const len = els.input.value.length;
  els.input.setSelectionRange(len, len);
  closeCmdDropdown();
  els.input.focus();
}

// exploratory palette (Ctrl+K): modal with search, Enter/click fills the
// composer; Esc/outside click closes
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

// --- attachments (paste of real files and images) ---------------------------

interface PendingAttachment {
  path: string;
  name: string;
  mimeType: string;
  dataBase64?: string; // present only for images (preview + inline send)
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
    // thumbnail only for vision models; otherwise file icon (no blob)
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
    reader.onerror = () => reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

// --- client-side image compression -------------------------------------------

const MAX_IMAGE_EDGE = 1024; // px: max side after the downscale
const MAX_IMAGE_BYTES = 150 * 1024; // below this threshold we do not recompress
const IMAGE_QUALITY = 0.8; // JPEG/WebP

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

// Detects the alpha channel by sampling (8px step) the resized canvas.
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const step = 8;
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * step) {
    if ((data[i] ?? 255) < 255) return true;
  }
  return false;
}

// Compresses the pasted/dropped images BEFORE saving and sending:
// downscale to max 1024px + JPEG q0.8 (PNG if there is transparency). The
// base64 blob pi saves in the session drops from MB to ~50-150KB, so pi's
// re-sends at every turn stay small and fast. GIF and already small images:
// unchanged.
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
      // we keep the base64 only for the images (preview + inline send if vision)
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
  // pasted text: no manipulation — the browser default paste inserts it
  // unchanged (the paths stay text, never converted to attachments)
});

// --- drag & drop: the whole window is a drop zone with overlay -----------------

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
// new chat in another panel: handled by the companion (only in the IDE;
// standalone the request falls into the void and the UI stays as is)
// new chat: in the IDE the companion handles it (new webview); standalone
// opens a NEW BROWSER TAB with a new session (plan 0005)
els.newChat.addEventListener("click", () => {
  if (runtime.isVsCode) {
    void ideRequest({ type: "openNewChat" });
  } else {
    window.open(location.origin + "/?new=1", "_blank");
  }
});

// --- message history (↑/↓ with empty input) ----------------------------------
// The placeholder shows the last sent message; TAB inserts it in the box,
// ESC returns to the standard placeholder. The standard placeholder
// suggests ↑/↓ when the history exists.

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
let historyIndex = -1; // -1 = no preview

function setStandardPlaceholder(): void {
  // during processing the placeholder signals the steering (Enter queues)
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
    // localStorage unavailable: history only in memory
  }
  setStandardPlaceholder();
}

// seeds the history from the user messages of the loaded session (once
// per webview session), so ↑ works also after the resume
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
  // slash command autocomplete (plan 0003): when the dropdown is open,
  // the arrows navigate, Enter/Tab accept (never send/steering), Esc closes
  // (never STOP)
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
      e.stopPropagation(); // do NOT trigger STOP
      closeCmdDropdown();
      return;
    }
  }
  // Enter ALWAYS possible: during processing it queues (steering),
  // from idle it sends right away. Shift+Enter = new line.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendOrStop();
    return;
  }
  // ↑ with empty input → navigate the history (only if it exists)
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

// typing during the preview returns to the normal flow
els.input.addEventListener("input", () => {
  if (historyIndex >= 0) exitHistoryPreview();
  updateCmdDropdown();
  autogrowInput(); // UNA riga di default → cresce di una riga alla volta fino a 5
});

// --- autogrow input: ONE line by default (32px), max 5 lines (line-height 21 +
// padding 15 → max 120px; font 14px like the chat) ------------------------
const INPUT_MAX_HEIGHT = 120;
function autogrowInput(): void {
  const el = els.input;
  // NEVER "auto": with the CSS max-height the box inflates to the max right
  // away. Measure from 0px so scrollHeight reflects the real content →
  // line-by-line growth.
  el.style.height = "0px";
  el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + "px";
}
function resetInputHeight(): void {
  els.input.style.height = "";
}

// palette command: Ctrl+K (or Meta+K on macOS)
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCmdPalette();
  }
});

// the working state comes from the pi events
function trackWorking(evt: RpcEvent): void {
  if (evt.type === "agent_start") {
    working = true;
    // an agent run is part of the extension work at resume: the loading
    // overlay must not end while it is active
    loadingAgentActive = true;
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(true);
  } else if (evt.type === "agent_settled") {
    working = false;
    loadingAgentActive = false;
    // extension run finished: re-evaluate the loading end (quiet + idle)
    if (sessionLoading) armLoadingQuiet();
    settleSentLoader(); // without a response: freeze the waited time anyway
    hideExtensionsBlock();
    // stops the tool timers left active (e.g. tool ABORTED by STOP:
    // no tool_execution_end → the timer would run forever)
    clearToolTimers();
    void fetchSessionStats(); // context/token updated at turn end
    void fetchBalance(); // the balance changes after the usage
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(false);
    // at turn end pi may have assigned a name to the session (auto-title)
    void refreshSessionTitle();
    // steering: from idle the next queued message is delivered
    deliverSteering();
    // steering: reconcile the stuck "in-flight" items (pi idle no longer
    // has them in the queue → lost/discarded → back to the shadow queue
    // and relaunch)
    void reconcileStuckPending();
  }
}

els.connectBtn.addEventListener("click", () => {
  const url = els.connectUrl.value.trim();
  if (url) void connect(url);
});

// --- demo (dev): sample conversation, no connection ---------------------------

function renderDemo(): void {
  const user = addMsg("user");
  const ub = document.createElement("div");
  ub.className = "bubble user";
  ub.textContent = t("demoUser");
  user.appendChild(ub);

  const asst = addMsg("assistant");

  // thinking BEFORE the text (collapsed by default)
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

// --- startup -----------------------------------------------------------------

// immediate theme/strings init (at module scope): in the VS Code webview
// without this the text would stay with the default color (black on the IDE bg)
applyTheme(themePref);
applyUiStrings();

async function boot(): Promise<void> {
  if (demoMode) {
    renderDemo();
    hideBootLoader();
  }
  // runtime mode: inside an IDE (e.g. VS Code webview) postMessage is used,
  // standalone the WebSocket bridge (src/web/environment.ts)
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
