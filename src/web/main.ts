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
  StartupInfo,
  ThinkingSettings,
  PiSetting,
  PiSettingsResult,
  PiModelSettingValue,
  TrustOptionId,
  TrustResult,
  ImageContent,
  BrowserPageContext,
  SessionSettings,
} from "../ide/protocol.ts";
import { rpc } from "../ide/protocol.ts";
import {
  normalizeBrowserElementSelector,
  normalizeBrowserPageActions,
  type BrowserPageAction,
  type BrowserPersistentPermissions,
  type BrowserToolOperation,
  type BrowserToolPayload,
} from "../ide/browser-tools.ts";
import { samePath } from "../ide/paths.ts";
import {
  displayMessageContent,
  historyToolResultContent,
  hasPresentedContent,
  imageContentBlocks,
  imageDataUrl,
  imageDownloadName,
  toolExecutionEndContent,
  type DisplayMessageContent,
  type PresentedContentItem,
} from "../ide/content-blocks.ts";
import {
  createWsTransport,
  createVsCodeTransport,
  createWebView2Transport,
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
import type {
  StatsBarPosition,
  ThemePreference,
  UpdateAvailable,
} from "../ide/protocol.ts";
import {
  normalizeSpeechToTextConfig,
  type SpeechInputMode,
  type SpeechToTextConfig,
} from "../ide/speech-config.ts";
import { currentLocale, setLocale, t, tpl, isLocaleId, type LocaleId } from "./i18n.ts";
import { runtime } from "./environment.ts";
import {
  SESSION_HISTORY_TIMEOUT_MS,
  SESSION_SWITCH_TIMEOUT_MS,
  sessionPickStrategy,
  sessionSwitchOutcome,
} from "./session-routing.ts";
import { thinkingPaintDecision } from "./thinking-render.ts";
import {
  browserToolPermissionGranted,
  browserToolPermissionOrigin,
  grantBrowserPersistentPermission,
  grantBrowserSessionPermission,
  normalizeBrowserPermissionOperations,
  normalizeBrowserPersistentPermissions,
  type BrowserPermissionScope,
} from "./browser-tool-consent.ts";
import {
  formatAskUserQuestion,
  parseAskUserQuestions,
  type AskUserQuestion,
} from "./ask-user.ts";
import { BrowserConnectionError } from "../adapters/browser/connection.ts";
import {
  browserServerSettingDirty,
  settingRecordsEqual,
  settingsApplyNeeded,
} from "./settings-apply.ts";
import {
  connectBrowserPanel,
  getBrowserServerUrl,
  isBrowserExtensionContextInvalidated,
  persistBrowserServerNewSessionIntent,
  persistBrowserServerSession,
  resolveBrowserExtensionBridgeUrl,
  setBrowserServerUrl,
} from "../adapters/browser/runtime.ts";
import { renderMarkdown } from "./markdown.ts";
import { renderAnsiToHtml, stripAnsi } from "./ansi.ts";
import {
  streamedToolFilePath,
  streamedToolPath,
  toolSummary,
  type ToolSummary,
} from "./tool-summary.ts";
import {
  AgenticCountPulse,
  agenticHeaderLabelKey,
  agenticMetricVisualState,
  agenticToolMetric,
  emptyAgenticCounts,
  emptyAgenticMetricProgress,
  transitionAgenticMetricProgress,
  WAITING_RESPONSE_DELAY_MS,
  waitingResponseDelayRemaining,
  waitingResponseRestartAt,
  visibleThinkingContent,
  type AgenticCounts,
  type AgenticItemState,
  type AgenticMetric,
  type AgenticMetricProgress,
} from "./agentic-thinking.ts";
import { clampThinkingLevel } from "./thinking-levels.ts";
import {
  attachBrowserPageContext,
  attachEditorSelectionContext,
  stripEditorSelectionContext,
  type ActiveEditorSelection,
} from "./selection-context.ts";
import {
  pairQueuedAttachments,
  SteeringAttachmentTracker,
  stripRestoredAttachmentMentions,
  type QueuedAttachmentEntry,
} from "./steering-attachments.ts";
import {
  effectiveStatsBarCompact,
  normalizeHiddenStatusKeys,
  setStatusKeyHidden,
} from "./status-preferences.ts";
import {
  bridgeUrlWithPageIntent,
  pageUrlForNewSession,
  pageUrlForSession,
} from "./session-url.ts";
import { ReconnectLoop, RECONNECT_INTERVAL_MS } from "./reconnect.ts";
import { isReleaseReminderMessage } from "./release-reminder.ts";
import {
  isBlockedNpmInstallScriptsUpdate,
  isRemoteNpmDependencyDisabledUpdate,
  updateExecutionOutcome,
  type UpdateExecutionOutcome,
} from "../ide/update-errors.ts";
import { joinCollapseHeaderParts, shouldShowCollapseFooter } from "./collapse-footer.ts";
import { updateShieldVisualState } from "./update-shield.ts";
import {
  transitionComposerActivity,
  type ComposerActivityEvent,
} from "./composer-activity.ts";
import { TrailingToolOutputResolver } from "./tool-output-resolver.ts";
import {
  isKnownSlashCommand,
  normalizeExtensionCommands,
  shouldAttachImplicitEditorContext,
  shouldBlockUnverifiedSlashCommand,
  slashCommandName,
  type SlashCommand,
} from "./slash-commands.ts";
import {
  editArgumentPairs,
  editArgumentPath,
  readArgumentEntries,
  shellArgumentView,
  shellResultExitCode,
  writeArgumentContent,
} from "./tool-arguments.ts";
import { SpeechDraft } from "./speech-draft.ts";
import {
  SpeechController,
  type SpeechCompletion,
  type SpeechControllerState,
  type SpeechMediaDevices,
} from "./speech-controller.ts";
import {
  detectSpeechCapabilities,
  formatSpeechShortcut,
  getLocalSpeechModelAvailability,
  getSpeechMicrophonePermission,
  getSpeechRuntime,
  installLocalSpeechModel,
  localSpeechModelControlState,
  SPEECH_LANGUAGE_CATALOG,
  speechLanguageDisplayName,
  speechShortcutForMode,
  speechShortcutFromKeyboardEvent,
  speechShortcutMatchesEvent,
  systemSpeechLanguage,
  type SpeechCapabilities,
  type SpeechMicrophonePermission,
  type SpeechModelAvailability,
} from "./speech-to-text.ts";
import {
  trustIcon,
  sendIcon,
  microphoneIcon,
  speechWaveformIcon,
  stopIcon,
  attachFileIcon,
  newChatIcon,
  thinkingBlocksIcon,
  arrowUpIcon,
  settingsIcon,
  reloadIcon,
  updateIcon,
  chatIcon,
  folderIcon,
  scrollDownIcon,
  openFileIcon,
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
  sessionSearch: document.getElementById("session-search") as HTMLInputElement,
  sessionItems: document.getElementById("session-items") as HTMLDivElement,
  settingsBtn: document.getElementById("btn-settings") as HTMLButtonElement,
  reload: document.getElementById("btn-reload") as HTMLButtonElement,
  updatePi: document.getElementById("btn-update-pi") as HTMLButtonElement,
  updateModal: document.getElementById("update-modal") as HTMLDivElement,
  updateModalTitle: document.getElementById("update-modal-title") as HTMLSpanElement,
  updateModalDesc: document.getElementById("update-modal-desc") as HTMLParagraphElement,
  updateList: document.getElementById("update-list") as HTMLDivElement,
  updateClose: document.getElementById("btn-update-close") as HTMLButtonElement,
  updateCancel: document.getElementById("btn-update-cancel") as HTMLButtonElement,
  updateConfirm: document.getElementById("btn-update-confirm") as HTMLButtonElement,
  settingsModal: document.getElementById("settings-modal") as HTMLDivElement,
  settingsClose: document.getElementById("btn-settings-close") as HTMLButtonElement,
  settingsModalTitle: document.getElementById("settings-modal-title") as HTMLSpanElement,
  settingsInfoTitle: document.getElementById("settings-info-title") as HTMLDivElement,
  settingsWebviewTitle: document.getElementById(
    "settings-webview-title",
  ) as HTMLDivElement,
  settingsBrowserSection: document.getElementById(
    "settings-browser-section",
  ) as HTMLDivElement,
  settingsBrowserTitle: document.getElementById(
    "settings-browser-title",
  ) as HTMLDivElement,
  settingsBrowserUrlLabel: document.getElementById(
    "settings-browser-url-label",
  ) as HTMLLabelElement,
  settingsBrowserUrl: document.getElementById("settings-browser-url") as HTMLInputElement,
  settingsBrowserUrlNote: document.getElementById(
    "settings-browser-url-note",
  ) as HTMLDivElement,
  settingsBrowserStatus: document.getElementById(
    "settings-browser-status",
  ) as HTMLSpanElement,
  settingsBrowserResetPermissions: document.getElementById(
    "settings-browser-reset-permissions",
  ) as HTMLButtonElement,
  settingsBrowserPermissionsStatus: document.getElementById(
    "settings-browser-permissions-status",
  ) as HTMLSpanElement,
  settingsSpeechSection: document.getElementById(
    "settings-speech-section",
  ) as HTMLDivElement,
  settingsSpeechTitle: document.getElementById("settings-speech-title") as HTMLDivElement,
  settingsSpeechStatus: document.getElementById(
    "settings-speech-status",
  ) as HTMLDivElement,
  settingsSpeechStatusIcon: document.getElementById(
    "settings-speech-status-icon",
  ) as HTMLSpanElement,
  settingsSpeechStatusText: document.getElementById(
    "settings-speech-status-text",
  ) as HTMLSpanElement,
  settingsSpeechControls: document.getElementById(
    "settings-speech-controls",
  ) as HTMLDivElement,
  settingsSpeechDeviceLabel: document.getElementById(
    "settings-speech-device-label",
  ) as HTMLLabelElement,
  settingsSpeechDevice: document.getElementById(
    "settings-speech-device",
  ) as HTMLSelectElement,
  settingsSpeechRefreshDevices: document.getElementById(
    "settings-speech-refresh-devices",
  ) as HTMLButtonElement,
  settingsSpeechDeviceNote: document.getElementById(
    "settings-speech-device-note",
  ) as HTMLDivElement,
  settingsSpeechModeLabel: document.getElementById(
    "settings-speech-mode-label",
  ) as HTMLLabelElement,
  settingsSpeechMode: document.getElementById(
    "settings-speech-mode",
  ) as HTMLSelectElement,
  settingsSpeechPushShortcutLabel: document.getElementById(
    "settings-speech-push-shortcut-label",
  ) as HTMLLabelElement,
  settingsSpeechPushShortcut: document.getElementById(
    "settings-speech-push-shortcut",
  ) as HTMLOutputElement,
  settingsSpeechPushShortcutCapture: document.getElementById(
    "settings-speech-push-shortcut-capture",
  ) as HTMLButtonElement,
  settingsSpeechToggleShortcutLabel: document.getElementById(
    "settings-speech-toggle-shortcut-label",
  ) as HTMLLabelElement,
  settingsSpeechToggleShortcut: document.getElementById(
    "settings-speech-toggle-shortcut",
  ) as HTMLOutputElement,
  settingsSpeechToggleShortcutCapture: document.getElementById(
    "settings-speech-toggle-shortcut-capture",
  ) as HTMLButtonElement,
  settingsSpeechShortcutNote: document.getElementById(
    "settings-speech-shortcut-note",
  ) as HTMLDivElement,
  settingsSpeechLanguageLabel: document.getElementById(
    "settings-speech-language-label",
  ) as HTMLLabelElement,
  settingsSpeechLanguage: document.getElementById(
    "settings-speech-language",
  ) as HTMLSelectElement,
  settingsSpeechModelStatus: document.getElementById(
    "settings-speech-model-status",
  ) as HTMLSpanElement,
  settingsSpeechInstallModel: document.getElementById(
    "settings-speech-install-model",
  ) as HTMLButtonElement,
  settingsSpeechRemoveModel: document.getElementById(
    "settings-speech-remove-model",
  ) as HTMLButtonElement,
  settingsSpeechModelNote: document.getElementById(
    "settings-speech-model-note",
  ) as HTMLDivElement,
  settingsSpeechPauseLabel: document.getElementById(
    "settings-speech-pause-label",
  ) as HTMLLabelElement,
  settingsSpeechPause: document.getElementById(
    "settings-speech-pause",
  ) as HTMLInputElement,
  settingsSpeechCloudLabel: document.getElementById(
    "settings-speech-cloud-label",
  ) as HTMLLabelElement,
  settingsSpeechCloud: document.getElementById(
    "settings-speech-cloud",
  ) as HTMLInputElement,
  settingsSpeechCloudNote: document.getElementById(
    "settings-speech-cloud-note",
  ) as HTMLDivElement,
  settingsNotificationsTitle: document.getElementById(
    "settings-notifications-title",
  ) as HTMLDivElement,
  settingsCliTitle: document.getElementById("settings-cli-title") as HTMLDivElement,
  lang: document.getElementById("lang") as HTMLSelectElement,
  langLabel: document.getElementById("settings-lang-label") as HTMLLabelElement,
  historyInput: document.getElementById("settings-history-limit") as HTMLInputElement,
  historyLabel: document.getElementById("settings-history-label") as HTMLLabelElement,
  agenticThinking: document.getElementById("agentic-thinking") as HTMLInputElement,
  agenticThinkingLabel: document.getElementById(
    "settings-agentic-thinking-label",
  ) as HTMLLabelElement,
  agenticThinkingNote: document.getElementById(
    "settings-agentic-thinking-note",
  ) as HTMLElement,
  allowRemoteNpmUpdates: document.getElementById(
    "settings-allow-remote-npm",
  ) as HTMLInputElement,
  allowRemoteNpmUpdatesLabel: document.getElementById(
    "settings-allow-remote-npm-label",
  ) as HTMLLabelElement,
  allowRemoteNpmUpdatesNote: document.getElementById(
    "settings-allow-remote-npm-note",
  ) as HTMLElement,
  allowNpmInstallScripts: document.getElementById(
    "settings-allow-npm-scripts",
  ) as HTMLInputElement,
  allowNpmInstallScriptsLabel: document.getElementById(
    "settings-allow-npm-scripts-label",
  ) as HTMLLabelElement,
  allowNpmInstallScriptsNote: document.getElementById(
    "settings-allow-npm-scripts-note",
  ) as HTMLElement,
  notificationsLabel: document.getElementById(
    "settings-notifications-label",
  ) as HTMLLabelElement,
  notifications: document.getElementById("notifications") as HTMLSelectElement,
  notificationsSessionLabel: document.getElementById(
    "settings-notifications-session-label",
  ) as HTMLLabelElement,
  notificationsSession: document.getElementById(
    "notifications-session",
  ) as HTMLSelectElement,
  statsBarPosLabel: document.getElementById(
    "settings-stats-bar-label",
  ) as HTMLLabelElement,
  statsBarPos: document.getElementById("stats-bar-pos") as HTMLSelectElement,
  statsBarCompactLabel: document.getElementById(
    "settings-stats-bar-compact-label",
  ) as HTMLLabelElement,
  statsBarCompact: document.getElementById("stats-bar-compact") as HTMLInputElement,
  hiddenStatusTitle: document.getElementById(
    "settings-hidden-status-title",
  ) as HTMLDivElement,
  hiddenStatusNote: document.getElementById(
    "settings-hidden-status-note",
  ) as HTMLDivElement,
  hiddenStatusList: document.getElementById(
    "settings-hidden-status-list",
  ) as HTMLDivElement,
  themeLabel: document.getElementById("settings-theme-label") as HTMLLabelElement,
  settingsVersionLabel: document.getElementById(
    "settings-version-label",
  ) as HTMLLabelElement,
  settingsVersion: document.getElementById("settings-version") as HTMLSpanElement,
  pidevTitle: document.getElementById("settings-pidev-title") as HTMLDivElement,
  pidevNote: document.getElementById("settings-pidev-note") as HTMLDivElement,
  pidevBody: document.getElementById("settings-pidev-body") as HTMLDivElement,
  cliFlags: document.getElementById("cli-flags") as HTMLDivElement,
  settingsApplyRow: document.getElementById("settings-apply-row") as HTMLDivElement,
  settingsApply: document.getElementById("settings-apply") as HTMLButtonElement,
  settingsApplyHint: document.getElementById("settings-apply-hint") as HTMLSpanElement,
  themeRow: document.querySelector(".theme-row") as HTMLDivElement,
  newChat: document.getElementById("btn-new-chat") as HTMLButtonElement,
  thinkingBlocks: document.getElementById("btn-thinking-blocks") as HTMLButtonElement,
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
  statsTopbarRow: document.getElementById("stats-topbar-row") as HTMLDivElement,
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
  speech: document.getElementById("btn-speech") as HTMLButtonElement,
  attachBtn: document.getElementById("btn-attach") as HTMLButtonElement,
  browserFilePicker: document.getElementById("browser-file-picker") as HTMLInputElement,
  trust: document.getElementById("trust") as HTMLButtonElement,
  trustIcon: document.getElementById("trust-icon") as HTMLSpanElement,
  trustBadge: document.getElementById("trust-badge") as HTMLSpanElement,
  trustLabel: document.getElementById("trust-label") as HTMLSpanElement,
  btnModel: document.getElementById("btn-model") as HTMLButtonElement,
  modelInfo: document.getElementById("model-info") as HTMLSpanElement,
  btnThinking: document.getElementById("btn-thinking") as HTMLButtonElement,
  thinkingInfo: document.getElementById("thinking-info") as HTMLSpanElement,
};

// --- transport bootstrap ---------------------------------------------------
// Priority: VS Code webview (postMessage) → browser extension settings →
// ?bridge= query → Vite env → /bridge-config.json served by the bridge.

let browserConnectionError = "";

const BROWSER_CONNECTION_ERROR_KEYS: Record<BrowserConnectionError["code"], string> = {
  "invalid-url": "browserConnectionInvalidUrl",
  "unsupported-scheme": "browserConnectionUnsupportedScheme",
  unreachable: "browserConnectionUnreachable",
  unauthorized: "browserConnectionUnauthorized",
  "not-piw": "browserConnectionNotPiw",
  "invalid-config": "browserConnectionInvalidConfig",
  "permission-denied": "browserConnectionPermissionDenied",
  "storage-unavailable": "browserConnectionStorageUnavailable",
};

function browserConnectionMessage(error: unknown): string {
  return error instanceof BrowserConnectionError
    ? t(BROWSER_CONNECTION_ERROR_KEYS[error.code])
    : t("browserConnectionUnknown");
}

async function resolveBridgeUrl(): Promise<string | null> {
  if (runtime.isBrowserExtension) {
    try {
      const connection = await resolveBrowserExtensionBridgeUrl();
      browserConnectionError = "";
      return connection.wsUrl;
    } catch (error) {
      browserConnectionError = browserConnectionMessage(error);
      return null;
    }
  }
  const fromQuery = new URLSearchParams(location.search).get("bridge");
  if (fromQuery) return fromQuery;
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_BRIDGE_URL;
  if (fromEnv) return fromEnv;
  let url: string | null = null;
  try {
    // Non-loopback standalone pages carry the launch token in their URL. The
    // bridge requires it before revealing the authenticated WebSocket URL.
    const pageToken = new URLSearchParams(location.search).get("token");
    const configUrl = pageToken
      ? `/bridge-config.json?token=${encodeURIComponent(pageToken)}`
      : "/bridge-config.json";
    const res = await fetch(configUrl, { cache: "no-store" });
    if (res.ok) {
      const cfg = (await res.json()) as { wsUrl?: string };
      if (cfg.wsUrl) url = cfg.wsUrl;
    }
  } catch {
    // no bridge on the same origin
  }
  // The public page URL exposes only ?s=<session-id>; the bridge resolves it
  // to the local session path before launching pi.
  if (url && !runtime.isVsCode) return bridgeUrlWithPageIntent(url, location.search);
  return url;
}

let transport: Transport | null = null;
let browserPanelConnection: ReturnType<typeof connectBrowserPanel> = null;
let statusState: "open" | "connecting" | "closed" = "connecting";
/** standalone only: a lost bridge connection is retried every 5s while the
 *  window is ACTIVE (visible), without a page reload */
let reconnecting = false;
const usesWebSocketBridge =
  runtime.mode === "standalone" || runtime.mode === "browser-extension";
const demoMode = new URLSearchParams(location.search).has("demo");

function updateStatus(): void {
  els.connDot.className = `conn-dot conn-${statusState}`;
  els.connDot.title =
    statusState === "open"
      ? t("connected")
      : statusState === "connecting"
        ? t("connecting")
        : reconnecting
          ? `${t("disconnected")} — ${t("reconnecting")}`
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
// Release reminders use the startup-card presentation rather than a warning.
// They can arrive before history replaces the thread, so retain them until the
// active session history is ready.
const pendingReleaseReminderCards: string[] = [];
const LOADING_QUIET_MS = 1500; // logs silence that ends the loading
const LOADING_MAX_MS = 30000; // default safety net, extended for large sessions
const LOADING_LOG_CAP = 200; // lines kept in the box

function beginSessionLoading(maxWaitMs = LOADING_MAX_MS): void {
  sessionLoading = true;
  updateSendButton();
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
  loadingMaxTimer = setTimeout(loadingMaxTick, maxWaitMs);
}

// Hard safety net: a broken request chain must never leave the whole
// interface covered indefinitely (long session requests extend the window).
function loadingMaxTick(): void {
  if (sessionLoading) endSessionLoading();
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
  flushPendingReleaseReminderCards();
  updateSendButton();
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
  const lines = loadingLogs.splice(0, loadingLogs.length);
  for (const l of lines) {
    const wrapper = addMsg("status");
    const line = document.createElement("div");
    line.className = `status-line level-${l.level}`;
    line.textContent = l.text;
    line.title = l.text;
    wrapper.appendChild(line);
  }
  flushPendingReleaseReminderCards();
  scrollToBottom();
}

async function connect(url: string): Promise<void> {
  transport?.close();
  transport = createWsTransport(url);
  setupTransport(transport);
}

let browserConnectionAlert: Promise<void> | null = null;

function explainBrowserConnectionFailure(message: string): Promise<void> {
  if (browserConnectionAlert) return browserConnectionAlert;
  browserConnectionAlert = showAlert(
    tpl(t("browserConnectionNeedsConfiguration"), { error: message }),
  )
    .then(() => {
      openSettings();
      els.settingsBrowserStatus.textContent = message;
    })
    .finally(() => {
      browserConnectionAlert = null;
    });
  return browserConnectionAlert;
}

async function connectConfiguredBrowserServer(value: string): Promise<boolean> {
  try {
    const serverUrl = await setBrowserServerUrl(value);
    const connection = await resolveBrowserExtensionBridgeUrl(serverUrl);
    browserConnectionError = "";
    els.connectUrl.value = serverUrl;
    await connect(connection.wsUrl);
    closeSettings();
    return true;
  } catch (error) {
    browserConnectionError = browserConnectionMessage(error);
    els.connectPanel.hidden = true;
    hideBootLoader();
    await explainBrowserConnectionFailure(browserConnectionError);
    return false;
  }
}

// --- standalone reconnect ----------------------------------------------------
// A restarted bridge (piw -k + piw, artifact update, crash) must not require a
// page reload: the page retries every RECONNECT_INTERVAL_MS while the window is
// active, and the normal init flow — config + session history — resumes the
// SAME session, because the page URL carries its id. The attempt re-resolves
// the bridge URL every time, so even a restart that rotates the token recovers.
const reconnect = new ReconnectLoop({
  intervalMs: RECONNECT_INTERVAL_MS,
  isActive: () => document.visibilityState === "visible",
  onStateChange: (value) => {
    reconnecting = value;
    updateStatus();
  },
  attempt: async () => {
    const url = await resolveBridgeUrl();
    if (url) await connect(url);
  },
});

// becoming visible again is the moment to try immediately (no 5s wait)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconnect.retryNow();
});

let browserCompanionOffered = false;
let browserCompanionHandoffPending = false;
let browserCompanionDiscovery: Promise<{
  nonce: string;
  capabilities: unknown[];
} | null> | null = null;

function waitForWindowMessage(
  type: string,
  nonce: string,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | null;
      if (event.source !== window || data?.type !== type || data.nonce !== nonce) return;
      cleanup();
      resolve(data);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    window.addEventListener("message", onMessage);
  });
}

// crypto.randomUUID() exists only in a SecureContext: a page served over plain
// http:// on a LAN or tailnet address (e.g. a phone reaching the bridge by IP)
// does not have it, and a throw here would abort boot() before the bridge is
// even contacted (silent red dot, no session). getRandomValues also works in
// insecure contexts, so the discovery nonce never depends on https.
function browserDiscoveryNonce(): string {
  const webCrypto = typeof crypto === "undefined" ? undefined : crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function startBrowserCompanionDiscovery(): void {
  if (runtime.mode !== "standalone" || browserCompanionDiscovery) return;
  let nonce: string;
  try {
    nonce = browserDiscoveryNonce();
  } catch {
    // the companion handoff is optional: it must never abort the bridge boot
    browserCompanionDiscovery = Promise.resolve(null);
    return;
  }
  const announce = () => {
    window.postMessage(
      { type: "pi-webview-browser-discovery", nonce, protocolVersion: 1 },
      "*",
    );
  };
  const response = waitForWindowMessage("pi-webview-browser-available", nonce, 1_500);
  announce();
  const retry = setInterval(announce, 250);
  browserCompanionDiscovery = response
    .then((message) => {
      const capabilities = Array.isArray(message?.capabilities)
        ? message.capabilities
        : [];
      return capabilities.includes("side-panel") ? { nonce, capabilities } : null;
    })
    .finally(() => clearInterval(retry));
}

async function offerBrowserCompanionHandoff(): Promise<boolean> {
  if (browserCompanionOffered || runtime.mode !== "standalone") return false;
  browserCompanionOffered = true;
  startBrowserCompanionDiscovery();
  const discovery = await browserCompanionDiscovery;
  if (!discovery) return false;
  const handoff = await ideRequest({ type: "createBrowserHandoff" });
  const ticket = (handoff?.data as { ticket?: unknown } | undefined)?.ticket;
  if (!handoff?.ok || typeof ticket !== "string") {
    appendSystemBox("error", t("browserCompanionHandoffFailed"));
    return false;
  }
  const pendingHandoff: {
    result: Promise<Record<string, unknown> | null> | null;
  } = { result: null };
  const confirmed = await showConfirm(
    t("browserCompanionMovePrompt"),
    undefined,
    () => {
      browserCompanionHandoffPending = true;
      pendingHandoff.result = waitForWindowMessage(
        "pi-webview-browser-handoff-result",
        discovery.nonce,
        15_000,
      );
      window.postMessage(
        { type: "pi-webview-browser-handoff", nonce: discovery.nonce, ticket },
        "*",
      );
    },
    true,
  );
  const handoffResult = pendingHandoff.result;
  if (!confirmed || !handoffResult) return false;
  const result = await handoffResult;
  const value = result?.result as { ok?: unknown } | undefined;
  if (value?.ok !== true) {
    browserCompanionHandoffPending = false;
    appendSystemBox("error", t("browserCompanionHandoffFailed"));
    return false;
  }
  return true;
}

function setupTransport(tr: Transport): void {
  let connectionOpened = false;
  let disconnectReported = false;

  tr.onStatus((s) => {
    // Ignore late events from a transport intentionally replaced by connect().
    if (transport !== tr) return;

    statusState =
      s.state === "open" ? "open" : s.state === "connecting" ? "connecting" : "closed";
    updateStatus();
    els.send.disabled = s.state !== "open";
    updateSendButton();
    if (s.state === "open") {
      connectionOpened = true;
      reconnect.stop();
      els.connectPanel.hidden = true;
      if (runtime.isBrowserExtension) {
        els.settingsBrowserStatus.textContent = t("browserServerSaved");
      }
      void (async () => {
        // Offer the browser handoff before the standalone performs its full
        // config/session/history load. The adopted Side Panel initializes the
        // same channel once, avoiding a redundant first loading pass.
        if (runtime.mode === "standalone" && (await offerBrowserCompanionHandoff())) {
          return;
        }
        // Config must be known before history rendering: presentation-only
        // preferences such as agenticThinking apply to the complete reload.
        await requestConfig();
        // The host's eager selection broadcast can precede the fresh page's
        // message listener after Reload Window. Request a replay only once the
        // VS Code webview transport is ready; the host can restore its saved
        // last selection even when focus returned directly to the sidebar.
        if (runtime.isVsCode) await ideRequest({ type: "attachSelection" });
        if (!demoMode) {
          // loading begins NOW (before get_state): slow extensions logging
          // during the resume must land in the loader box, not in the chat
          beginSessionLoading();
          await refreshSessions(true);
        }
      })();
    } else if (s.state === "closed") {
      endSessionLoading();
      hideBootLoader();
      const expectedHandoffClose =
        runtime.mode === "standalone" && browserCompanionHandoffPending;
      // A WebSocket error is normally followed by close: report an established
      // bridge connection loss once, but not an initial connection failure or
      // the intentional source-channel close caused by a browser handoff.
      if (
        usesWebSocketBridge &&
        connectionOpened &&
        !disconnectReported &&
        !expectedHandoffClose
      ) {
        disconnectReported = true;
        appendSystemBox("error", t("bridgeDisconnected"));
      }
      // standalone: keep trying so a restarted bridge brings the dot back to
      // green (and the session back) without a manual reload
      if (runtime.isBrowserExtension && !connectionOpened) {
        els.connectPanel.hidden = true;
        const connectionError = browserConnectionError || t("bridgeDisconnected");
        void explainBrowserConnectionFailure(connectionError);
      }
      if (usesWebSocketBridge && !expectedHandoffClose) reconnect.start();
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
/** where the stats bar lives (global config statsBarPosition, default above) */
let statsBarPosition: StatsBarPosition = "above";
/** truncation or multi-line wrapping, independent from placement */
let statsBarCompact = true;
/** global display preference: group each agent run's thoughts and tools */
let agenticThinking = false;
/** explicit security opt-in used only by the Webview-triggered update child */
let allowRemoteNpmUpdates = false;
/** dangerous opt-in that lets every dependency install script execute */
let dangerouslyAllowAllNpmScripts = false;
/** RPC setStatus keys hidden by the user (the only stable source id RPC exposes) */
let hiddenStatusKeys: string[] = [];
let sessionNotificationsOverride: "desktop" | "vscode" | "off" | undefined;
let currentSessionSettings: SessionSettings = {};
let sessionSettingsNeedPersistence = false;
let browserSessionPermissions: BrowserToolOperation[] = [];
let browserPersistentPermissions: BrowserPersistentPermissions = {};
let browserSessionSettingsReady: Promise<void> = Promise.resolve();

// --- microphone speech-to-text ---------------------------------------------
// The shared Web UI owns recognition. Hosts only persist UserConfig: no bridge,
// IDE adapter or pi process ever receives an audio stream.

let speechConfig: SpeechToTextConfig = normalizeSpeechToTextConfig(undefined);
let speechRuntime = getSpeechRuntime();
let speechCapabilities: SpeechCapabilities = detectSpeechCapabilities();
let speechMicrophonePermission: SpeechMicrophonePermission =
  speechCapabilities.microphonePermission;
let speechModelAvailability: SpeechModelAvailability = "unknown";
let speechModelChecking = false;
let speechModelInstalling = false;
let speechDevices: MediaDeviceInfo[] = [];
let speechDeviceRefreshError = "";
let speechError = "";
let speechState: SpeechControllerState = "idle";
let speechModeActive: SpeechInputMode | null = null;
let speechShortcutCapture: "pushToTalk" | "toggleToTalk" | null = null;
let speechPushShortcutKey: string | null = null;
const speechDraft = new SpeechDraft();

function setSpeechMicrophonePermission(value: SpeechMicrophonePermission): void {
  speechMicrophonePermission = value;
  speechCapabilities = { ...speechCapabilities, microphonePermission: value };
}

function speechRuntimeKey(): string {
  if (runtime.isBrowserExtension) return `browser-extension:${location.origin}`;
  if (runtime.isVsCode) return `vscode:${location.origin}`;
  if (runtime.isIDE) return `visual-studio:${location.origin}`;
  return `standalone:${location.origin}`;
}

function selectedSpeechDevice(): "default" | string {
  return speechConfig.inputByRuntime[speechRuntimeKey()] ?? "default";
}

function currentSpeechLanguage(): string {
  return speechConfig.language === "system"
    ? systemSpeechLanguage()
    : speechConfig.language;
}

function speechMediaDevices(): SpeechMediaDevices | undefined {
  return typeof navigator !== "undefined" && navigator.mediaDevices
    ? (navigator.mediaDevices as SpeechMediaDevices)
    : undefined;
}

function speechSecureContext(): boolean {
  return typeof window === "undefined" || window.isSecureContext;
}

function speechInputUnavailableInThisContainer(): boolean {
  return (
    !speechCapabilities.recognition ||
    !speechSecureContext() ||
    !speechCapabilities.microphonePolicyAllowsCapture
  );
}

function speechStateText(): string {
  if (!speechCapabilities.recognition) return t("speechStatusUnavailable");
  if (!speechSecureContext()) return t("speechStatusInsecureContext");
  if (!speechCapabilities.microphonePolicyAllowsCapture) {
    return t("speechStatusContainerBlocksMicrophone");
  }
  if (speechError) return speechError;
  if (speechMicrophonePermission === "denied") {
    return runtime.isBrowserExtension
      ? t("speechStatusChromePermissionDenied")
      : t("speechStatusPermissionDenied");
  }
  if (speechState === "starting") return t("speechStatusStarting");
  if (speechState === "stopping") return t("speechStatusStopping");
  if (speechState === "listening") {
    return speechModeActive === "toggle-to-talk"
      ? t("speechStatusListeningToggle")
      : t("speechStatusListeningPush");
  }
  if (speechCapabilities.localRecognition && speechModelAvailability === "available") {
    return t("speechStatusLocalReady");
  }
  if (speechConfig.allowCloudTranscription && speechCapabilities.cloudRecognition) {
    return t("speechStatusCloudReady");
  }
  if (speechModelInstalling || speechModelAvailability === "downloading") {
    return t("speechStatusModelDownloading");
  }
  if (speechCapabilities.localRecognition && speechModelAvailability === "downloadable") {
    return t("speechStatusModelDownloadable");
  }
  if (speechCapabilities.cloudRecognition) return t("speechStatusCloudOptIn");
  return t("speechStatusNoUsableEngine");
}

function speechHasReadyEngine(): boolean {
  return (
    (speechCapabilities.localRecognition && speechModelAvailability === "available") ||
    (speechCapabilities.cloudRecognition && speechConfig.allowCloudTranscription)
  );
}

function speechModelStatusText(): string {
  if (speechModelInstalling) return t("speechModelDownloading");
  switch (localSpeechModelControlState(speechCapabilities, speechModelAvailability)) {
    case "recognition-unavailable":
      return t("speechModelRecognitionUnsupported");
    case "local-recognition-unavailable":
      return t("speechModelLocalRecognitionUnsupported");
    case "availability-unavailable":
      return t("speechModelAvailabilityUnsupported");
    case "install-unavailable":
      return t("speechModelInstallUnsupported");
    case "available":
      return t("speechModelAvailable");
    case "downloadable":
      return t("speechModelDownloadable");
    case "downloading":
      return t("speechModelDownloading");
    case "unknown":
      return t("speechModelUnknown");
    case "unavailable":
      return t("speechModelUnavailable");
  }
}

function isSpeechPermissionError(code: string): boolean {
  const normalized = code.toLowerCase();
  return (
    normalized.includes("not-allowed") ||
    normalized.includes("notallowed") ||
    normalized.includes("permission")
  );
}

function speechErrorMessage(code: string): string {
  const normalized = code.toLowerCase();
  if (isSpeechPermissionError(code)) {
    return runtime.isBrowserExtension
      ? t("speechStatusChromePermissionDenied")
      : t("speechStatusPermissionDenied");
  }
  if (normalized.includes("input-selection")) return t("speechErrorInputSelection");
  if (normalized.includes("local-recognition")) return t("speechErrorLocalRequired");
  return tpl(t("speechErrorGeneric"), { error: code });
}

async function refreshSpeechMicrophonePermission(): Promise<void> {
  setSpeechMicrophonePermission(await getSpeechMicrophonePermission());
  if (
    speechMicrophonePermission === "granted" &&
    speechError === t("speechStatusPermissionDenied")
  ) {
    speechError = "";
  }
  renderSpeechSettings();
  renderSpeechButton();
}

function speechCanStart(): boolean {
  const requiresBrowserPermissionWindow =
    runtime.isBrowserExtension && speechMicrophonePermission === "denied";
  if (
    !speechCapabilities.recognition ||
    !speechSecureContext() ||
    !speechCapabilities.microphonePolicyAllowsCapture ||
    (speechMicrophonePermission === "denied" && !requiresBrowserPermissionWindow) ||
    speechState !== "idle"
  ) {
    return false;
  }
  return speechHasReadyEngine();
}

function applySpeechDraft(update: {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}): void {
  els.input.value = update.value;
  els.input.selectionStart = update.selectionStart;
  els.input.selectionEnd = update.selectionEnd;
  autogrowInput();
}

function beginSpeechDraft(): void {
  if (speechDraft.active) return;
  speechDraft.begin({
    value: els.input.value,
    selectionStart: els.input.selectionStart ?? els.input.value.length,
    selectionEnd: els.input.selectionEnd ?? els.input.value.length,
  });
  els.input.readOnly = true;
  els.input.classList.add("speech-dictating");
}

function completeSpeechDraft(completion: SpeechCompletion): void {
  if (!speechDraft.active) return;
  if (completion.kind === "submitted") {
    const restored = speechDraft.restore();
    if (restored) applySpeechDraft(restored);
  } else if (completion.text.trim()) {
    const committed = speechDraft.commit();
    if (committed) applySpeechDraft(committed);
  } else {
    const restored = speechDraft.cancel();
    if (restored) applySpeechDraft(restored);
  }
  els.input.readOnly = false;
  els.input.classList.remove("speech-dictating");
}

function updateSpeechConfig(next: SpeechToTextConfig): void {
  speechConfig = normalizeSpeechToTextConfig(next);
  persistWebviewConfig({ speechToText: speechConfig });
  renderSpeechSettings();
  renderSpeechButton();
}

async function refreshSpeechModelAvailability(): Promise<void> {
  const runtimeForCheck = speechRuntime;
  if (!runtimeForCheck || !speechCapabilities.modelAvailability) {
    speechModelAvailability = "unknown";
    renderSpeechSettings();
    renderSpeechButton();
    return;
  }
  const language = currentSpeechLanguage();
  speechModelChecking = true;
  renderSpeechSettings();
  const available = await getLocalSpeechModelAvailability(runtimeForCheck, language);
  if (runtimeForCheck !== speechRuntime || language !== currentSpeechLanguage()) return;
  speechModelChecking = false;
  speechModelAvailability = available;
  renderSpeechSettings();
  renderSpeechButton();
}

async function refreshSpeechDevices(requestPermission: boolean): Promise<void> {
  const devicesApi = speechMediaDevices();
  speechDeviceRefreshError = "";
  if (!speechCapabilities.inputEnumeration || !devicesApi?.enumerateDevices) {
    renderSpeechSettings();
    return;
  }
  try {
    if (requestPermission && devicesApi.getUserMedia) {
      const stream = await devicesApi.getUserMedia({ audio: true });
      for (const track of stream.getAudioTracks()) track.stop();
    }
    if (requestPermission) {
      setSpeechMicrophonePermission("granted");
      if (speechError === t("speechStatusPermissionDenied")) speechError = "";
    }
    speechDevices = (await devicesApi.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    const selected = selectedSpeechDevice();
    if (
      selected !== "default" &&
      (speechDevices.length > 0 || speechController?.active) &&
      !speechDevices.some((device) => device.deviceId === selected)
    ) {
      // Never switch an active capture to a different microphone behind the
      // user's back. Stop safely; the next explicit dictation uses default.
      speechDeviceRefreshError = t("speechDeviceDisconnected");
      if (speechController?.active) {
        speechError = t("speechDeviceDisconnected");
        speechController.stopSilently();
      }
      updateSpeechConfig({
        ...speechConfig,
        inputByRuntime: {
          ...speechConfig.inputByRuntime,
          [speechRuntimeKey()]: "default",
        },
      });
      return;
    }
  } catch (error) {
    const code =
      error instanceof Error ? error.name || error.message : "microphone-unavailable";
    if (isSpeechPermissionError(code)) setSpeechMicrophonePermission("denied");
    speechDeviceRefreshError = speechErrorMessage(code);
  }
  renderSpeechSettings();
}

function updateSpeechButtonState(): void {
  const button = els.speech;
  button.hidden = speechInputUnavailableInThisContainer();
  if (button.hidden) return;
  const active = speechState !== "idle";
  const mode = speechModeActive ?? speechConfig.mode;
  const shortcut = formatSpeechShortcut(
    speechShortcutForMode(speechConfig.shortcuts, mode),
  );
  button.innerHTML = active ? speechWaveformIcon() : microphoneIcon();
  button.classList.toggle("listening", speechState === "listening");
  button.classList.toggle("starting", speechState === "starting");
  button.classList.toggle("stopping", speechState === "stopping");
  button.setAttribute("aria-pressed", String(active));
  const canStart = speechCanStart();
  const idleLabel =
    mode === "toggle-to-talk"
      ? tpl(t("speechButtonToggle"), { shortcut })
      : tpl(t("speechButtonPush"), { shortcut });
  button.setAttribute(
    "aria-label",
    active ? speechStateText() : canStart ? idleLabel : speechStateText(),
  );
  button.title = button.getAttribute("aria-label") ?? "";
  const interactionLocked =
    statusState !== "open" || piRestarting || switchingSession || sessionLoading;
  button.disabled = !active && (!canStart || interactionLocked);
}

function renderSpeechButton(): void {
  updateSpeechButtonState();
}

function renderSpeechSettings(): void {
  const unavailable = speechInputUnavailableInThisContainer();
  els.settingsSpeechTitle.textContent = t("settingsSpeechTitle");
  els.settingsSpeechStatus.classList.toggle("speech-unavailable-status", unavailable);
  els.settingsSpeechStatusIcon.hidden = !unavailable;
  els.settingsSpeechStatusIcon.innerHTML = unavailable ? trustIcon("warn-filled") : "";
  els.settingsSpeechStatusText.textContent = speechStateText();
  els.settingsSpeechControls.hidden = unavailable;
  els.settingsSpeechDeviceLabel.textContent = t("speechDevice");
  els.settingsSpeechRefreshDevices.textContent = t("speechRefreshDevices");
  els.settingsSpeechModeLabel.textContent = t("speechMode");
  els.settingsSpeechPushShortcutLabel.textContent = t("speechPushShortcut");
  els.settingsSpeechToggleShortcutLabel.textContent = t("speechToggleShortcut");
  els.settingsSpeechShortcutNote.textContent = t("speechShortcutNote");
  els.settingsSpeechPushShortcutCapture.textContent =
    speechShortcutCapture === "pushToTalk"
      ? t("speechShortcutCaptureActive")
      : t("speechShortcutCapture");
  els.settingsSpeechToggleShortcutCapture.textContent =
    speechShortcutCapture === "toggleToTalk"
      ? t("speechShortcutCaptureActive")
      : t("speechShortcutCapture");
  els.settingsSpeechLanguageLabel.textContent = t("speechLanguage");
  els.settingsSpeechInstallModel.textContent = speechModelInstalling
    ? t("speechInstallingModel")
    : t("speechInstallModel");
  els.settingsSpeechRemoveModel.textContent = t("speechRemoveModel");
  els.settingsSpeechPauseLabel.textContent = t("speechPause");
  const available = speechCapabilities.recognition && speechSecureContext();
  const microphoneCaptureAllowed =
    available && speechCapabilities.microphonePolicyAllowsCapture;
  const active = speechState !== "idle";
  const modelControlState = localSpeechModelControlState(
    speechCapabilities,
    speechModelAvailability,
  );
  const readyEngine = microphoneCaptureAllowed && speechHasReadyEngine();
  const languageCanSetUpLocal =
    microphoneCaptureAllowed &&
    (readyEngine ||
      modelControlState === "available" ||
      modelControlState === "downloadable");
  const cloudIsOnlyRemainingPath =
    microphoneCaptureAllowed &&
    !readyEngine &&
    modelControlState !== "available" &&
    modelControlState !== "downloadable" &&
    speechCapabilities.cloudRecognition;
  const deviceSelectable = readyEngine && speechCapabilities.inputSelection;
  els.settingsSpeechSection.classList.toggle("speech-settings-pending", !readyEngine);
  els.settingsSpeechSection.classList.toggle(
    "speech-local-setup-unavailable",
    !languageCanSetUpLocal,
  );
  els.settingsSpeechCloudLabel.textContent = cloudIsOnlyRemainingPath
    ? t("speechCloudOnlyOption")
    : t("speechCloud");
  els.settingsSpeechCloudNote.textContent = !microphoneCaptureAllowed
    ? t("speechCloudContainerBlockedNote")
    : speechConfig.allowCloudTranscription
      ? t("speechCloudEnabledNote")
      : cloudIsOnlyRemainingPath
        ? t("speechCloudOnlyNote")
        : t("speechCloudNote");
  els.settingsSpeechDevice.textContent = "";
  const defaultDevice = document.createElement("option");
  defaultDevice.value = "default";
  defaultDevice.textContent = t("speechDefaultDevice");
  els.settingsSpeechDevice.appendChild(defaultDevice);
  for (const [index, device] of speechDevices.entries()) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent =
      device.label || tpl(t("speechDeviceUnnamed"), { number: String(index + 1) });
    els.settingsSpeechDevice.appendChild(option);
  }
  els.settingsSpeechDevice.value = selectedSpeechDevice();
  els.settingsSpeechDevice.disabled = !deviceSelectable || active;
  els.settingsSpeechRefreshDevices.disabled =
    !readyEngine || !speechCapabilities.inputEnumeration || active;
  els.settingsSpeechDeviceNote.textContent = !available
    ? t("speechStatusUnavailable")
    : !microphoneCaptureAllowed
      ? t("speechStatusContainerBlocksMicrophone")
      : !readyEngine
        ? t("speechControlsUnavailable")
        : speechMicrophonePermission === "denied"
          ? runtime.isBrowserExtension
            ? t("speechStatusChromePermissionDenied")
            : t("speechStatusPermissionDenied")
          : !speechCapabilities.inputSelection
            ? t("speechDeviceUnsupported")
            : speechDeviceRefreshError ||
              (speechDevices.length === 0 ? t("speechDeviceNoAccess") : "");

  els.settingsSpeechMode.textContent = "";
  for (const option of [
    { value: "push-to-talk", label: t("speechModePush") },
    { value: "toggle-to-talk", label: t("speechModeToggle") },
  ] as const) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    els.settingsSpeechMode.appendChild(element);
  }
  els.settingsSpeechMode.value = speechConfig.mode;
  els.settingsSpeechMode.disabled = !readyEngine || active;

  els.settingsSpeechPushShortcut.value = formatSpeechShortcut(
    speechConfig.shortcuts.pushToTalk,
  );
  els.settingsSpeechToggleShortcut.value = formatSpeechShortcut(
    speechConfig.shortcuts.toggleToTalk,
  );
  els.settingsSpeechPushShortcutCapture.disabled = !readyEngine || active;
  els.settingsSpeechToggleShortcutCapture.disabled = !readyEngine || active;

  const systemLanguage = systemSpeechLanguage();
  const languages = [
    ...new Set([
      systemLanguage,
      ...(speechConfig.language === "system" ? [] : [speechConfig.language]),
      ...SPEECH_LANGUAGE_CATALOG,
    ]),
  ];
  els.settingsSpeechLanguage.textContent = "";
  const systemOption = document.createElement("option");
  systemOption.value = "system";
  systemOption.textContent = tpl(t("speechLanguageSystem"), {
    language: speechLanguageDisplayName(systemLanguage, currentLocale),
  });
  els.settingsSpeechLanguage.appendChild(systemOption);
  for (const language of languages) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = speechLanguageDisplayName(language, currentLocale);
    els.settingsSpeechLanguage.appendChild(option);
  }
  els.settingsSpeechLanguage.value = speechConfig.language;
  els.settingsSpeechLanguage.disabled = !languageCanSetUpLocal || active;
  const modelCanDownload =
    microphoneCaptureAllowed &&
    !active &&
    !speechModelInstalling &&
    modelControlState === "downloadable" &&
    speechCapabilities.modelInstall;
  const modelStatus = speechModelChecking
    ? t("speechModelChecking")
    : speechModelStatusText();
  els.settingsSpeechModelStatus.textContent = modelStatus;
  els.settingsSpeechInstallModel.textContent = speechModelInstalling
    ? t("speechInstallingModel")
    : modelCanDownload
      ? t("speechInstallModel")
      : t("speechDownloadUnavailable");
  els.settingsSpeechInstallModel.disabled = !modelCanDownload;
  els.settingsSpeechInstallModel.title = modelCanDownload
    ? t("speechInstallModel")
    : modelStatus;
  els.settingsSpeechRemoveModel.disabled = true;
  els.settingsSpeechRemoveModel.title = t("speechRemoveUnsupported");
  els.settingsSpeechModelNote.textContent = modelCanDownload
    ? t("speechRemoveUnsupported")
    : `${modelStatus} ${t("speechRemoveUnsupported")}`;

  els.settingsSpeechPause.value = String(speechConfig.toggleSilenceMs);
  els.settingsSpeechPause.disabled = !readyEngine || active;
  els.settingsSpeechCloud.checked = speechConfig.allowCloudTranscription;
  els.settingsSpeechCloud.disabled =
    !microphoneCaptureAllowed || active || !speechCapabilities.cloudRecognition;
}

function applySpeechConfig(value: unknown): void {
  speechConfig = normalizeSpeechToTextConfig(value);
  renderSpeechSettings();
  renderSpeechButton();
  void refreshSpeechModelAvailability();
  void refreshSpeechMicrophonePermission();
}

function updateSpeechState(
  state: SpeechControllerState,
  mode: SpeechInputMode | null,
): void {
  speechState = state;
  speechModeActive = mode;
  if (state === "starting") beginSpeechDraft();
  if (state === "listening") {
    setSpeechMicrophonePermission("granted");
    void refreshSpeechDevices(false);
  }
  if (state === "idle" && !speechDraft.active) {
    els.input.readOnly = false;
    els.input.classList.remove("speech-dictating");
  }
  renderSpeechSettings();
  renderSpeechButton();
}

const speechController = speechRuntime
  ? new SpeechController(
      speechRuntime,
      {
        onState: updateSpeechState,
        onTranscript: (finalText, interimText) => {
          beginSpeechDraft();
          const update = speechDraft.update(
            [finalText, interimText].filter(Boolean).join(" "),
          );
          if (update) applySpeechDraft(update);
        },
        onSubmit: (text) => submitSpeechText(text),
        onComplete: completeSpeechDraft,
        onError: (code) => {
          const unavailableSelectedDevice =
            selectedSpeechDevice() !== "default" &&
            (code.toLowerCase().includes("notfound") ||
              code.toLowerCase().includes("device-not-found"));
          if (isSpeechPermissionError(code)) setSpeechMicrophonePermission("denied");
          if (unavailableSelectedDevice) {
            speechError = t("speechDeviceDisconnected");
            updateSpeechConfig({
              ...speechConfig,
              inputByRuntime: {
                ...speechConfig.inputByRuntime,
                [speechRuntimeKey()]: "default",
              },
            });
          } else {
            speechError = speechErrorMessage(code);
          }
          renderSpeechSettings();
          renderSpeechButton();
        },
        onInputSelectionUnavailable: () => {
          speechCapabilities = { ...speechCapabilities, inputSelection: false };
          speechError = t("speechErrorInputSelection");
        },
      },
      speechMediaDevices(),
    )
  : null;

async function startSpeech(mode: SpeechInputMode): Promise<void> {
  if (!speechController || speechState !== "idle") return;
  if (!speechCapabilities.microphonePolicyAllowsCapture) {
    speechError = t("speechStatusContainerBlocksMicrophone");
    renderSpeechSettings();
    renderSpeechButton();
    return;
  }
  speechError = "";
  const localReady =
    speechCapabilities.localRecognition && speechModelAvailability === "available";
  if (!localReady && !speechConfig.allowCloudTranscription) {
    speechError = t("speechErrorLocalRequired");
    renderSpeechSettings();
    renderSpeechButton();
    return;
  }
  if (runtime.isBrowserExtension && speechMicrophonePermission !== "granted") {
    if (!browserPanelConnection) {
      speechError = t("speechStatusChromePermissionUnavailable");
    } else {
      browserPanelConnection.send({ type: "request_microphone_permission" });
      speechError = t("speechStatusChromePermissionWindowOpened");
    }
    renderSpeechSettings();
    renderSpeechButton();
    return;
  }
  beginSpeechDraft();
  const started = await speechController.start({
    mode,
    language: currentSpeechLanguage(),
    processLocally: localReady,
    toggleSilenceMs: speechConfig.toggleSilenceMs,
    inputDeviceId: selectedSpeechDevice(),
  });
  if (!started && speechDraft.active) {
    const restored = speechDraft.cancel();
    if (restored) applySpeechDraft(restored);
    els.input.readOnly = false;
    els.input.classList.remove("speech-dictating");
  }
}

function toggleSpeech(): void {
  if (!speechController) return;
  if (speechController.active) {
    speechController.stopToggleToTalk();
  } else {
    void startSpeech("toggle-to-talk");
  }
}

function effectiveNotifications(): "desktop" | "vscode" | "off" {
  return sessionNotificationsOverride ?? notificationsDefault;
}

// Reads settings embedded in the current session JSONL. Browser grants stored
// here disappear naturally when the session is deleted.
function refreshSessionNotificationOverride(): void {
  sessionNotificationsOverride = undefined;
  currentSessionSettings = {};
  browserSessionPermissions = [];
  sessionSettingsNeedPersistence = false;
  updateNotificationsSessionUi();
  const sessionPath = currentSessionPath;
  if (!sessionPath) {
    browserSessionSettingsReady = Promise.resolve();
    return;
  }
  browserSessionSettingsReady = ideRequest({
    type: "getSessionSettings",
    sessionPath,
  }).then((res) => {
    if (currentSessionPath !== sessionPath) return;
    const settings = res?.ok
      ? ((res.data as SessionSettings | null) ?? {})
      : ({} as SessionSettings);
    const v = settings.notifications;
    if (v === "desktop" || v === "vscode" || v === "off") {
      sessionNotificationsOverride = v;
    }
    browserSessionPermissions = normalizeBrowserPermissionOperations(
      settings.browserToolPermissions,
    );
    currentSessionSettings = {
      ...(sessionNotificationsOverride
        ? { notifications: sessionNotificationsOverride }
        : {}),
      ...(browserSessionPermissions.length > 0
        ? { browserToolPermissions: browserSessionPermissions }
        : {}),
    };
    updateNotificationsSessionUi();
  });
}

function persistCurrentSessionSettings(): void {
  if (!currentSessionPath) {
    sessionSettingsNeedPersistence = true;
    return;
  }
  sessionSettingsNeedPersistence = false;
  transport?.send({
    channel: "ide",
    payload: {
      type: "setSessionSettings",
      sessionPath: currentSessionPath,
      settings: currentSessionSettings,
      id: `cfg-${++configId}`,
    },
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
  els.connectUrl.placeholder = runtime.isBrowserExtension
    ? "http://127.0.0.1:7361"
    : t("bridgeUrlPlaceholder");
  const connectTitle = document.getElementById("connect-title");
  if (connectTitle) connectTitle.textContent = t("browserConnectionTitle");
  els.connectBtn.textContent = t("connect");
  els.settingsBrowserTitle.textContent = t("browserSettingsTitle");
  els.settingsBrowserUrlLabel.textContent = t("browserServerUrlLabel");
  els.settingsBrowserUrlNote.textContent = t("browserServerUrlNote");
  els.settingsBrowserResetPermissions.textContent = t("browserPermissionsResetAll");
  els.settingsApply.textContent = t("apply");
  els.send.title = t("send");
  els.attachBtn.title = t("attachBtn");
  els.newChat.title = t("newChat");
  els.updateModalTitle.textContent = t("updateModalTitle");
  els.updateModalDesc.textContent = t("updateModalDesc");
  els.updateCancel.textContent = t("cancel");
  els.updateConfirm.textContent = t("confirm");
  updateThinkingBlocksButton();
  els.btnModel.title = t("model");
  els.btnThinking.title = t("thinkingLevel");
  applyUpdateShield(); // shield tooltip follows the current state (re-locale)
  els.settingsBtn.title = t("settings");
  els.reload.title = t("reload");
  els.sessionBtn.title = t("sessions");
  els.sessionSearch.placeholder = t("searchSessions");
  els.lang.title = t("language");
  els.bootLoaderText.textContent = t("loading");
  els.langLabel.textContent = t("language");
  els.historyLabel.textContent = t("historyLimit");
  els.historyInput.value = String(historyLimit);
  els.agenticThinkingLabel.textContent = t("settingsAgenticThinking");
  els.agenticThinkingLabel.title = t("settingsAgenticThinkingDesc");
  els.agenticThinking.title = t("settingsAgenticThinkingDesc");
  els.agenticThinkingNote.textContent = t("settingsAgenticThinkingDesc");
  els.agenticThinking.checked = agenticThinking;
  els.allowRemoteNpmUpdatesLabel.textContent = t("settingsAllowRemoteNpmUpdates");
  els.allowRemoteNpmUpdatesLabel.title = t("settingsAllowRemoteNpmUpdatesDesc");
  els.allowRemoteNpmUpdates.title = t("settingsAllowRemoteNpmUpdatesDesc");
  els.allowRemoteNpmUpdatesNote.textContent = t("settingsAllowRemoteNpmUpdatesDesc");
  els.allowRemoteNpmUpdates.checked = allowRemoteNpmUpdates;
  els.allowNpmInstallScriptsLabel.textContent = t("settingsAllowNpmInstallScripts");
  els.allowNpmInstallScriptsLabel.title = t("settingsAllowNpmInstallScriptsDesc");
  els.allowNpmInstallScripts.title = t("settingsAllowNpmInstallScriptsDesc");
  els.allowNpmInstallScriptsNote.textContent = t("settingsAllowNpmInstallScriptsDesc");
  els.allowNpmInstallScripts.checked = dangerouslyAllowAllNpmScripts;
  refreshAgenticThinkingSummaries();
  // settings modal: 4 sections (Info / Webview / pi.dev / CLI flags)
  els.settingsInfoTitle.textContent = t("settingsSectionInfo");
  els.settingsWebviewTitle.textContent = t("settingsSectionWebview");
  els.settingsCliTitle.textContent = t("settingsSectionCli");
  // Notifications sub-group inside the Webview section
  els.settingsNotificationsTitle.textContent = t("settingsNotificationsGroup");
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
  if (els.notificationsSession.options.length !== notifyOptions.length + 1) {
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
  // stats bar position (global setting): where the context bar lives.
  // The select starts EMPTY in the HTML: always repopulated here (options
  // are localized, no hardcoded text).
  els.statsBarPosLabel.textContent = t("settingsStatsBar");
  const barOptions: Array<{ value: StatsBarPosition; label: string }> = [
    { value: "above", label: t("statsBarAbove") },
    { value: "below", label: t("statsBarBelow") },
    { value: "topbar", label: t("statsBarTopbar") },
  ];
  els.statsBarPos.textContent = "";
  for (const o of barOptions) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    els.statsBarPos.appendChild(opt);
  }
  els.statsBarPos.value = statsBarPosition;
  els.statsBarCompactLabel.textContent = t("settingsStatsBarCompact");
  els.statsBarCompact.checked = statsBarCompact;
  els.hiddenStatusTitle.textContent = t("settingsHiddenStatusGroup");
  els.hiddenStatusNote.textContent = t("settingsHiddenStatusNote");
  renderHiddenStatusSettings();
  renderSpeechSettings();
  renderSpeechButton();
  updateStatus();
  updateThemeButtons();
  populateSessionMenu();
  refreshCollapseFooters();
  updateSettingsApplyState();
  // theme: inside the VS Code webview the IDE manages it — no choice
  if (runtime.isVsCode) {
    const row = els.themeRow.closest(".settings-row") as HTMLElement | null;
    if (row) row.hidden = true;
  }
}

/** Move the stats bar (context gauge + extension slots) to the chosen
 *  placement (global setting, applied immediately): above/below the
 *  composer, or as a second row inside the header (topbar). */
function applyStatsBarPosition(pos: StatsBarPosition): void {
  statsBarPosition = pos;
  document.body.classList.remove(
    "stats-bar-above",
    "stats-bar-below",
    "stats-bar-topbar",
  );
  document.body.classList.add(`stats-bar-${pos}`);
  // DOM placement: above/below the composer, or on its own header row.
  if (pos === "topbar") els.statsTopbarRow.appendChild(els.statsBadge);
  else if (pos === "below") els.inputBox.after(els.statsBadge);
  else els.inputBox.before(els.statsBadge);
  els.statsBarPos.value = pos;
}

function applyStatsBarCompact(compact: boolean): void {
  statsBarCompact = compact;
  document.body.classList.toggle("stats-bar-compact", compact);
  document.body.classList.toggle("stats-bar-expanded", !compact);
  els.statsBarCompact.checked = compact;
}

function persistWebviewConfig(patch: Partial<UserConfig>): void {
  transport?.send({
    channel: "ide",
    payload: { type: "setConfig", patch, id: `cfg-${++configId}` },
  });
}

function renderHiddenStatusSettings(): void {
  els.hiddenStatusList.textContent = "";
  if (hiddenStatusKeys.length === 0) {
    const empty = document.createElement("span");
    empty.className = "hidden-status-empty";
    empty.textContent = t("settingsHiddenStatusEmpty");
    els.hiddenStatusList.appendChild(empty);
    return;
  }
  for (const key of hiddenStatusKeys) {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "hidden-status-restore";
    restore.textContent = key;
    restore.title = tpl(t("settingsHiddenStatusRestore"), { source: key });
    restore.addEventListener("click", () => {
      hiddenStatusKeys = setStatusKeyHidden(hiddenStatusKeys, key, false);
      renderHiddenStatusSettings();
      renderStatusSlots();
      persistWebviewConfig({ hiddenStatusKeys });
    });
    els.hiddenStatusList.appendChild(restore);
  }
}

async function requestConfig(): Promise<void> {
  const res = await ideRequest({ type: "getConfig" });
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
    const sbp = cfg.statsBarPosition;
    const effectivePosition =
      sbp === "above" || sbp === "below" || sbp === "topbar" ? sbp : statsBarPosition;
    applyStatsBarPosition(effectivePosition);
    const effectiveCompact = effectiveStatsBarCompact(
      cfg.statsBarCompact,
      effectivePosition,
    );
    applyStatsBarCompact(effectiveCompact);
    // One-time migration from the old placement-dependent layout. Persisting
    // the inferred value makes later position changes truly independent.
    if (typeof cfg.statsBarCompact !== "boolean") {
      persistWebviewConfig({ statsBarCompact: effectiveCompact });
    }
    agenticThinking = cfg.agenticThinking === true;
    els.agenticThinking.checked = agenticThinking;
    allowRemoteNpmUpdates = cfg.allowRemoteNpmUpdates === true;
    els.allowRemoteNpmUpdates.checked = allowRemoteNpmUpdates;
    dangerouslyAllowAllNpmScripts = cfg.dangerouslyAllowAllNpmScripts === true;
    els.allowNpmInstallScripts.checked = dangerouslyAllowAllNpmScripts;
    browserPersistentPermissions = normalizeBrowserPersistentPermissions(
      cfg.browserToolPermissions,
    );
    hiddenStatusKeys = normalizeHiddenStatusKeys(cfg.hiddenStatusKeys);
    applySpeechConfig(cfg.speechToText);
    renderStatusSlots();
    applyUiStrings();
  }
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
    const sbp = cfg.statsBarPosition;
    if (sbp === "above" || sbp === "below" || sbp === "topbar") {
      applyStatsBarPosition(sbp);
    }
    if (typeof cfg.statsBarCompact === "boolean") {
      applyStatsBarCompact(cfg.statsBarCompact);
    }
    if (typeof cfg.agenticThinking === "boolean") {
      applyAgenticThinkingPreference(cfg.agenticThinking);
    }
    if (typeof cfg.allowRemoteNpmUpdates === "boolean") {
      allowRemoteNpmUpdates = cfg.allowRemoteNpmUpdates;
      els.allowRemoteNpmUpdates.checked = allowRemoteNpmUpdates;
    }
    if (typeof cfg.dangerouslyAllowAllNpmScripts === "boolean") {
      dangerouslyAllowAllNpmScripts = cfg.dangerouslyAllowAllNpmScripts;
      els.allowNpmInstallScripts.checked = dangerouslyAllowAllNpmScripts;
    }
    if (Object.prototype.hasOwnProperty.call(cfg, "hiddenStatusKeys")) {
      hiddenStatusKeys = normalizeHiddenStatusKeys(cfg.hiddenStatusKeys);
      renderStatusSlots();
    }
    if (Object.prototype.hasOwnProperty.call(cfg, "speechToText")) {
      applySpeechConfig(cfg.speechToText);
    }
    applyUiStrings();
  }
}

// --- settings (gear) → modal dialog -----------------------------------------

// version row: the source depends on the runtime — in the IDE webview it is
// the addon, standalone it is the piw package (both answer getVersion)
function refreshVersionInfo(): void {
  els.settingsVersionLabel.textContent = runtime.isIDE
    ? t("settingsVersionAddon")
    : t("settingsVersionPiw");
  void ideRequest({ type: "getVersion" }).then((res) => {
    const v = res?.ok
      ? (res.data as { version?: string | null } | undefined)?.version
      : null;
    els.settingsVersion.textContent = v ?? "–";
  });
}

// --- block 3: pi CLI flags (dynamic from the registered flags) -------------

let savedCliValues: CliFlags = {};
let cliDirty = false;
let savedBrowserServerUrl = "";
let browserServerUrlReady = false;
let applyingSettings = false;
/** Staged pi.dev changes are applied by the single settings footer action. */
const pendingPiSettings = new Map<string, unknown>();

function browserServerUrlDirty(): boolean {
  return browserServerSettingDirty(
    els.settingsBrowserUrl.value,
    savedBrowserServerUrl,
    browserServerUrlReady,
    runtime.isBrowserExtension,
  );
}

function updateSettingsApplyState(): void {
  const dirty = settingsApplyNeeded(
    browserServerUrlDirty(),
    cliDirty,
    pendingPiSettings.size,
  );
  els.settingsApplyRow.hidden = !dirty;
  els.settingsApplyHint.textContent = dirty ? t("settingsApplyHint") : "";
}

// current values in the form (flag → value): only the REALLY set ones
// (checked checkboxes, non-empty strings) — the comparison with the saved
// ones must not get dirty with defaults (false checkboxes / empty inputs)
function currentCliValues(): CliFlags {
  const values: CliFlags = {};
  for (const input of els.cliFlags.querySelectorAll<HTMLInputElement>(
    "input[data-flag]",
  )) {
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
  cliDirty = !settingRecordsEqual(currentCliValues(), savedCliValues);
  updateSettingsApplyState();
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
  void ideRequest({
    type: "getCliFlags",
    ...(currentSessionPath ? { sessionPath: currentSessionPath } : {}),
  }).then((res) => {
    if (!res?.ok) return;
    const data = res.data as { available?: CliFlagInfo[]; values?: CliFlags } | undefined;
    savedCliValues = data?.values ?? {};
    renderCliFlags(data?.available ?? [], savedCliValues);
  });
}

// --- pi.dev settings (V1-bis of plan 0003) ---------------------------------
// The pi.dev section of the panel is populated dynamically from get_settings
// (facade, src/bridge/pi-settings.ts): the host provides the schema + the
// file-backed values; session values (source "pi-rpc") are filled from the
// local get_state state.
//
// The section is a STAGED FORM: editing a control only records the change in
// pendingPiSettings and reveals the single settings-footer "Applica" button —
// nothing is sent to pi.dev before it. Closing the panel without "Applica"
// discards the pending changes (they are lost, by design). "Applica" then:
//  - pi-rpc keys → the pi RPC is called directly (live session state);
//  - pi-settings-file keys → confirm (propagation "restart", same warning as
//    the CLI flags "Applica"), then set_setting → the host writes the file
//    and restarts pi (connection_closed + pi_restarted → re-init).

let piSettings: PiSetting[] = [];
let availablePiModels: Array<{
  provider: string;
  id: string;
  name?: string;
}> = [];
let settingsModelPickerAbort = new AbortController();

function sessionValueFor(key: string): unknown {
  switch (key) {
    case "model":
      return currentModel?.name ?? currentModel?.id ?? "";
    case "thinkingLevel":
      return thinkingLevel;
    case "steeringMode":
      return steeringMode;
    case "followUpMode":
      return followUpMode;
    case "autoCompaction":
      return autoCompactionEnabled;
    default:
      return undefined;
  }
}

async function fetchPiSettings(): Promise<void> {
  pendingPiSettings.clear();
  updateSettingsApplyState();
  els.pidevBody.textContent = "";
  const res = await ideRequest({ type: "getSettings" });
  const data = res?.ok ? (res.data as PiSettingsResult | undefined) : undefined;
  const settings = data?.settings ?? [];
  if (settings.length === 0) {
    els.pidevNote.hidden = false;
    return;
  }
  els.pidevNote.hidden = true;
  piSettings = settings.map((s) =>
    s.source === "pi-rpc" && s.value === undefined
      ? { ...s, value: sessionValueFor(s.key) }
      : s,
  );
  if (piSettings.some((setting) => setting.type === "model")) {
    const modelsRes = await rpcRequest(rpc.getAvailableModels()).catch(() => null);
    availablePiModels =
      (modelsRes?.success
        ? (
            modelsRes.data as
              | {
                  models?: Array<{ provider: string; id: string; name?: string }>;
                }
              | undefined
          )?.models
        : undefined) ?? [];
  }
  renderPiSettings();
}

/** value shown by the control: the staged one while pending, else the fetched */
function displayValue(setting: PiSetting): unknown {
  return pendingPiSettings.has(setting.key)
    ? pendingPiSettings.get(setting.key)
    : setting.value;
}

function settingValueEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const a = left as Partial<PiModelSettingValue>;
  const b = right as Partial<PiModelSettingValue>;
  return a.provider === b.provider && a.id === b.id;
}

/** record a staged change (or drop it when the control returns to the base value) */
function stageSetting(setting: PiSetting, value: unknown): void {
  if (settingValueEqual(value, setting.value)) {
    pendingPiSettings.delete(setting.key);
  } else {
    pendingPiSettings.set(setting.key, value);
  }
  updateSettingsApplyState();
}

function renderPiSettings(): void {
  settingsModelPickerAbort.abort();
  settingsModelPickerAbort = new AbortController();
  els.pidevBody.textContent = "";
  let group: string | undefined;
  let target: HTMLElement = els.pidevBody;
  for (const setting of piSettings) {
    if (setting.group !== group) {
      group = setting.group;
      target = els.pidevBody;
      if (group) {
        const subsection = document.createElement("div");
        subsection.className = "settings-subsection";
        const title = document.createElement("div");
        title.className = "settings-subsection-title";
        title.textContent = t(group);
        subsection.appendChild(title);
        els.pidevBody.appendChild(subsection);
        target = subsection;
      }
    }
    const row = document.createElement("div");
    row.className = "settings-row";
    const label = document.createElement("label");
    label.textContent = t(setting.label);
    if (setting.description) label.title = t(setting.description);
    row.appendChild(label);
    row.appendChild(settingControl(setting));
    target.appendChild(row);
  }
}

function settingControl(setting: PiSetting): HTMLElement {
  const stage = (value: unknown): void => {
    stageSetting(setting, value);
  };
  if (setting.type === "model") {
    const picker = document.createElement("div");
    picker.className = "settings-model-picker";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "settings-model-trigger";
    trigger.disabled = !setting.writable || availablePiModels.length === 0;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    if (!setting.writable) trigger.title = t("settingsPiDevManaged");

    const triggerLabel = document.createElement("span");
    triggerLabel.className = "settings-model-trigger-label";
    const chevron = document.createElement("span");
    chevron.className = "settings-model-chevron";
    chevron.textContent = "⌄";
    trigger.append(triggerLabel, chevron);

    const menu = document.createElement("div");
    menu.className = "settings-model-menu";
    menu.hidden = true;
    const search = document.createElement("input");
    search.type = "text";
    search.className = "pop-search";
    search.placeholder = t("searchModels");
    search.spellcheck = false;
    const list = document.createElement("div");
    list.className = "pop-list";
    list.setAttribute("role", "listbox");
    menu.append(search, list);
    picker.append(trigger, menu);

    const initial = displayValue(setting) as Partial<PiModelSettingValue> | undefined;
    let selected =
      availablePiModels.find(
        (model) => model.provider === initial?.provider && model.id === initial.id,
      ) ?? null;

    const updateTrigger = (): void => {
      const label = selected
        ? [selected.provider, selected.name ?? selected.id].join(" · ")
        : initial?.provider && initial.id
          ? tpl(t("piSettingModelUnavailable"), {
              model: `${initial.provider}/${initial.id}`,
            })
          : "—";
      triggerLabel.textContent = label;
      trigger.title =
        trigger.disabled && !setting.writable ? t("settingsPiDevManaged") : label;
    };

    const close = (): void => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };

    const render = (query: string): void => {
      list.textContent = "";
      const q = query.trim().toLowerCase();
      const filtered = q
        ? availablePiModels.filter(
            (model) =>
              (model.name ?? "").toLowerCase().includes(q) ||
              model.id.toLowerCase().includes(q) ||
              model.provider.toLowerCase().includes(q),
          )
        : availablePiModels;
      for (const model of filtered) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "pop-item";
        option.setAttribute("role", "option");
        const active = selected?.provider === model.provider && selected?.id === model.id;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", String(active));
        const name = document.createElement("span");
        name.className = "pop-item-label";
        name.textContent = model.name ?? model.id;
        const provider = document.createElement("span");
        provider.className = "pop-item-meta";
        provider.textContent = model.provider;
        option.append(name, provider);
        option.addEventListener("click", () => {
          selected = model;
          stage({ provider: model.provider, id: model.id });
          updateTrigger();
          close();
        });
        list.appendChild(option);
      }
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pop-empty";
        empty.textContent = "—";
        list.appendChild(empty);
      }
    };

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = menu.hidden;
      document
        .querySelectorAll<HTMLElement>(".settings-model-menu:not([hidden])")
        .forEach((other) => {
          if (other !== menu) {
            other.hidden = true;
            other
              .closest(".settings-model-picker")
              ?.querySelector(".settings-model-trigger")
              ?.setAttribute("aria-expanded", "false");
          }
        });
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        search.value = "";
        render("");
        search.focus();
      }
    });
    picker.addEventListener("click", (event) => event.stopPropagation());
    search.addEventListener("input", () => render(search.value));
    document.addEventListener("click", close, {
      signal: settingsModelPickerAbort.signal,
    });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && !menu.hidden) {
          close();
          trigger.focus();
        }
      },
      { signal: settingsModelPickerAbort.signal },
    );

    updateTrigger();
    render("");
    return picker;
  }
  if (setting.type === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "field-checkbox";
    input.checked = displayValue(setting) === true;
    input.disabled = !setting.writable;
    if (input.disabled) input.title = t("settingsPiDevManaged");
    input.addEventListener("change", () => stage(input.checked));
    return input;
  }
  if (setting.type === "enum") {
    const select = document.createElement("select");
    select.className = "field-select";
    select.disabled = !setting.writable;
    if (select.disabled) select.title = t("settingsPiDevManaged");
    for (const opt of setting.options ?? []) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = t(opt.label);
      select.appendChild(o);
    }
    const current = displayValue(setting);
    select.value = current === undefined ? "" : String(current);
    select.addEventListener("change", () => stage(select.value));
    return select;
  }
  const input = document.createElement("input");
  input.type = setting.type === "number" ? "number" : "text";
  input.className = "field-input";
  if (setting.type === "number") {
    if (setting.min !== undefined) input.min = String(setting.min);
    if (setting.max !== undefined) input.max = String(setting.max);
    if (setting.step !== undefined) input.step = String(setting.step);
  }
  const current = displayValue(setting);
  input.value = current === undefined ? "" : String(current);
  input.disabled = !setting.writable;
  if (input.disabled) input.title = t("settingsPiDevManaged");
  input.addEventListener("change", () =>
    stage(setting.type === "number" ? Number(input.value) : input.value),
  );
  return input;
}

/** Live write of a session (pi-rpc) key — no restart. */
async function applyRpcSetting(setting: PiSetting, value: unknown): Promise<void> {
  switch (setting.key) {
    case "steeringMode":
      if (value === "one-at-a-time" || value === "all") {
        await rpcRequest(rpc.setSteeringMode(value));
        steeringMode = value;
      }
      break;
    case "followUpMode":
      if (value === "one-at-a-time" || value === "all") {
        await rpcRequest(rpc.setFollowUpMode(value));
        followUpMode = value;
      }
      break;
    case "autoCompaction":
      await rpcRequest(rpc.setAutoCompaction(value === true));
      autoCompactionEnabled = value === true;
      break;
  }
}

/** Applies every staged settings section through one action and one host restart. */
async function applyAllSettings(): Promise<void> {
  if (applyingSettings) return;
  const pending = [...pendingPiSettings.entries()];
  const browserChanged = browserServerUrlDirty();
  const flagsChanged = cliDirty;
  if (!browserChanged && !flagsChanged && pending.length === 0) return;

  const rpcChanges: Array<{ setting: PiSetting; value: unknown }> = [];
  const fileChanges: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of pending) {
    const setting = piSettings.find((candidate) => candidate.key === key);
    if (!setting) continue;
    if (setting.source === "pi-rpc") rpcChanges.push({ setting, value });
    else fileChanges.push({ key, value });
  }
  const needsRestart = browserChanged || flagsChanged || fileChanges.length > 0;
  if (working && needsRestart) {
    const ok = await showConfirm(t("settingsApplyRestartWarn"));
    if (!ok) return;
    await stopWorking();
  }

  applyingSettings = true;
  els.settingsApply.disabled = true;
  els.settingsApplyHint.textContent = t("settingsApplying");
  try {
    for (const change of rpcChanges) {
      await applyRpcSetting(change.setting, change.value);
      change.setting.value = change.value;
    }

    if (fileChanges.length > 0 || flagsChanged) {
      const result = await ideRequest({
        type: "applySettings",
        settings: fileChanges,
        ...(flagsChanged ? { flags: currentCliValues() } : {}),
        ...(currentSessionPath ? { sessionPath: currentSessionPath } : {}),
      });
      if (!result?.ok) {
        els.settingsApplyHint.textContent = result?.error ?? t("piSettingSetFailed");
        addStatusLine(t("piSettingSetFailed"));
        return;
      }
      for (const change of fileChanges) {
        const setting = piSettings.find((candidate) => candidate.key === change.key);
        if (setting) setting.value = change.value;
      }
      if (flagsChanged) {
        savedCliValues = currentCliValues();
        cliDirty = false;
      }
    }

    pendingPiSettings.clear();
    renderPiSettings();
    updateSettingsApplyState();

    if (browserChanged) {
      els.settingsBrowserStatus.textContent = t("connecting");
      const started = await connectConfiguredBrowserServer(els.settingsBrowserUrl.value);
      if (!started) {
        els.settingsBrowserStatus.textContent = browserConnectionError;
        return;
      }
      savedBrowserServerUrl = els.settingsBrowserUrl.value.trim();
      browserServerUrlReady = true;
    } else {
      closeSettings();
    }
  } finally {
    applyingSettings = false;
    els.settingsApply.disabled = false;
    updateSettingsApplyState();
  }
}

els.settingsApply.addEventListener("click", () => {
  void applyAllSettings();
});

function openSettings(): void {
  els.settingsModal.hidden = false;
  els.settingsBtn.setAttribute("aria-expanded", "true");
  els.settingsBrowserSection.hidden = !runtime.isBrowserExtension;
  if (runtime.isBrowserExtension) {
    els.settingsBrowserStatus.textContent = "";
    els.settingsBrowserPermissionsStatus.textContent = "";
    browserServerUrlReady = false;
    void getBrowserServerUrl().then((url) => {
      if (els.settingsModal.hidden) return;
      savedBrowserServerUrl = url;
      els.settingsBrowserUrl.value = url;
      browserServerUrlReady = true;
      updateSettingsApplyState();
    });
  }
  refreshVersionInfo();
  refreshCliFlags();
  void fetchPiSettings();
  if (!speechInputUnavailableInThisContainer()) {
    void refreshSpeechDevices(false);
    void refreshSpeechModelAvailability();
    void refreshSpeechMicrophonePermission();
  }
}

function closeSettings(): void {
  els.settingsModal.hidden = true;
  els.settingsBtn.setAttribute("aria-expanded", "false");
  // Staged restart-sensitive changes are discarded when the dialog closes
  // without using the single settings-footer Apply action.
  pendingPiSettings.clear();
  cliDirty = false;
  browserServerUrlReady = false;
  speechShortcutCapture = null;
  updateSettingsApplyState();
  renderSpeechSettings();
  renderPiSettings();
}

els.settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (els.settingsModal.hidden) openSettings();
  else closeSettings();
});

els.settingsClose.addEventListener("click", () => closeSettings());
els.settingsModal.addEventListener("click", (e) => {
  if (e.target === els.settingsModal) closeSettings();
});

els.settingsBrowserUrl.addEventListener("input", updateSettingsApplyState);

els.settingsBrowserResetPermissions.addEventListener("click", () => {
  if (!runtime.isBrowserExtension) return;
  void (async () => {
    els.settingsBrowserResetPermissions.disabled = true;
    try {
      await browserSessionSettingsReady;
      browserSessionPermissions = [];
      browserPersistentPermissions = {};
      currentSessionSettings = { ...currentSessionSettings };
      delete currentSessionSettings.browserToolPermissions;
      if (currentSessionPath) persistCurrentSessionSettings();
      else sessionSettingsNeedPersistence = false;
      persistWebviewConfig({ browserToolPermissions: {} });
      els.settingsBrowserPermissionsStatus.textContent = t("browserPermissionsResetDone");
    } finally {
      els.settingsBrowserResetPermissions.disabled = false;
    }
  })();
});

// --- session dropdown -------------------------------------------------------

els.sessionBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = els.sessionMenu.hidden;
  els.sessionMenu.hidden = !opening;
  if (opening) {
    els.sessionSearch.value = "";
    populateSessionMenu();
    requestAnimationFrame(() => els.sessionSearch.focus());
  }
  closeSettings();
});

els.sessionSearch.addEventListener("input", populateSessionMenu);

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

// set the name of the CURRENT session: the name lives in pi's memory
// (set_session_name RPC); the session box and the title are updated locally.
// Shared by the session-box rename and the /name command.
async function applyCurrentSessionName(newName: string): Promise<void> {
  const res = await rpcRequest({ type: "set_session_name", name: newName });
  if (!res.success) {
    addStatusLine(t("renameFailed"));
    return;
  }
  const idx = sessions.findIndex((x) => x.path === currentSessionPath);
  const cur = idx >= 0 ? sessions[idx] : undefined;
  if (cur) sessions[idx] = { ...cur, name: newName };
  populateSessionMenu();
  void refreshSessionTitle(); // updates box and title
}

async function renameSessionFlow(path: string): Promise<void> {
  const s = sessions.find((x) => x.path === path);
  if (!s) return;
  // initial value: assigned name or current label (first message)
  const initial = s.name && !hasCjk(s.name) ? s.name : sessionLabel(s);
  const next = await showPrompt(initial, t("renameSession"));
  if (next === null) return; // cancelled
  const newName = next.trim();
  if (!newName || newName === initial) return; // empty or unchanged
  if (path === currentSessionPath) {
    await applyCurrentSessionName(newName);
    return;
  }
  const res = await ideRequest({ type: "renameSession", path, name: newName });
  if (!res?.ok) {
    addStatusLine(t("renameFailed"));
    return;
  }
  const idx = sessions.findIndex((x) => x.path === path);
  const cur = idx >= 0 ? sessions[idx] : undefined;
  if (cur) sessions[idx] = { ...cur, name: newName };
  populateSessionMenu();
}

async function deleteSessionFlow(path: string): Promise<void> {
  const s = sessions.find((x) => x.path === path);
  const isCurrent = path === currentSessionPath;
  const label = s ? sessionLabel(s) : t("newSession");
  const ok = await showConfirm(
    tpl(isCurrent ? t("deleteAskCurrent") : t("deleteAsk"), { name: label }),
  );
  if (!ok || !beginSessionTransition()) return;
  let historyLoaded = false;
  try {
    // Deleting the CURRENT session: switch to a fresh one FIRST, so pi stops
    // writing to the old file before it is unlinked.
    if (isCurrent) {
      els.thread.textContent = "";
      try {
        const response = await rpcRequest({ type: "new_session" });
        if (response.success) {
          currentSessionPath = null;
          refreshSessionNotificationOverride();
          renderNativeQueues([], []);
        }
      } catch {
        // new_session failed: delete anyway, refreshSessions realigns
      }
    }
    const res = await ideRequest({ type: "deleteSession", path });
    if (!res?.ok) {
      addStatusLine(t("deleteFailed"));
      return;
    }
    await refreshSessions();
    historyLoaded = true;
    els.sessionMenu.hidden = false; // show the updated list after the loader
  } finally {
    finishSessionTransition(historyLoaded);
  }
}

// new session: closes the dropdown and reloads with the fresh session
async function startNewSession(): Promise<void> {
  if (!beginSessionTransition()) return;
  let historyLoaded = false;
  try {
    const res = await rpcRequest({ type: "new_session" });
    if (!res.success) return;
    currentSessionPath = null;
    refreshSessionNotificationOverride();
    renderNativeQueues([], []);
    els.thread.textContent = "";
    sessionHasMessages = false;
    // refreshSessions → loadHistory renders the welcome banner (Context/
    // Skills/Extensions) while the new session chat is still empty.
    await refreshSessions();
    historyLoaded = true;
    // pi may assign the name late: update box and title when it arrives
    pollSessionTitle();
  } catch {
    // new_session failed: the current session stays
  } finally {
    finishSessionTransition(historyLoaded);
  }
}

async function forkSessionIntoCurrentWorkspace(path: string): Promise<void> {
  if (!beginSessionTransition()) return;
  let historyLoaded = false;
  try {
    const res = await ideRequest({ type: "forkSession", sourcePath: path });
    if (!res?.ok) return;
    const forkPath = (res.data as { path?: string } | undefined)?.path;
    if (forkPath) historyLoaded = await performSwitchSession(forkPath);
  } finally {
    finishSessionTransition(historyLoaded);
  }
}

// Session pick: Chrome can move its bridge channel to the selected session's
// original workspace, so it must never fork merely because All shows another
// path. Standalone keeps its explicit resume/fork/new chooser, while IDEs have
// a fixed host workspace and therefore retain their fork confirmation.
async function pickSession(path: string): Promise<void> {
  if (switchingSession) return;
  const session = sessions.find((candidate) => candidate.path === path);
  const crossWorkspace = Boolean(
    session?.cwd && workspacePath && !samePath(session.cwd, workspacePath),
  );
  const strategy = sessionPickStrategy(runtime.mode, crossWorkspace);
  if (strategy === "switch") {
    switchSession(path);
    return;
  }
  if (strategy === "reload-original") {
    await reloadBrowserSession(path);
    return;
  }
  if (strategy === "choose-standalone-action" && session?.cwd) {
    const action = await askCrossWorkspaceSessionAction(session.cwd);
    if (action === "resume") {
      await resumeSessionInWorkspace(path, session.cwd);
    } else if (action === "fork") {
      await forkSessionIntoCurrentWorkspace(path);
    } else if (action === "new") {
      await startNewSession();
    } else {
      els.sessionMenu.hidden = true;
    }
    return;
  }
  // IDE webviews cannot move the host workspace: preserve the existing fork
  // confirmation (custom modal; window.confirm does not work in webviews).
  const ok = await showConfirm(t("forkConfirm"));
  if (ok) await forkSessionIntoCurrentWorkspace(path);
  else els.sessionMenu.hidden = true;
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
    closeUpdateModal();
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

// stats bar position: applied IMMEDIATELY (the bar moves right away), then
// persisted in the global config for the next boot
els.statsBarPos.addEventListener("change", () => {
  const v = els.statsBarPos.value as StatsBarPosition;
  if (v === "above" || v === "below" || v === "topbar") {
    applyStatsBarPosition(v);
    persistWebviewConfig({ statsBarPosition: v });
  }
});

els.statsBarCompact.addEventListener("change", () => {
  applyStatsBarCompact(els.statsBarCompact.checked);
  persistWebviewConfig({ statsBarCompact });
});

// A presentation-mode change is a hard boundary for live internal activity.
// Existing completed DOM stays untouched; only the active chain is finalized.
function applyAgenticThinkingPreference(enabled: boolean): void {
  if (enabled === agenticThinking) return;
  breakInternalActivityChain();
  agenticThinking = enabled;
  els.agenticThinking.checked = enabled;
  agenticRunStartedAt = enabled && working ? performance.now() : 0;
}

els.agenticThinking.addEventListener("change", () => {
  applyAgenticThinkingPreference(els.agenticThinking.checked);
  persistWebviewConfig({ agenticThinking });
});

els.allowRemoteNpmUpdates.addEventListener("change", () => {
  void (async () => {
    if (!els.allowRemoteNpmUpdates.checked) {
      allowRemoteNpmUpdates = false;
      persistWebviewConfig({ allowRemoteNpmUpdates: false });
      return;
    }
    // Never persist the security-sensitive opt-in before explicit confirmation.
    els.allowRemoteNpmUpdates.checked = false;
    els.allowRemoteNpmUpdates.disabled = true;
    const confirmed = await showConfirm(t("settingsAllowRemoteNpmUpdatesConfirm"));
    els.allowRemoteNpmUpdates.disabled = false;
    if (!confirmed) return;
    allowRemoteNpmUpdates = true;
    els.allowRemoteNpmUpdates.checked = true;
    persistWebviewConfig({ allowRemoteNpmUpdates: true });
  })();
});

els.allowNpmInstallScripts.addEventListener("change", () => {
  void (async () => {
    if (!els.allowNpmInstallScripts.checked) {
      dangerouslyAllowAllNpmScripts = false;
      persistWebviewConfig({ dangerouslyAllowAllNpmScripts: false });
      return;
    }
    // This bypass lets arbitrary dependency lifecycle scripts run as the user.
    els.allowNpmInstallScripts.checked = false;
    els.allowNpmInstallScripts.disabled = true;
    const confirmed = await showConfirm(t("settingsAllowNpmInstallScriptsConfirm"));
    els.allowNpmInstallScripts.disabled = false;
    if (!confirmed) return;
    dangerouslyAllowAllNpmScripts = true;
    els.allowNpmInstallScripts.checked = true;
    persistWebviewConfig({ dangerouslyAllowAllNpmScripts: true });
  })();
});

els.settingsSpeechDevice.addEventListener("change", () => {
  updateSpeechConfig({
    ...speechConfig,
    inputByRuntime: {
      ...speechConfig.inputByRuntime,
      [speechRuntimeKey()]: els.settingsSpeechDevice.value || "default",
    },
  });
});

els.settingsSpeechRefreshDevices.addEventListener("click", () => {
  void refreshSpeechDevices(true);
});

els.settingsSpeechMode.addEventListener("change", () => {
  const mode = els.settingsSpeechMode.value;
  if (mode !== "push-to-talk" && mode !== "toggle-to-talk") return;
  updateSpeechConfig({ ...speechConfig, mode });
});

function beginSpeechShortcutCapture(kind: "pushToTalk" | "toggleToTalk"): void {
  speechShortcutCapture = kind;
  renderSpeechSettings();
}

els.settingsSpeechPushShortcutCapture.addEventListener("click", () => {
  beginSpeechShortcutCapture("pushToTalk");
});
els.settingsSpeechToggleShortcutCapture.addEventListener("click", () => {
  beginSpeechShortcutCapture("toggleToTalk");
});

els.settingsSpeechLanguage.addEventListener("change", () => {
  const language = els.settingsSpeechLanguage.value || "system";
  updateSpeechConfig({ ...speechConfig, language });
  void refreshSpeechModelAvailability();
});

els.settingsSpeechInstallModel.addEventListener("click", () => {
  void (async () => {
    if (!speechRuntime || speechModelInstalling) return;
    speechModelInstalling = true;
    renderSpeechSettings();
    const installed = await installLocalSpeechModel(
      speechRuntime,
      currentSpeechLanguage(),
    );
    speechModelInstalling = false;
    if (!installed) speechError = t("speechInstallFailed");
    await refreshSpeechModelAvailability();
    renderSpeechSettings();
    renderSpeechButton();
  })();
});

els.settingsSpeechPause.addEventListener("change", () => {
  const toggleSilenceMs = Number(els.settingsSpeechPause.value);
  updateSpeechConfig({ ...speechConfig, toggleSilenceMs });
});

els.settingsSpeechCloud.addEventListener("change", () => {
  void (async () => {
    if (!els.settingsSpeechCloud.checked) {
      updateSpeechConfig({ ...speechConfig, allowCloudTranscription: false });
      return;
    }
    els.settingsSpeechCloud.checked = false;
    els.settingsSpeechCloud.disabled = true;
    const confirmed = await showConfirm(t("speechCloudConfirm"));
    if (confirmed) {
      updateSpeechConfig({ ...speechConfig, allowCloudTranscription: true });
    }
    els.settingsSpeechCloud.disabled = false;
    renderSpeechSettings();
    renderSpeechButton();
  })();
});

if (typeof navigator !== "undefined" && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    void refreshSpeechDevices(false);
  });
}

document.addEventListener(
  "keydown",
  (event) => {
    if (speechShortcutCapture) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        speechShortcutCapture = null;
        renderSpeechSettings();
        return;
      }
      const shortcut = speechShortcutFromKeyboardEvent(event);
      if (!shortcut) return;
      event.preventDefault();
      event.stopPropagation();
      const kind = speechShortcutCapture;
      speechShortcutCapture = null;
      updateSpeechConfig({
        ...speechConfig,
        shortcuts: { ...speechConfig.shortcuts, [kind]: shortcut },
      });
      return;
    }
    if (speechPushShortcutKey && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      speechPushShortcutKey = null;
      speechController?.stopSilently();
      return;
    }
    if (
      event.repeat ||
      !speechCapabilities.recognition ||
      !els.settingsModal.hidden ||
      !document.hasFocus()
    ) {
      return;
    }
    const pushShortcut = speechConfig.shortcuts.pushToTalk;
    if (speechShortcutMatchesEvent(pushShortcut, event)) {
      event.preventDefault();
      event.stopPropagation();
      speechPushShortcutKey = event.code;
      void startSpeech("push-to-talk");
      return;
    }
    const toggleShortcut = speechConfig.shortcuts.toggleToTalk;
    if (speechShortcutMatchesEvent(toggleShortcut, event)) {
      event.preventDefault();
      event.stopPropagation();
      toggleSpeech();
    }
  },
  true,
);

function releasesSpeechPushShortcut(event: KeyboardEvent): boolean {
  if (!speechPushShortcutKey) return false;
  if (event.code === speechPushShortcutKey) return true;
  const shortcut = speechConfig.shortcuts.pushToTalk;
  return (
    (shortcut.includes("Ctrl") && /^(ControlLeft|ControlRight)$/.test(event.code)) ||
    (shortcut.includes("Alt") && /^(AltLeft|AltRight)$/.test(event.code)) ||
    (shortcut.includes("Shift") && /^(ShiftLeft|ShiftRight)$/.test(event.code)) ||
    (shortcut.includes("Meta") && /^(MetaLeft|MetaRight)$/.test(event.code))
  );
}

document.addEventListener(
  "keyup",
  (event) => {
    if (!releasesSpeechPushShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    speechPushShortcutKey = null;
    speechController?.releasePushToTalk();
  },
  true,
);

window.addEventListener("blur", () => {
  speechPushShortcutKey = null;
  speechController?.stopSilently();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    speechPushShortcutKey = null;
    speechController?.stopSilently();
  }
});
window.addEventListener("pagehide", () => speechController?.stopSilently());

els.speech.addEventListener("pointerdown", (event) => {
  if (speechConfig.mode !== "push-to-talk" || event.button !== 0) return;
  event.preventDefault();
  els.speech.setPointerCapture?.(event.pointerId);
  void startSpeech("push-to-talk");
});
els.speech.addEventListener("pointerup", (event) => {
  if (speechConfig.mode !== "push-to-talk") return;
  event.preventDefault();
  speechController?.releasePushToTalk();
});
els.speech.addEventListener("pointercancel", () => speechController?.stopSilently());
els.speech.addEventListener("lostpointercapture", () => {
  if (speechConfig.mode === "push-to-talk") speechController?.releasePushToTalk();
});
els.speech.addEventListener("click", () => {
  if (speechConfig.mode === "toggle-to-talk") toggleSpeech();
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
  currentSessionSettings = {
    ...currentSessionSettings,
    ...(sessionNotificationsOverride
      ? { notifications: sessionNotificationsOverride }
      : {}),
  };
  if (!sessionNotificationsOverride) delete currentSessionSettings.notifications;
  persistCurrentSessionSettings();
});

watchThemeChanges(() => applyTheme(themePref));

// --- sessions (dropdown) -----------------------------------------------------

let sessions: SessionInfo[] = [];
let currentSessionPath: string | null = null;
let switchingSession = false;

/** Lock the complete UI before starting any session-changing operation. */
function beginSessionTransition(maxWaitMs = LOADING_MAX_MS): boolean {
  if (switchingSession) return false;
  switchingSession = true;
  els.sessionMenu.hidden = true;
  beginSessionLoading(maxWaitMs);
  return true;
}

/** Keep the loader until refreshed history settles; unlock immediately on failure. */
function finishSessionTransition(historyLoaded: boolean): void {
  switchingSession = false;
  if (!historyLoaded) endSessionLoading();
  updateSendButton();
  populateSessionMenu();
}

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

function sessionDisplayLabel(s: SessionInfo): string {
  return isNewSession(s) && (!s.name || hasCjk(s.name))
    ? t("newSession")
    : sessionLabel(s);
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

function formatSessionEventTime(timestamp: number): string {
  return new Intl.DateTimeFormat(currentLocale === "it" ? "it-IT" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

// Human-readable on-disk size for the resume recap ("824 KB", "12.3 MB")
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  const n = value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  return `${n} ${units[i]}`;
}

// Pure UI status: it is appended after history on every real resume and is
// never written to the append-only session file.
function addSessionResumedStatus(info: SessionInfo): void {
  const timestamp = info.lastEventAt ?? info.lastActivity ?? info.mtime;
  if (!timestamp || !Number.isFinite(timestamp)) return;
  const date = formatSessionEventTime(timestamp);
  const size =
    typeof info.sizeBytes === "number" && info.sizeBytes > 0
      ? formatBytes(info.sizeBytes)
      : "";
  let base: string;
  if (typeof info.compactionCount !== "number") base = "sessionResumed";
  else if (info.compactionCount === 1) base = "sessionResumedCompactionsOne";
  else base = "sessionResumedCompactionsMany";
  const key = size ? `${base}Size` : base;
  addStatusLine(
    tpl(t(key), {
      date,
      size,
      count: String(info.compactionCount ?? 0),
    }),
  );
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
  if (!runtime.isVsCode && !runtime.isIDE) {
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
  const current = currentSession();
  newLabel.textContent =
    currentIsNew && current ? sessionDisplayLabel(current) : t("newSession");
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
    if (
      currentSessionPath &&
      !currentIsNew &&
      !list.some((s) => s.path === currentSessionPath)
    ) {
      list.unshift({ path: currentSessionPath, name: t("newSession") });
    }
    const query = els.sessionSearch.value.trim().toLocaleLowerCase(currentLocale);
    const filtered = query
      ? list.filter((s) => {
          const directoryName = s.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? "";
          return [sessionLabel(s), directoryName].some((value) =>
            value.toLocaleLowerCase(currentLocale).includes(query),
          );
        })
      : list;
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-empty";
      empty.textContent = t("noOptions");
      els.sessionItems.appendChild(empty);
    }
    for (const s of filtered) {
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
        filterMode === "all" && !!workspacePath && samePath(s.cwd, workspacePath),
      );
      const main = document.createElement("button");
      main.type = "button";
      main.className = "session-item-main";
      const label = document.createElement("span");
      label.className = "session-item-label";
      label.textContent = sessionDisplayLabel(s);
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
    ? sessionDisplayLabel(cur)
    : currentSessionPath
      ? t("newSession")
      : t("noSessions");
  updateDocumentTitle();
}

// current label reused by box and browser title
function currentSessionLabel(): string {
  const cur = currentSession();
  if (cur) return sessionDisplayLabel(cur);
  return currentSessionPath ? t("newSession") : t("noSessions");
}

// the browser title shows the session name, only outside the IDE
function updateDocumentTitle(): void {
  if (runtime.isVsCode || runtime.isIDE) return; // in the IDE the title is managed by the host
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
      if (s) {
        if (s.name !== name) {
          s.name = name;
          named = true;
        }
      } else {
        sessions.unshift({ path: currentSessionPath, name });
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
  if (res?.ok) void persistBrowserSessionUrl();
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

async function refreshSessions(showResumeNotice = false): Promise<boolean> {
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
              followUpMode?: string;
              autoCompactionEnabled?: boolean;
            }
          | undefined;
        if (data?.sessionFile) {
          currentSessionPath = data.sessionFile;
          persistSessionPath(); // resume the same session on IDE reloads
          void persistBrowserSessionUrl(); // refresh resumes this standalone channel
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
        if (
          typeof data?.followUpMode === "string" &&
          (data.followUpMode === "one-at-a-time" || data.followUpMode === "all")
        ) {
          followUpMode = data.followUpMode;
        }
        if (typeof data?.autoCompactionEnabled === "boolean") {
          autoCompactionEnabled = data.autoCompactionEnabled;
        }
        break; // pi ready
      }
    } catch {
      // pi not up yet: retry shortly
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const trust = await ideRequest({ type: "getTrust" });
  if (trust?.ok) renderTrust(trust.data as TrustResult | null);
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
  await fetchThinkingSettings();
  syncThinkingChat();
  populateSessionMenu();
  const historyLoaded = await loadHistory();
  updateSteerPlaceholder();
  if (showResumeNotice && historyLoaded && sessionHasMessages) {
    let info = currentSession();
    if (!info && currentSessionPath) {
      const infoRes = await ideRequest({
        type: "getSessionInfo",
        path: currentSessionPath,
      });
      if (infoRes?.ok) info = infoRes.data as SessionInfo;
    }
    if (info) addSessionResumedStatus(info);
  }
  void fetchSlashCommands(); // extension commands for the palette (plan 0003)
  return historyLoaded;
}

async function loadHistory(): Promise<boolean> {
  // a session switch/restart: no stale "waiting" state from the previous session
  disarmWaitingResponse();
  // Large sessions can take longer to serialize over RPC. Keep the overlay up
  // for the request instead of showing a blank conversation after 30 seconds.
  if (sessionLoading) {
    clearTimeout(loadingMaxTimer ?? undefined);
    loadingMaxTimer = setTimeout(
      loadingMaxTick,
      SESSION_HISTORY_TIMEOUT_MS + LOADING_MAX_MS,
    );
  }
  let loaded = false;
  try {
    const res = await rpcRequest(
      rpc.getMessages(),
      undefined,
      SESSION_HISTORY_TIMEOUT_MS,
    );
    const messages = (res.data as { messages?: unknown[] } | undefined)?.messages;
    if (!res.success || !Array.isArray(messages)) {
      throw new Error(
        typeof res.error === "string" && res.error
          ? res.error
          : t("sessionSwitchUnknownError"),
      );
    }
    // only the LAST historyLimit turns: the long history is
    // truncated from the top (never the whole session)
    renderHistory(messages.slice(-historyLimit));
    seedMessageHistory(messages.slice(-historyLimit));
    // welcome banner: only while the session has no real messages yet (new/
    // empty session) — checked on the DATA, not the DOM (loading logs are
    // flushed into the thread just below and would look like content)
    sessionHasMessages = messages.some((m) => {
      const role = (m as { role?: string }).role;
      return role === "user" || role === "assistant" || role === "custom";
    });
    loaded = true;
  } catch (error) {
    sessionHasMessages = false;
    addSystemBox(
      "error",
      tpl(t("sessionHistoryFailed"), {
        reason: error instanceof Error ? error.message : t("sessionSwitchUnknownError"),
      }),
    );
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
  // Only show the new-session banner if the history was actually loaded.
  if (loaded) void maybeShowStartupBanner();
  return loaded;
}

async function fetchThinkingSettings(): Promise<void> {
  hideThinkingBlock = false;
  const res = await ideRequest({ type: "getThinkingSettings" });
  if (!res?.ok) return;
  const settings = res.data as ThinkingSettings | null;
  if (typeof settings?.hideThinkingBlock === "boolean") {
    hideThinkingBlock = settings.hideThinkingBlock;
  }
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

interface DirectoryListing {
  path: string;
  parent: string | null;
  dirs: Array<{ name: string; path: string }>;
}

async function listDirs(path: string): Promise<DirectoryListing | null> {
  const res = await ideRequest({ type: "listDir", path });
  if (!res?.ok) return null;
  return res.data as DirectoryListing;
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
      const placeholder = document.createElement("div");
      placeholder.className = "folder-dirs-empty";
      placeholder.textContent = t("loading");
      dirsEl.appendChild(placeholder);
      const listing = await listDirs(current);
      dirsEl.textContent = "";
      if (!listing) {
        const empty = document.createElement("div");
        empty.className = "folder-dirs-empty";
        empty.textContent = "—";
        dirsEl.appendChild(empty);
        return;
      }
      current = listing.path;
      pathEl.textContent = current;
      // Native path operations run in the bridge, on the target OS.
      if (listing.parent) {
        const up = document.createElement("button");
        up.type = "button";
        up.className = "folder-dir folder-up";
        up.innerHTML = `${folderIcon()} <span>.. (${escapeHtml(t("parentFolder"))})</span>`;
        up.addEventListener("click", () => {
          current = listing.parent!;
          void load();
        });
        dirsEl.appendChild(up);
      }
      if (listing.dirs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "folder-dirs-empty";
        empty.textContent = "—";
        dirsEl.appendChild(empty);
      }
      for (const dir of listing.dirs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "folder-dir";
        btn.innerHTML = `${folderIcon()} <span>${escapeHtml(dir.name)}</span>`;
        btn.addEventListener("click", () => {
          current = dir.path;
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

type CrossWorkspaceSessionAction = "resume" | "fork" | "new";

function buildWarningModalLead(message: string): {
  row: HTMLDivElement;
  copy: HTMLDivElement;
} {
  const row = document.createElement("div");
  row.className = "modal-content";
  const icon = document.createElement("div");
  icon.className = "modal-icon";
  icon.innerHTML = trustIcon("warn-filled");
  const copy = document.createElement("div");
  copy.className = "modal-copy";
  const msg = document.createElement("div");
  msg.className = "modal-message";
  msg.textContent = message;
  copy.appendChild(msg);
  row.append(icon, copy);
  return { row, copy };
}

// Standalone only: a session outside the current workspace can stay original
// by moving the bridge cwd to its folder, or follow the existing fork/new
// alternatives. IDE webviews never open this dialog because their workspace
// belongs to the host.
function askCrossWorkspaceSessionAction(
  folder: string,
): Promise<CrossWorkspaceSessionAction | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const { row: lead } = buildWarningModalLead(
      `${t("crossWorkspaceSessionAsk")}\n\n${folder}`,
    );
    const actions = document.createElement("div");
    actions.className = "modal-actions session-workspace-actions";
    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "btn primary";
    resumeBtn.textContent = t("switchToSessionWorkspace");
    const forkBtn = document.createElement("button");
    forkBtn.type = "button";
    forkBtn.className = "btn";
    forkBtn.textContent = t("forkInCurrentWorkspace");
    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn";
    newBtn.textContent = t("newSessionCurrentWorkspace");
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("cancel");
    actions.append(resumeBtn, forkBtn, newBtn, cancelBtn);
    card.append(lead, actions);
    backdrop.appendChild(card);

    const done = (value: CrossWorkspaceSessionAction | null): void => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(value);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") done(null);
    };
    document.addEventListener("keydown", esc);
    resumeBtn.addEventListener("click", () => done("resume"));
    forkBtn.addEventListener("click", () => done("fork"));
    newBtn.addEventListener("click", () => done("new"));
    cancelBtn.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });

    document.body.appendChild(backdrop);
  });
}

async function reloadBrowserSession(path: string): Promise<void> {
  if (!beginSessionTransition()) return;
  let reloading = false;
  try {
    // A fresh Chrome channel resolves the session id to its original workspace
    // from the JSONL header. Avoid restarting pi inside the old channel: that
    // transition can race outstanding startup requests and strand the loader.
    currentSessionPath = path;
    await persistBrowserSessionUrl();
    reloading = true;
    location.reload();
  } finally {
    if (!reloading) finishSessionTransition(false);
  }
}

async function resumeSessionInWorkspace(path: string, folder: string): Promise<void> {
  if (!beginSessionTransition()) return;
  let historyLoaded = false;
  try {
    const res = await ideRequest({
      type: "setWorkspace",
      path: folder,
      action: "resume",
      sessionPath: path,
    });
    if (!res?.ok) return;
    const workspace =
      (res.data as { workspace?: string } | undefined)?.workspace ?? folder;
    workspacePath = workspace;
    workspaceLabel = workspace.split(/[\\/]/).pop() ?? "";
    currentSessionPath = path;
    els.thread.textContent = "";
    sessionHasMessages = false;
    await refreshSessions(true);
    historyLoaded = true;
  } catch {
    // The bridge could not switch/restart: the finally block unlocks the UI.
  } finally {
    finishSessionTransition(historyLoaded);
  }
}

// 3-choice dialog: move the session into the new folder (no duplicate), fork
// it there, new session, or cancel
function askWorkspaceAction(folder: string): Promise<"move" | "fork" | "new" | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const { row: lead } = buildWarningModalLead(
      `${t("changeWorkspaceAsk")}\n\n${folder}`,
    );
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const moveBtn = document.createElement("button");
    moveBtn.type = "button";
    moveBtn.className = "btn primary";
    moveBtn.textContent = t("moveSessionHere");
    const forkBtn = document.createElement("button");
    forkBtn.type = "button";
    forkBtn.className = "btn";
    forkBtn.textContent = t("forkHere");
    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn";
    newBtn.textContent = t("newSessionHere");
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("cancel");
    actions.append(moveBtn, forkBtn, newBtn, cancelBtn);
    card.append(lead, actions);
    backdrop.appendChild(card);

    const done = (val: "move" | "fork" | "new" | null): void => {
      backdrop.remove();
      resolve(val);
    };
    moveBtn.addEventListener("click", () => done("move"));
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
  // An empty session has nothing to preserve, fork or move: switch directly to
  // the selected workspace and let pi start its empty session there.
  const currentIsEmpty = !sessionHasMessages && isNewSession(currentSession());
  const choice = currentIsEmpty ? "new" : await askWorkspaceAction(target);
  if (!choice || !beginSessionTransition()) return;
  let historyLoaded = false;
  try {
    const res = await ideRequest({
      type: "setWorkspace",
      path: target,
      action: choice,
      ...(choice !== "new" && currentSessionPath
        ? { sessionPath: currentSessionPath }
        : {}),
    });
    if (!res?.ok) return;
    workspacePath = target;
    workspaceLabel = target.split(/[\\/]/).pop() ?? "";
    if (choice !== "new") {
      const nextPath = (res.data as { sessionPath?: string } | undefined)?.sessionPath;
      if (!nextPath) return;
      historyLoaded = await performSwitchSession(nextPath);
    } else {
      currentSessionPath = null;
      refreshSessionNotificationOverride();
      els.thread.textContent = "";
      sessionHasMessages = false;
      await refreshSessions();
      historyLoaded = true;
    }
  } finally {
    finishSessionTransition(historyLoaded);
  }
}

// Replaces ?new=1 with the current session id. The running WebSocket is
// untouched; a later browser refresh reconnects to this exact session without
// exposing its local filesystem path in the address bar.
async function persistBrowserSessionUrl(): Promise<void> {
  const sessionPath = currentSessionPath;
  if (runtime.isIDE || !sessionPath) return;
  let info = sessions.find((session) => session.path === sessionPath);
  if (!info?.id) {
    const res = await ideRequest({ type: "getSessionInfo", path: sessionPath });
    if (res?.ok) info = res.data as SessionInfo;
  }
  if (currentSessionPath !== sessionPath) return;
  if (!info?.id) {
    if (runtime.isBrowserExtension) {
      try {
        await persistBrowserServerNewSessionIntent();
      } catch {
        // The in-page URL remains the fallback for this panel lifetime.
      }
    }
    if (currentSessionPath !== sessionPath) return;
    const next = pageUrlForNewSession(location.href);
    if (next !== location.href) history.replaceState(null, "", next);
    return;
  }
  if (runtime.isBrowserExtension) {
    try {
      if (currentSessionPath === sessionPath) {
        await persistBrowserServerSession(info.id);
      }
    } catch {
      // The in-page URL still preserves the session for this panel lifetime.
    }
  }
  if (currentSessionPath !== sessionPath) return;
  const next = pageUrlForSession(location.href, info.id);
  if (next !== location.href) history.replaceState(null, "", next);
}

// Reports the materialized session path to every host. IDE companions persist
// it for reload; standalone uses it to persist CLI flags applied while the new
// session had no JSONL file yet.
function persistSessionPath(): void {
  if (!currentSessionPath) return;
  void ideRequest({ type: "storeSession", path: currentSessionPath });
  if (sessionSettingsNeedPersistence) persistCurrentSessionSettings();
}

function reportSessionSwitchFailure(reason: unknown): void {
  const detail =
    typeof reason === "string" && reason
      ? reason
      : reason instanceof Error
        ? reason.message
        : t("sessionSwitchUnknownError");
  addSystemBox("error", tpl(t("sessionSwitchFailed"), { reason: detail }));
}

async function performSwitchSession(path: string): Promise<boolean> {
  try {
    let info = sessions.find((session) => session.path === path);
    if (!info) {
      const infoRes = await ideRequest({ type: "getSessionInfo", path });
      if (infoRes?.ok) info = infoRes.data as SessionInfo;
    }
    const savedModel = info?.model;

    const res = await rpcRequest(
      { type: "switch_session", sessionPath: path },
      undefined,
      SESSION_SWITCH_TIMEOUT_MS,
    );
    const outcome = sessionSwitchOutcome(res);
    if (outcome === "cancelled") {
      addSystemBox("warn", t("sessionSwitchCancelled"));
      return false;
    }
    if (outcome === "failed") {
      reportSessionSwitchFailure(res.error);
      return false;
    }
    renderNativeQueues([], []);
    currentSessionPath = path;
    persistSessionPath();
    els.thread.textContent = "";
    // Refresh get_state after the switch. pi already restored the saved model.
    if (!(await refreshSessions(true))) return false;
    // A model removed from models.json cannot be restored by pi: the switch must
    // still happen, falling back to the default model of new sessions.
    if (savedModel) await fallbackResumeModel(savedModel);
    updateDocumentTitle();
    return true;
  } catch (error) {
    reportSessionSwitchFailure(error);
    return false;
  }
}

/** Default model of new sessions from the pi settings (host-side file). */
async function readDefaultModelFromSettings(): Promise<
  { provider: string; id: string } | undefined
> {
  const res = await ideRequest({ type: "getSettings", key: "defaultModel" });
  const data = res?.ok ? (res.data as PiSettingsResult | undefined) : undefined;
  const value = data?.settings?.find((setting) => setting.key === "defaultModel")
    ?.value as Partial<PiModelSettingValue> | undefined;
  return typeof value?.provider === "string" && typeof value.id === "string"
    ? { provider: value.provider, id: value.id }
    : undefined;
}

/** The session model no longer exists: apply the default model instead of
 *  refusing the switch, and report the fallback in the chat. */
async function fallbackResumeModel(savedModel: {
  provider: string;
  id: string;
}): Promise<void> {
  const availableRes = await rpcRequest(rpc.getAvailableModels()).catch(() => null);
  const models =
    (availableRes?.success
      ? (
          availableRes.data as
            | {
                models?: Array<{
                  provider: string;
                  id: string;
                  name?: string;
                  input?: string[];
                }>;
              }
            | undefined
        )?.models
      : undefined) ?? [];
  if (models.some((m) => m.provider === savedModel.provider && m.id === savedModel.id)) {
    return; // still available: nothing to do
  }
  const target = await readDefaultModelFromSettings();
  const usable = target
    ? models.find((m) => m.provider === target.provider && m.id === target.id)
    : undefined;
  if (!usable) {
    addSystemBox("error", t("modelFallbackUnavailable"));
    return;
  }
  const r = await rpcRequest(rpc.setModel(usable.provider, usable.id));
  if (!r.success) {
    addSystemBox("error", t("modelFallbackUnavailable"));
    return;
  }
  currentModel = usable;
  modelSupportsVision = Array.isArray(usable.input) && usable.input.includes("image");
  modelInfoText = [usable.provider, usable.name ?? usable.id].filter(Boolean).join(" · ");
  renderModelInfo();
  renderAttachments();
  void fetchSessionStats();
  void fetchBalance();
  addSystemBox(
    "warn",
    tpl(t("modelFallback"), { model: `${usable.provider}/${usable.id}` }),
  );
}

function switchSession(path: string): void {
  if (
    !path ||
    path === currentSessionPath ||
    !beginSessionTransition(SESSION_SWITCH_TIMEOUT_MS + LOADING_MAX_MS)
  )
    return;
  void (async () => {
    let historyLoaded = false;
    try {
      historyLoaded = await performSwitchSession(path);
    } finally {
      finishSessionTransition(historyLoaded);
    }
  })();
}

// --- message rendering -----------------------------------------------------

const stream = emptyStream();
let currentMsg: HTMLElement | null = null;
let thinkingSlot: HTMLElement | null = null;
let currentText: HTMLElement | null = null;
let assistantStreamPrepared = false;
let markdownAccum = "";
let renderPending = false;
let thinkingEl: HTMLElement | null = null;
let thinkingContentEl: HTMLElement | null = null;
let thinkingSpinnerEl: HTMLElement | null = null;
let thinkingTimerEl: HTMLElement | null = null;
let thinkingStartedAt = 0;
let thinkingTimer: number | null = null;
let thinkingRenderFrame: number | null = null;
let thinkingRenderedLength = 0;
// Raw text of every thinking body (live and resumed ones). The markdown is
// rendered from this source only while the block is open: a collapsed thought
// is never formatted, and never re-parsed, while its reasoning streams.
const thinkingBodySources = new WeakMap<HTMLElement, () => string>();
const thinkingBodyPainted = new WeakMap<HTMLElement, string>();
// the STOP button lives in the STATUS BAR (right of the context):
// red, visible only with an active turn, clickable independently
function updateThinkingStopBtn(visible: boolean): void {
  els.statsStop.hidden = !visible;
}

// STOP: like pi.dev's Escape — asks pi to clear its own queues, restores
// their text in the editor, and sends abort immediately afterwards.
els.statsStop.innerHTML = stopIcon();
els.statsStop.title = t("stopWorking");

function stopWorking(): Promise<void> {
  if (!transport || !working) return Promise.resolve();
  // dequeueSteering sends clear_queue synchronously before returning its
  // promise. Abort is sent right afterwards: no client-side delivery delay.
  const restored = dequeueSteering();
  transport.send({ channel: "rpc", payload: rpc.abort() });
  setComposerActivity("abort");
  disarmWaitingResponse();
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
  return restored;
}

els.statsStop.addEventListener("click", () => void stopWorking());

// Esc during processing = STOP (like pi.dev). The modals (confirm/
// prompt) already close on Esc in the capture phase with stopPropagation:
// nothing arrives here while a modal is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (els.settingsModal && !els.settingsModal.hidden) return; // settings open
  if (working) {
    e.preventDefault();
    void stopWorking();
  }
});
let thinkingAccum = "";
let thinkingContentRendered = false;
let toolsEl: HTMLElement | null = null;
let toolsPre: HTMLPreElement | null = null;
let toolsText = "";

function addMsg(
  kind: "user" | "assistant" | "status",
  before?: HTMLElement | null,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = `msg ${kind}`;
  if (before?.parentElement === els.thread) els.thread.insertBefore(wrapper, before);
  else els.thread.appendChild(wrapper);
  // runtime: the history never exceeds historyLimit — truncate from the top
  while (els.thread.children.length > historyLimit) {
    els.thread.firstElementChild?.remove();
  }
  scrollToBottom();
  return wrapper;
}

// Distance at which scrolling back down resumes automatic following. Keep it
// close to zero: even a small upward wheel movement must release the viewport.
const SCROLL_RESUME_MARGIN = 4;

// Is the user following the chat? Content growth never disables this state:
// only an actual upward movement does. This prevents streaming updates from
// being mistaken for the user leaving the bottom.
let stickToBottom = true;

function alignMessagesToBottom(): void {
  const el = els.messages;
  el.scrollTop = el.scrollHeight;
}

// Smart auto-scroll: follows only if the user is already at the bottom.
let scrollFrame: number | null = null;
let forceScrollPending = false;
let followScrollPending = false;

function cancelPendingFollow(): void {
  stickToBottom = false;
  followScrollPending = false;
  forceScrollPending = false;
}

function scrollToBottom(force = false): void {
  if (!force && !stickToBottom) return;
  forceScrollPending ||= force;
  // Preserve the follow decision made before the DOM grew. A layout-triggered
  // scroll event can observe the new distance before this frame runs; it must
  // not turn an already-following chat into a detached one.
  followScrollPending ||= stickToBottom;
  // Streaming can request scrolling many times before the browser paints.
  // Coalesce those requests so they cannot starve the thinking clock.
  if (scrollFrame !== null) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    const shouldAlign = forceScrollPending || followScrollPending;
    forceScrollPending = false;
    followScrollPending = false;
    if (shouldAlign) {
      stickToBottom = true;
      alignMessagesToBottom();
    }
  });
}

interface CollapseFooterBinding {
  root: HTMLElement;
  header: HTMLElement;
  body: HTMLElement;
  footerHost: HTMLElement;
  footer: HTMLElement;
  expanded: () => boolean;
  collapse: () => void;
  resizeObserver: ResizeObserver;
  mutationObserver: MutationObserver;
  frame: number | null;
}

const collapseFooterBindings = new Map<HTMLElement, CollapseFooterBinding>();
const COLLAPSIBLE_SELECTOR =
  "details.tool-card, details.session-card, .thinking-card, .agentic-thinking-card";

function repeatedCollapseHeaderParts(header: HTMLElement): string[] {
  const parts: string[] = [];
  for (const child of header.children) {
    if (child.matches(".collapse-footer")) continue;
    if (child.classList.contains("agentic-thinking-counts")) {
      for (const count of child.querySelectorAll<HTMLElement>(
        ":scope > .agentic-thinking-count",
      )) {
        parts.push(
          joinCollapseHeaderParts(
            Array.from(count.children, (item) => item.textContent ?? ""),
          ),
        );
      }
      continue;
    }
    const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  }
  return parts;
}

function cloneCollapseHeaderChild(child: Element): Element | null {
  if (child.matches(".collapse-footer")) return null;
  const copy = child.cloneNode(true) as Element;
  for (const identified of copy.querySelectorAll<HTMLElement>("[id]")) {
    identified.removeAttribute("id");
  }
  copy.removeAttribute("id");
  return copy;
}

function sameCloneShape(target: Node, source: Node): boolean {
  if (target.nodeType !== source.nodeType) return false;
  if (target instanceof Element && source instanceof Element) {
    return (
      target.tagName === source.tagName && target.namespaceURI === source.namespaceURI
    );
  }
  return true;
}

function syncClonedNode(target: Node, source: Node): void {
  if (target.nodeType === Node.TEXT_NODE && source.nodeType === Node.TEXT_NODE) {
    if (target.textContent !== source.textContent)
      target.textContent = source.textContent;
    return;
  }
  if (!(target instanceof Element) || !(source instanceof Element)) return;
  for (const attribute of Array.from(target.attributes)) {
    if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(source.attributes)) {
    if (target.getAttribute(attribute.name) !== attribute.value) {
      target.setAttribute(attribute.name, attribute.value);
    }
  }
  const targets = Array.from(target.childNodes);
  const sources = Array.from(source.childNodes);
  if (
    targets.length !== sources.length ||
    targets.some((node, index) => !sameCloneShape(node, sources[index]!))
  ) {
    target.replaceChildren(...sources.map((node) => node.cloneNode(true)));
    return;
  }
  for (let index = 0; index < targets.length; index += 1) {
    syncClonedNode(targets[index]!, sources[index]!);
  }
}

function wireCollapseFooterActions(binding: CollapseFooterBinding): void {
  const sourceButtons = Array.from(binding.header.querySelectorAll("button"));
  const clonedButtons = Array.from(binding.footer.querySelectorAll("button"));
  for (let index = 0; index < clonedButtons.length; index += 1) {
    const clone = clonedButtons[index]!;
    const source = sourceButtons[index];
    clone.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      source?.click();
    };
  }
}

function syncCollapseFooterHeader(binding: CollapseFooterBinding): string {
  binding.footer.className = `collapse-footer ${Array.from(binding.header.classList).join(" ")}`;
  let icon = binding.footer.querySelector<HTMLElement>(":scope > .collapse-footer-icon");
  if (!icon) {
    icon = document.createElement("span");
    icon.className = "collapse-footer-icon";
    icon.innerHTML = arrowUpIcon();
    binding.footer.prepend(icon);
  }
  const sources = Array.from(binding.header.children)
    .map(cloneCollapseHeaderChild)
    .filter((child): child is Element => child !== null);
  const targets = Array.from(binding.footer.children).filter((child) => child !== icon);
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]!;
    const target = targets[index];
    if (!target) {
      binding.footer.appendChild(source);
    } else if (!sameCloneShape(target, source)) {
      target.replaceWith(source);
    } else {
      syncClonedNode(target, source);
    }
  }
  for (const extra of targets.slice(sources.length)) extra.remove();
  wireCollapseFooterActions(binding);
  return joinCollapseHeaderParts(repeatedCollapseHeaderParts(binding.header));
}

function updateCollapseFooter(binding: CollapseFooterBinding): void {
  binding.frame = null;
  if (!binding.root.isConnected) {
    binding.resizeObserver.disconnect();
    binding.mutationObserver.disconnect();
    collapseFooterBindings.delete(binding.root);
    return;
  }
  // Streaming content can be appended after the footer. Keep the collapse
  // control at the actual bottom of the expanded section.
  if (binding.footerHost.lastElementChild !== binding.footer) {
    binding.footerHost.appendChild(binding.footer);
  }
  const headerText = syncCollapseFooterHeader(binding) || t("collapseSection");
  const title = t("collapseSection");
  binding.footer.title = title;
  binding.footer.setAttribute("aria-label", `${title}: ${headerText}`);
  const rootFontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const visibleFooterHeight = binding.footer.hidden ? 0 : binding.footer.offsetHeight;
  binding.footer.hidden = !shouldShowCollapseFooter(
    binding.expanded(),
    binding.root.scrollHeight,
    visibleFooterHeight,
    Number.isFinite(rootFontSize) ? rootFontSize : 16,
  );
}

function scheduleCollapseFooterUpdate(binding: CollapseFooterBinding): void {
  if (binding.frame !== null) return;
  binding.frame = requestAnimationFrame(() => updateCollapseFooter(binding));
}

function enhanceCollapsible(root: HTMLElement): void {
  if (collapseFooterBindings.has(root)) return;
  let header: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let footerHost: HTMLElement | null = null;
  let expanded: (() => boolean) | null = null;
  let collapse: (() => void) | null = null;

  if (root instanceof HTMLDetailsElement) {
    header = root.querySelector<HTMLElement>(":scope > summary");
    // A tool can append args, output and diff as separate body sections over
    // time. Observe the complete <details> and keep the footer after all of
    // them, rather than binding it to only the first .code-block.
    body = root;
    footerHost = root;
    expanded = () => root.open;
    collapse = () => {
      root.open = false;
    };
  } else if (root.classList.contains("agentic-thinking-card")) {
    header = root.querySelector<HTMLElement>(":scope > .agentic-thinking-head");
    body = root.querySelector<HTMLElement>(":scope > .agentic-thinking-body");
    footerHost = root;
    expanded = () => !body?.hidden;
    collapse = () => {
      if (body) setThinkingBodyExpanded(body, false);
      updateThinkingBlocksButton();
    };
  } else {
    header = root.querySelector<HTMLElement>(":scope > .thinking-head");
    body = root.querySelector<HTMLElement>(":scope > .thinking-content");
    footerHost = body;
    // Thoughts inside Agentic thinking are intentionally always expanded and
    // are controlled by the parent Agentic block, not by a nested footer.
    if (header?.getAttribute("role") !== "button") return;
    expanded = () => !body?.hidden;
    collapse = () => {
      if (body) setThinkingBodyExpanded(body, false);
      updateThinkingBlocksButton();
    };
  }
  if (!header || !body || !footerHost || !expanded || !collapse) return;

  const footer = document.createElement("div");
  footer.className = "collapse-footer";
  footer.classList.add(...header.classList);
  footer.hidden = true;
  footer.tabIndex = 0;
  footer.setAttribute("role", "button");

  const mutationObserver = new MutationObserver((records) => {
    if (
      records.every((record) =>
        record.target instanceof Node ? footer.contains(record.target) : false,
      )
    ) {
      return;
    }
    scheduleCollapseFooterUpdate(binding);
  });
  const resizeObserver = new ResizeObserver(() => scheduleCollapseFooterUpdate(binding));
  const binding: CollapseFooterBinding = {
    root,
    header,
    body,
    footerHost,
    footer,
    expanded,
    collapse,
    resizeObserver,
    mutationObserver,
    frame: null,
  };
  collapseFooterBindings.set(root, binding);
  const collapseFromFooter = (): void => {
    binding.footer.hidden = true;
    binding.collapse();
    binding.header.focus({ preventScroll: true });
    scheduleCollapseFooterUpdate(binding);
  };
  footer.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest("button, a")) return;
    event.preventDefault();
    event.stopPropagation();
    collapseFromFooter();
  });
  footer.addEventListener("keydown", (event) => {
    if (event.target !== footer || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    collapseFromFooter();
  });
  footerHost.appendChild(footer);
  mutationObserver.observe(header, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  mutationObserver.observe(body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: root instanceof HTMLDetailsElement ? ["hidden", "open"] : ["hidden"],
  });
  if (root instanceof HTMLDetailsElement) {
    root.addEventListener("toggle", () => scheduleCollapseFooterUpdate(binding));
  }
  resizeObserver.observe(root);
  scheduleCollapseFooterUpdate(binding);
}

function enhanceCollapseFooters(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  if (node.matches(COLLAPSIBLE_SELECTOR)) enhanceCollapsible(node);
  for (const root of node.querySelectorAll<HTMLElement>(COLLAPSIBLE_SELECTOR)) {
    enhanceCollapsible(root);
  }
}

function refreshCollapseFooters(): void {
  for (const binding of collapseFooterBindings.values()) {
    scheduleCollapseFooterUpdate(binding);
  }
}

function discardCollapseFooters(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  for (const [root, binding] of collapseFooterBindings) {
    if (root !== node && !node.contains(root)) continue;
    if (binding.frame !== null) cancelAnimationFrame(binding.frame);
    binding.resizeObserver.disconnect();
    binding.mutationObserver.disconnect();
    collapseFooterBindings.delete(root);
  }
}

// Adding a chat block and filling it are separate operations throughout the
// renderer. Observe all structural additions so a block completed after
// addMsg() still keeps the viewport at the bottom. The same pass discovers
// every collapsible chat section and installs its long-content footer.
const chatBlockObserver = new MutationObserver((records) => {
  let elementAdded = false;
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      elementAdded = true;
      enhanceCollapseFooters(node);
    }
    for (const node of record.removedNodes) discardCollapseFooters(node);
  }
  if (elementAdded) scrollToBottom();
});
chatBlockObserver.observe(els.thread, { childList: true, subtree: true });

// ResizeObserver also covers late layout growth such as images, fonts and
// expanded Markdown content.
const chatSizeObserver = new ResizeObserver(() => scrollToBottom());
chatSizeObserver.observe(els.thread);

interface AgenticBlock {
  wrapper: HTMLElement;
  root: HTMLElement;
  body: HTMLElement;
  spinner: HTMLElement | null;
  timer: HTMLElement;
  startedAt: number | null;
  clock: ReturnType<typeof setInterval> | null;
}

const AGENTIC_METRICS: AgenticMetric[] = ["thought", "read", "write", "bash", "tools"];
const AGENTIC_LABELS: Record<AgenticMetric, string> = {
  thought: "agenticThought",
  read: "agenticRead",
  write: "agenticWrite",
  bash: "agenticBash",
  tools: "agenticTools",
};
let activeAgenticBlock: AgenticBlock | null = null;
let agenticRunStartedAt = 0;
const runningAgenticBlocks = new Set<AgenticBlock>();

const AGENTIC_DATA_SUFFIX: Record<AgenticMetric, string> = {
  thought: "Thought",
  read: "Read",
  write: "Write",
  bash: "Bash",
  tools: "Tools",
};

function agenticMetricProgress(
  root: HTMLElement,
  metric: AgenticMetric,
): AgenticMetricProgress {
  const suffix = AGENTIC_DATA_SUFFIX[metric];
  return {
    count: Number(root.dataset[`count${suffix}`] ?? 0),
    running: Number(root.dataset[`running${suffix}`] ?? 0),
    errors: Number(root.dataset[`errors${suffix}`] ?? 0),
    interrupted: Number(root.dataset[`interrupted${suffix}`] ?? 0),
  };
}

function storeAgenticMetricProgress(
  root: HTMLElement,
  metric: AgenticMetric,
  progress: AgenticMetricProgress,
): void {
  const suffix = AGENTIC_DATA_SUFFIX[metric];
  root.dataset[`count${suffix}`] = String(progress.count);
  root.dataset[`running${suffix}`] = String(progress.running);
  root.dataset[`errors${suffix}`] = String(progress.errors);
  root.dataset[`interrupted${suffix}`] = String(progress.interrupted);
}

function agenticCounts(root: HTMLElement): AgenticCounts {
  return {
    thought: agenticMetricProgress(root, "thought").count,
    read: agenticMetricProgress(root, "read").count,
    write: agenticMetricProgress(root, "write").count,
    bash: agenticMetricProgress(root, "bash").count,
    tools: agenticMetricProgress(root, "tools").count,
  };
}

function storeAgenticCounts(root: HTMLElement, counts: AgenticCounts): void {
  for (const metric of AGENTIC_METRICS) {
    storeAgenticMetricProgress(root, metric, {
      ...emptyAgenticMetricProgress(),
      count: counts[metric],
    });
  }
}

const agenticCountPulses = new WeakMap<HTMLElement, AgenticCountPulse>();

function updateAgenticCountNumber(
  root: HTMLElement,
  number: HTMLElement,
  count: number,
): void {
  let pulse = agenticCountPulses.get(number);
  if (!pulse) {
    pulse = new AgenticCountPulse(count, {
      setValue: (value) => {
        number.textContent = String(value);
      },
      setPulsing: (active) => {
        number.classList.remove("agentic-thinking-count-number-pulse");
        if (active) {
          // Force style calculation so removing and immediately re-adding the
          // class restarts the animation when a newer count arrives.
          void number.offsetWidth;
          number.classList.add("agentic-thinking-count-number-pulse");
        }
      },
    });
    agenticCountPulses.set(number, pulse);
    return;
  }
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  pulse.set(count, root.dataset.animateCounts === "true" && !reducedMotion);
}

function disposeAgenticCountItem(item: HTMLElement): void {
  const number = item.querySelector<HTMLElement>(".agentic-thinking-count-number");
  if (!number) return;
  agenticCountPulses.get(number)?.dispose();
  agenticCountPulses.delete(number);
}

function renderAgenticThinkingSummary(root: HTMLElement): void {
  const label = root.querySelector<HTMLElement>(".agentic-thinking-label");
  if (label) {
    label.textContent = t(agenticHeaderLabelKey(root.dataset.waitingOnly === "true"));
  }
  const summary = root.querySelector<HTMLElement>(".agentic-thinking-counts");
  if (!summary) return;
  const existing = new Map<AgenticMetric, HTMLElement>();
  for (const item of summary.querySelectorAll<HTMLElement>(
    ":scope > .agentic-thinking-count[data-agentic-metric]",
  )) {
    existing.set(item.dataset.agenticMetric as AgenticMetric, item);
  }

  const ordered: HTMLElement[] = [];
  for (const metric of AGENTIC_METRICS) {
    const progress = agenticMetricProgress(root, metric);
    let item = existing.get(metric);
    if (progress.count <= 0) {
      if (item) {
        disposeAgenticCountItem(item);
        item.remove();
      }
      continue;
    }
    if (!item) {
      item = document.createElement("span");
      item.dataset.agenticMetric = metric;
      const name = document.createElement("span");
      name.className = "agentic-thinking-count-name";
      const value = document.createElement("strong");
      value.className = "agentic-thinking-count-value";
      const number = document.createElement("span");
      number.className = "agentic-thinking-count-number";
      value.appendChild(number);
      item.append(name, value);
      summary.appendChild(item);
    }
    item.className = `agentic-thinking-count agentic-thinking-count-${agenticMetricVisualState(progress)}`;
    const name = item.querySelector<HTMLElement>(".agentic-thinking-count-name");
    if (name) name.textContent = t(AGENTIC_LABELS[metric]);
    const value = item.querySelector<HTMLElement>(".agentic-thinking-count-value");
    const number = value?.querySelector<HTMLElement>(".agentic-thinking-count-number");
    if (number) updateAgenticCountNumber(root, number, progress.count);
    let error = value?.querySelector<HTMLElement>(".agentic-thinking-count-error");
    if (progress.errors > 0 && value) {
      if (!error) {
        error = document.createElement("span");
        error.className = "agentic-thinking-count-error";
        error.textContent = "!";
        value.appendChild(error);
      }
      error.title = t("agenticCountHasErrors");
      error.setAttribute("aria-label", error.title);
    } else {
      error?.remove();
    }
    ordered.push(item);
  }

  // Keep the canonical metric order without recreating stable animated nodes.
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index]!;
    const current = summary.children.item(index);
    if (current !== item) summary.insertBefore(item, current);
  }
  const activeItems = new Set(ordered);
  for (const item of Array.from(summary.children)) {
    if (!(item instanceof HTMLElement) || activeItems.has(item)) continue;
    disposeAgenticCountItem(item);
    item.remove();
  }
}

function refreshAgenticThinkingSummaries(): void {
  for (const root of els.thread.querySelectorAll<HTMLElement>(".agentic-thinking-card")) {
    renderAgenticThinkingSummary(root);
  }
}

function transitionAgenticMetric(
  root: HTMLElement,
  metric: AgenticMetric,
  previous: AgenticItemState | null,
  next: AgenticItemState | null,
): void {
  storeAgenticMetricProgress(
    root,
    metric,
    transitionAgenticMetricProgress(agenticMetricProgress(root, metric), previous, next),
  );
  renderAgenticThinkingSummary(root);
}

function createAgenticBlock(before?: HTMLElement | null, live = false): AgenticBlock {
  // Insert in the final position immediately. Appending and then moving the
  // wrapper produced two mutations and visible scroll oscillation.
  const wrapper = addMsg("assistant", before);
  wrapper.classList.add("agentic-thinking-wrapper");

  const root = document.createElement("div");
  root.className = "agentic-thinking-card";
  root.dataset.animateCounts = String(live);
  storeAgenticCounts(root, emptyAgenticCounts());

  const head = document.createElement("div");
  head.className = "agentic-thinking-head";
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  const spinner = live ? document.createElement("span") : null;
  if (spinner) spinner.className = "spinner agentic-thinking-spinner";
  const label = document.createElement("span");
  label.className = "agentic-thinking-label";
  const counts = document.createElement("span");
  counts.className = "agentic-thinking-counts";
  const timer = document.createElement("span");
  timer.className = "agentic-thinking-timer";
  timer.hidden = !live;
  if (spinner) head.appendChild(spinner);
  head.append(label, counts, timer);

  const body = document.createElement("div");
  body.className = "agentic-thinking-body";
  const toggle = (): void => {
    setThinkingBodyExpanded(body, body.hidden);
    updateThinkingBlocksButton();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });

  root.append(head, body);
  wrapper.appendChild(root);
  setThinkingBodyExpanded(body, thinkingBlocksExpandedByDefault());
  renderAgenticThinkingSummary(root);
  updateThinkingBlocksButton();
  const block: AgenticBlock = {
    wrapper,
    root,
    body,
    spinner,
    timer,
    startedAt: live ? agenticRunStartedAt || performance.now() : null,
    clock: null,
  };
  if (live && block.startedAt !== null) {
    timer.textContent = fmtToolTime(performance.now() - block.startedAt);
    block.clock = setInterval(() => {
      if (block.startedAt !== null) {
        timer.textContent = fmtToolTime(performance.now() - block.startedAt);
      }
    }, 200);
    runningAgenticBlocks.add(block);
  }
  return block;
}

function finishAgenticBlock(block: AgenticBlock, durationMs?: number): void {
  if (block.clock) clearInterval(block.clock);
  block.clock = null;
  block.spinner?.remove();
  block.spinner = null;
  const elapsed =
    durationMs ?? (block.startedAt === null ? null : performance.now() - block.startedAt);
  if (elapsed !== null && elapsed >= 0) {
    block.timer.hidden = false;
    block.timer.textContent = fmtToolTime(elapsed);
  }
  block.startedAt = null;
  runningAgenticBlocks.delete(block);
}

function finishRunningAgenticBlocks(): void {
  for (const block of runningAgenticBlocks) finishAgenticBlock(block);
}

function breakAgenticChain(): void {
  removeEmptyActiveAgenticBlock();
  finishRunningAgenticBlocks();
  activeAgenticBlock = null;
  agenticRunStartedAt = 0;
}

function ensureLiveAgenticBlock(): AgenticBlock | null {
  if (!agenticThinking) return null;
  prepareAssistantStream();
  if (activeAgenticBlock?.root.isConnected) return activeAgenticBlock;
  // Agentic internal activity does not need an assistant text wrapper. When a
  // real text shell already exists but is still empty, insert before it.
  const before = currentMsg && markdownAccum.length === 0 ? currentMsg : undefined;
  if (!agenticRunStartedAt) agenticRunStartedAt = performance.now();
  activeAgenticBlock = createAgenticBlock(before, true);
  return activeAgenticBlock;
}

function storedAgenticItemState(card: HTMLElement): AgenticItemState | null {
  const value = card.dataset.agenticState;
  return value === "running" ||
    value === "success" ||
    value === "error" ||
    value === "interrupted"
    ? value
    : null;
}

function setAgenticItemState(card: HTMLElement, next: AgenticItemState): void {
  const root = card.closest<HTMLElement>(".agentic-thinking-card");
  const metric = card.dataset.agenticMetric as AgenticMetric | undefined;
  const previous = storedAgenticItemState(card);
  if (!root || !metric || previous === next) return;
  transitionAgenticMetric(root, metric, previous, next);
  card.dataset.agenticState = next;
}

function unregisterAgenticItem(card: HTMLElement): void {
  const root = card.closest<HTMLElement>(".agentic-thinking-card");
  const metric = card.dataset.agenticMetric as AgenticMetric | undefined;
  const previous = storedAgenticItemState(card);
  if (root && metric && previous) {
    transitionAgenticMetric(root, metric, previous, null);
  }
  delete card.dataset.agenticMetric;
  delete card.dataset.agenticState;
}

function registerAgenticThought(
  card: HTMLElement,
  state: AgenticItemState = "running",
): void {
  const root = card.closest<HTMLElement>(".agentic-thinking-card");
  if (!root) return;
  delete root.dataset.waitingOnly;
  if (card.dataset.agenticThought === "true") {
    setAgenticItemState(card, state);
    return;
  }
  card.dataset.agenticThought = "true";
  card.dataset.agenticMetric = "thought";
  card.dataset.agenticState = state;
  transitionAgenticMetric(root, "thought", null, state);
}

function registerAgenticTool(card: HTMLElement, name: string): void {
  const root = card.closest<HTMLElement>(".agentic-thinking-card");
  if (!root || !name) return;
  delete root.dataset.waitingOnly;
  const metric = agenticToolMetric(name);
  const previousMetric = card.dataset.agenticMetric as AgenticMetric | undefined;
  const previousState = storedAgenticItemState(card);
  const toolStatus = card.dataset.toolStatus;
  const state: AgenticItemState =
    toolStatus === "success" || toolStatus === "error" ? toolStatus : "running";
  if (previousMetric === metric) {
    setAgenticItemState(card, state);
    return;
  }
  if (previousMetric && previousState) {
    transitionAgenticMetric(root, previousMetric, previousState, null);
  }
  card.dataset.agenticMetric = metric;
  card.dataset.agenticState = state;
  transitionAgenticMetric(root, metric, null, state);
}

function removeEmptyActiveAgenticBlock(): void {
  const block = activeAgenticBlock;
  const hasContent = Array.from(block?.body.children ?? []).some(
    (child) => !child.classList.contains("collapse-footer"),
  );
  if (!block || hasContent) return;
  const counts = agenticCounts(block.root);
  if (AGENTIC_METRICS.some((metric) => counts[metric] > 0)) return;
  finishAgenticBlock(block);
  block.wrapper.remove();
  activeAgenticBlock = null;
  updateThinkingBlocksButton();
}

function prepareAssistantStream(): void {
  // A repeated message_start for a provider retry belongs to the same visual
  // stream and must not reset cards already rendered from its first attempt.
  if (currentMsg || assistantStreamPrepared) return;
  assistantStreamPrepared = true;
  markdownAccum = "";
  renderPending = false;
  thinkingEl = null;
  thinkingContentEl = null;
  thinkingSpinnerEl = null;
  thinkingTimerEl = null;
  if (thinkingTimer !== null) {
    cancelAnimationFrame(thinkingTimer);
    thinkingTimer = null;
  }
  if (thinkingRenderFrame !== null) {
    cancelAnimationFrame(thinkingRenderFrame);
    thinkingRenderFrame = null;
  }
  thinkingStartedAt = 0;
  thinkingAccum = "";
  thinkingRenderedLength = 0;
  thinkingContentRendered = false;
  toolsEl = null;
  toolsPre = null;
  toolsText = "";
}

function openAssistantBubble(): void {
  if (currentMsg) return;
  prepareAssistantStream();
  currentMsg = addMsg("assistant");
  // The thinking slot precedes visible streamed text in non-agentic mode.
  thinkingSlot = document.createElement("div");
  thinkingSlot.className = "thinking-slot";
  currentMsg.appendChild(thinkingSlot);
  currentText = document.createElement("div");
  currentText.className = "md";
  currentMsg.appendChild(currentText);
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
    head.append(spinner, label, timer);
    return { head, label, spinner, timer };
  }
  head.append(label, timer);
  return { head, label, timer };
}

// pi's setting is authoritative for a chat's initial state. The header action
// can override it for the currently displayed chat only.
let hideThinkingBlock = false;
let thinkingExpansionOverride: boolean | null = null;
let thinkingChatKey: string | null = null;

function thinkingBlocksExpandedByDefault(): boolean {
  return thinkingExpansionOverride ?? !hideThinkingBlock;
}

function thinkingBodies(): HTMLElement[] {
  return Array.from(
    els.thread.querySelectorAll<HTMLElement>(
      ".thinking-card.thought-card:not(.agentic-thinking-member) > .thinking-content, .agentic-thinking-body",
    ),
  );
}

function setThinkingBodyExpanded(body: HTMLElement, expanded: boolean): void {
  body.hidden = !expanded;
  // The block became visible: this is the first moment its markdown is needed.
  if (expanded) renderThinkingBody(body);
  const collapsible = body.parentElement;
  const footerBinding = collapsible ? collapseFooterBindings.get(collapsible) : undefined;
  if (footerBinding) {
    if (!expanded) footerBinding.footer.hidden = true;
    scheduleCollapseFooterUpdate(footerBinding);
  }
  const head = body.previousElementSibling;
  if (
    head?.classList.contains("thinking-head") ||
    head?.classList.contains("agentic-thinking-head")
  ) {
    head.setAttribute("aria-expanded", String(expanded));
  }
}

function updateThinkingBlocksButton(): void {
  const bodies = thinkingBodies();
  const allExpanded = bodies.length > 0 && bodies.every((body) => !body.hidden);
  const action = allExpanded ? "collapse" : "expand";
  els.thinkingBlocks.disabled = bodies.length === 0;
  els.thinkingBlocks.innerHTML = thinkingBlocksIcon(action);
  els.thinkingBlocks.title = t(
    action === "expand" ? "expandAllThinking" : "collapseAllThinking",
  );
  els.thinkingBlocks.setAttribute("aria-label", els.thinkingBlocks.title);
  els.thinkingBlocks.setAttribute("aria-expanded", String(allExpanded));
}

function activateThinkingCard(
  card: HTMLElement,
  body: HTMLElement,
  insideAgenticBlock = false,
): void {
  card.classList.add("thought-card");
  if (insideAgenticBlock) card.classList.add("agentic-thinking-member");
  setThinkingBodyExpanded(
    body,
    insideAgenticBlock ? true : thinkingBlocksExpandedByDefault(),
  );
}

function wireThinkingHead(head: HTMLElement, body: HTMLElement): void {
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  const toggle = (): void => {
    if (body.closest(".agentic-thinking-card")) return;
    setThinkingBodyExpanded(body, body.hidden);
    updateThinkingBlocksButton();
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}

function syncThinkingChat(): void {
  const key = currentSessionPath ?? `new:${workspacePath ?? ""}`;
  if (thinkingChatKey === key) return;
  thinkingChatKey = key;
  thinkingExpansionOverride = null;
}

function updateThinkingTimer(now = performance.now()): void {
  if (!thinkingTimerEl || thinkingStartedAt <= 0) return;
  const secs = Math.max(0, Math.floor((now - thinkingStartedAt) / 1000));
  const value = `${secs}s`;
  if (thinkingTimerEl.textContent !== value) thinkingTimerEl.textContent = value;
}

function startThinkingTimer(startedAt = performance.now()): void {
  if (thinkingTimer !== null) cancelAnimationFrame(thinkingTimer);
  thinkingStartedAt = startedAt;
  updateThinkingTimer();
  const tick = (now: number): void => {
    updateThinkingTimer(now);
    thinkingTimer = requestAnimationFrame(tick);
  };
  thinkingTimer = requestAnimationFrame(tick);
}

function stopThinkingTimer(): void {
  if (thinkingTimer !== null) {
    cancelAnimationFrame(thinkingTimer);
    thinkingTimer = null;
  }
  if (thinkingTimerEl && thinkingStartedAt > 0) {
    const secs = Math.max(1, Math.floor((performance.now() - thinkingStartedAt) / 1000));
    thinkingTimerEl.textContent = `${secs}s`;
  }
}

/** Registers the raw text behind a thinking body (markdown is rendered on
 *  demand from it, so a collapsed block keeps the source without formatting). */
function bindThinkingBody(body: HTMLElement, source: () => string): void {
  thinkingBodySources.set(body, source);
}

/** Formats one thinking body with markdown. A collapsed body is left
 *  untouched: it is painted when the block is expanded. Returns true when the
 *  rendered HTML changed. */
function renderThinkingBody(body: HTMLElement): boolean {
  const source = thinkingBodySources.get(body);
  if (!source) return false;
  const text = source().trim();
  if (
    thinkingPaintDecision(body.hidden, text, thinkingBodyPainted.get(body)) !== "paint"
  ) {
    return false; // collapsed until expanded, or already up to date
  }
  body.innerHTML = renderMarkdown(text);
  enhanceCodeBlocks(body);
  thinkingBodyPainted.set(body, text);
  return true;
}

function renderThinkingContent(): void {
  thinkingRenderFrame = null;
  if (!thinkingContentEl || thinkingRenderedLength >= thinkingAccum.length) return;
  if (!renderThinkingBody(thinkingContentEl)) return; // collapsed: painted on expand
  thinkingRenderedLength = thinkingAccum.length;
  scrollToBottom();
}

function scheduleThinkingContentRender(): void {
  if (thinkingRenderFrame !== null) return;
  thinkingRenderFrame = requestAnimationFrame(renderThinkingContent);
}

function flushThinkingContentRender(): void {
  if (thinkingRenderFrame !== null) {
    cancelAnimationFrame(thinkingRenderFrame);
    thinkingRenderFrame = null;
  }
  renderThinkingContent();
}

function ensureThinkingLoader(): HTMLElement {
  const agenticBlock = ensureLiveAgenticBlock();
  const destination = agenticBlock?.body ?? thinkingSlot;
  if (!thinkingEl && destination) {
    thinkingContentRendered = false;
    thinkingEl = document.createElement("div");
    thinkingEl.className = "thinking-card";
    const { head, spinner, timer } = makeThinkingHead();
    thinkingSpinnerEl = spinner ?? null;
    thinkingTimerEl = timer ?? null;
    thinkingContentEl = document.createElement("div");
    thinkingContentEl.className = "thinking-content";
    thinkingRenderedLength = 0;
    bindThinkingBody(thinkingContentEl, () => thinkingAccum);
    activateThinkingCard(thinkingEl, thinkingContentEl, !!agenticBlock);
    if (!agenticBlock) wireThinkingHead(head, thinkingContentEl);
    thinkingEl.append(head, thinkingContentEl);
    destination.appendChild(thinkingEl);
    registerAgenticThought(thinkingEl);
    updateThinkingBlocksButton();
    if (!agenticBlock) {
      applyToolChain(); // first thinking block: evaluate the 3px gap with the previous one
    }
    startThinkingTimer();
    scrollToBottom();
  }
  return thinkingEl as HTMLElement;
}

// at thinking end: spinner removed, the content stays expandable
function finishThinking(): void {
  if (!thinkingEl) return;
  flushThinkingContentRender();
  stopThinkingTimer();
  thinkingSpinnerEl?.remove();
  thinkingSpinnerEl = null;
  const content = thinkingAccum.trim();
  if (content) {
    // the final text is markdown too; a collapsed block is painted on expand
    if (thinkingContentEl) renderThinkingBody(thinkingContentEl);
    setAgenticItemState(thinkingEl, "success");
    thinkingContentRendered = true;
  } else {
    unregisterAgenticItem(thinkingEl);
    thinkingEl.remove();
    thinkingEl = null;
    thinkingContentEl = null;
    updateThinkingBlocksButton();
  }
}

// run end (STOP, provider abort, pi exit): a thought that is still streaming
// never receives its end event, so it would keep its spinner, timer and
// running counter forever — a yellow animated count in a finished block. The
// partial text stays visible, marked as interrupted instead.
function interruptThinking(): void {
  if (!thinkingEl || thinkingContentRendered) return;
  flushThinkingContentRender();
  stopThinkingTimer();
  thinkingSpinnerEl?.remove();
  thinkingSpinnerEl = null;
  const content = thinkingAccum.trim();
  if (content) {
    if (thinkingContentEl) renderThinkingBody(thinkingContentEl);
    setAgenticItemState(thinkingEl, "interrupted");
    thinkingContentRendered = true;
    return;
  }
  unregisterAgenticItem(thinkingEl);
  thinkingEl.remove();
  thinkingEl = null;
  thinkingContentEl = null;
  updateThinkingBlocksButton();
}

// --- "Waiting for response" indicator (provider inactivity watchdog) -------
// `turn_start` arms the initial wait before every provider request. Every text
// delta resets the same 1s timeout: this also exposes a long silent interval
// inside one response, for example while the provider prepares a tool call
// after already streaming prose. Thinking and tool cards have their own live
// spinner/timer, so they need no additional waiting indicator.
// Before any content, waiting lives in the thinking slot and can be promoted
// in place. After visible text, it lives at the message tail and disappears as
// soon as another text/tool/end event arrives.

let waitingCardEl: HTMLElement | null = null;
let waitingTimerEl: HTMLElement | null = null;
let waitingLabelEl: HTMLElement | null = null;
let waitingSpinnerEl: HTMLElement | null = null;
let waitingContentEl: HTMLElement | null = null;
let waitingStartedAt = 0;
let waitingClock: number | null = null;
let waitingTimeout: ReturnType<typeof setTimeout> | null = null;
let initialAgentWaitStartedAt = 0;

function armWaitingResponse(reset = true, startedAt = performance.now()): void {
  // agent_start begins the user-visible wait. The first turn_start must not
  // restart that clock: otherwise provider setup latency is added to the
  // configured delay and Waiting can be replaced before the browser paints it.
  if (!reset && (waitingTimeout || waitingCardEl)) return;
  if (waitingTimeout) {
    clearTimeout(waitingTimeout);
    waitingTimeout = null;
  }
  waitingStartedAt = startedAt;
  waitingTimeout = setTimeout(
    () => {
      waitingTimeout = null;
      // an agent run must be active: without it (rejected prompt, extension
      // command without a turn) there is no model request — nothing to wait for
      if (working) showWaitingBlock();
    },
    waitingResponseDelayRemaining(startedAt, performance.now()),
  );
}

function showWaitingBlock(): void {
  if (waitingCardEl) return;
  // In agentic mode waiting is part of the current consecutive chain from the
  // beginning. Do not create an empty assistant text wrapper just to host it.
  if (!agenticThinking && (!currentMsg || !thinkingSlot)) openAssistantBubble();
  const agenticBlock = agenticThinking ? ensureLiveAgenticBlock() : null;
  const destination = agenticBlock?.body ?? thinkingSlot;
  if (!destination) return;
  if (agenticBlock) {
    const counts = agenticCounts(agenticBlock.root);
    if (AGENTIC_METRICS.every((metric) => counts[metric] === 0)) {
      agenticBlock.root.dataset.waitingOnly = "true";
      renderAgenticThinkingSummary(agenticBlock.root);
    }
  }
  const card = document.createElement("div");
  card.className = "thinking-card waiting-card";
  waitingCardEl = card;
  const head = document.createElement("div");
  head.className = "thinking-head";
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = t("waitingResponse");
  waitingLabelEl = label;
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  waitingSpinnerEl = spinner;
  waitingTimerEl = document.createElement("span");
  waitingTimerEl.className = "thinking-timer";
  // the wait is already 1s when it appears: the seconds start from there
  waitingTimerEl.textContent = `${Math.floor(WAITING_RESPONSE_DELAY_MS / 1000)}s`;
  head.append(spinner, label, waitingTimerEl);
  card.appendChild(head);
  const content = document.createElement("div");
  content.className = "thinking-content";
  content.hidden = true;
  waitingContentEl = content;
  if (!agenticBlock) wireThinkingHead(head, content);
  card.appendChild(content);
  destination.appendChild(card);
  if (!agenticBlock) applyToolChain();
  const tick = (now: number): void => {
    if (!waitingTimerEl) {
      waitingClock = null;
      return;
    }
    const secs = Math.floor((now - waitingStartedAt) / 1000);
    waitingTimerEl.textContent = `${secs}s`;
    waitingClock = requestAnimationFrame(tick);
  };
  waitingClock = requestAnimationFrame(tick);
  scrollToBottom();
}

// The model answered with a thought while waiting is visible: promote the
// existing card in place. Only its label/state changes and its timer continues;
// position and gaps remain exactly the same.
function promoteWaitingToThinking(): void {
  const card = waitingCardEl;
  if (!card) return;
  // Stop the waiting clock: the thinking clock takes over from the same start.
  if (waitingClock !== null) {
    cancelAnimationFrame(waitingClock);
    waitingClock = null;
  }
  if (waitingTimeout) {
    clearTimeout(waitingTimeout);
    waitingTimeout = null;
  }
  if (waitingLabelEl) waitingLabelEl.textContent = t("thought");
  card.classList.remove("waiting-card");
  thinkingEl = card;
  thinkingSpinnerEl = waitingSpinnerEl;
  thinkingTimerEl = waitingTimerEl;
  thinkingContentEl = waitingContentEl;
  thinkingRenderedLength = 0;
  if (thinkingContentEl) bindThinkingBody(thinkingContentEl, () => thinkingAccum);
  const agenticBlock = agenticThinking ? ensureLiveAgenticBlock() : null;
  if (agenticBlock && card.parentElement !== agenticBlock.body) {
    agenticBlock.body.appendChild(card);
  }
  const insideAgenticBlock = card.closest(".agentic-thinking-card") !== null;
  if (thinkingContentEl) {
    activateThinkingCard(card, thinkingContentEl, insideAgenticBlock);
    if (insideAgenticBlock) {
      const oldHead = thinkingContentEl.previousElementSibling as HTMLElement | null;
      oldHead?.removeAttribute("role");
      oldHead?.removeAttribute("tabindex");
      registerAgenticThought(card);
    }
  }
  startThinkingTimer(waitingStartedAt);
  waitingCardEl = null;
  waitingTimerEl = null;
  waitingSpinnerEl = null;
  waitingLabelEl = null;
  waitingContentEl = null;
  updateThinkingBlocksButton();
  scrollToBottom();
}

function disarmWaitingResponse(preserveEmptyAgentic = false): void {
  if (waitingTimeout) {
    clearTimeout(waitingTimeout);
    waitingTimeout = null;
  }
  if (waitingClock !== null) {
    cancelAnimationFrame(waitingClock);
    waitingClock = null;
  }
  if (waitingCardEl) {
    waitingCardEl.remove();
    waitingCardEl = null;
  }
  waitingTimerEl = null;
  waitingSpinnerEl = null;
  waitingLabelEl = null;
  waitingContentEl = null;
  if (!preserveEmptyAgentic) removeEmptyActiveAgenticBlock();
}

/** Close current thought/tool grouping at an externally visible boundary. */
function breakInternalActivityChain(): void {
  if (thinkingEl && !thinkingContentRendered) finishThinking();
  disarmWaitingResponse();
  breakAgenticChain();
  // A following thought must create a fresh card instead of reusing the one
  // completed before compaction or an injected user steering message.
  thinkingEl = null;
  thinkingContentEl = null;
  thinkingSpinnerEl = null;
  thinkingTimerEl = null;
  thinkingStartedAt = 0;
  thinkingAccum = "";
  thinkingRenderedLength = 0;
  thinkingContentRendered = true;
}

// --- footer slots filled by the pi EXTENSIONS (ctx.ui.setStatus) -----------
// pi-webview is a passive renderer: every extension calls setStatus(key, text)
// (already forwarded as extension_ui_request in RPC mode) and the webview
// shows one slot per key; setStatus(key, undefined) clears the slot.
// E.g. pi-tokens-per-second → ⚡ 43 tokens in 0.7s (59.1 t/s).

const statusSlots = new Map<string, string>();

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
      // the command answered (dialog): a dialog is visible activity
      disarmWaitingResponse();
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
      disarmWaitingResponse();
      const msg = (evt.message as string | undefined) ?? (evt.title as string) ?? "";
      void inlineConfirm(msg).then((ok) => respond({ confirmed: ok }));
      return;
    }
    case "input": {
      disarmWaitingResponse();
      const title = (evt.title as string | undefined) ?? "";
      const prefill = (evt.prefill as string | undefined) ?? "";
      void inlinePrompt(prefill, title).then((v) =>
        respond(v === null ? { cancelled: true } : { value: v }),
      );
      return;
    }
    case "editor": {
      // prefilled text (e.g. edit): same input block
      disarmWaitingResponse();
      const title = (evt.title as string | undefined) ?? "";
      const prefill = (evt.prefill as string | undefined) ?? "";
      void inlinePrompt(prefill, title).then((v) =>
        respond(v === null ? { cancelled: true } : { value: v }),
      );
      return;
    }
    case "notify": {
      // extension command response (commands do not emit agent_start/delta):
      // the notification in chat is the feedback — nothing is being awaited
      disarmWaitingResponse();
      const msg = (evt.message as string | undefined) ?? (evt.title as string) ?? "";
      const notifyType = evt.notifyType as string | undefined;
      if (msg && isReleaseReminderMessage(msg)) addReleaseReminderCard(msg);
      else if (msg && notifyType === "warning") addSystemBox("warn", msg);
      else if (msg && notifyType === "error") addSystemBox("error", msg);
      else if (msg) addStatusLine(msg);
      if (msg && !allowRemoteNpmUpdates && isRemoteNpmDependencyDisabledUpdate(msg)) {
        addSystemBox("warn", t("updateAllowRemoteNpmSuggestion"));
      }
      if (
        msg &&
        !dangerouslyAllowAllNpmScripts &&
        isBlockedNpmInstallScriptsUpdate(msg)
      ) {
        addSystemBox("warn", t("updateAllowNpmInstallScriptsSuggestion"));
      }
      const executionOutcome = updateExecutionOutcome(msg);
      if (executionOutcome === "success") {
        addSystemBox("warn", t("updateRestartRequiredWarning"));
      }
      if (updateRunPending && executionOutcome) {
        finishUpdateRun(executionOutcome);
      }
      // a manual shield check just finished (outcome box in the chat) →
      // re-enable the shield right away, even on a host that cannot report
      // the startup-info timestamp the poll is watching for
      if (updateChecking && isUpdateCheckOutcome(String(msg))) {
        void finishManualUpdateCheckFromOutcome();
      }
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
  const titleEl = document.createElement("div");
  titleEl.className = "inline-dialog-title";
  titleEl.innerHTML = renderMarkdown(title || "…");
  enhanceCodeBlocks(titleEl);
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
    const cards = Array.from(wrapper.parentElement?.querySelectorAll(".tool-card") ?? []);
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
        args.textContent = wasAnswered ? `${args.textContent} · ${text}` : ` ${text}`;
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
    if (hiddenStatusKeys.includes(key)) continue;
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "stats-slot";
    // terminal ANSI → colors mapped on the theme (textContent no: HTML is needed)
    slot.innerHTML = renderAnsiToHtml(text);
    slot.title = `${stripAnsi(text)} · ${tpl(t("hideStatusSource"), { source: key })}`;
    slot.addEventListener("click", () => {
      void showConfirm(tpl(t("hideStatusConfirm"), { source: key }), text).then((ok) => {
        if (!ok) return;
        hiddenStatusKeys = setStatusKeyHidden(hiddenStatusKeys, key, true);
        renderStatusSlots();
        renderHiddenStatusSettings();
        persistWebviewConfig({ hiddenStatusKeys });
      });
    });
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
      contextStats.percent != null ? `${Math.round(contextStats.percent)}%` : "…",
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
  for (const [key, text] of statusSlots) {
    if (!hiddenStatusKeys.includes(key)) parts.push(stripAnsi(text));
  }
  els.statsBadge.title = parts.join(" · ");
}

// --- responsive status bar --------------------------------------------------
// Compact mode uses standard CSS ellipsis; expanded mode wraps status sources
// across lines. Placement and compactness are independent preferences.

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
    contextStats?.percent != null ? Math.min(100, Math.max(0, contextStats.percent)) : 0;
  els.ctxFill.style.strokeDashoffset = String(GAUGE_CIRCUMFERENCE * (1 - pct / 100));
  els.ctxLabel.textContent = contextStats
    ? contextStats.tokens != null
      ? `${fmtK(contextStats.tokens)}/${fmtK(contextStats.contextWindow)}`
      : `…/${fmtK(contextStats.contextWindow)}`
    : "–";
  updateStatsTitle();
}

// API base URL of the current model, from pi's own catalog (get_available_models
// returns the complete model definitions, baseUrl included). The balance
// endpoint is derived from it, so nothing is keyed on a provider name: any
// provider pointing at a supported API works, custom ids included. Cached per
// provider/id; the empty string marks a model without baseUrl so the RPC is not
// repeated for it.
const modelBaseUrls = new Map<string, string>();

function modelKey(provider: string, id: string): string {
  return `${provider}\u0000${id}`;
}

async function modelBaseUrl(): Promise<string | undefined> {
  const provider = currentModel?.provider;
  const id = currentModel?.id;
  if (!provider || !id) return undefined;
  const key = modelKey(provider, id);
  if (!modelBaseUrls.has(key)) {
    const res = await rpcRequest(rpc.getAvailableModels()).catch(() => null);
    const models =
      (res?.success
        ? (
            res.data as
              | {
                  models?: Array<{ provider?: string; id?: string; baseUrl?: string }>;
                }
              | undefined
          )?.models
        : undefined) ?? [];
    for (const m of models) {
      if (m.provider && m.id)
        modelBaseUrls.set(modelKey(m.provider, m.id), m.baseUrl ?? "");
    }
  }
  return modelBaseUrls.get(key) || undefined;
}

// real provider balance: via companion/bridge, which reads the key from
// auth.json and calls the balance endpoint of the provider's API
async function fetchBalance(): Promise<void> {
  if (!currentModel?.provider) return;
  const res = await ideRequest({
    type: "getBalance",
    provider: currentModel.provider,
    baseUrl: await modelBaseUrl(),
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

function ensureToolCard(name?: string, outsideAgentic = false): HTMLElement {
  if (!toolsEl && (currentMsg || agenticThinking)) {
    // real name if already known (toolcall_start), otherwise a neutral placeholder
    toolsEl = buildToolCard({ id: "", name: name || t("tool"), args: "" }, false);
    toolsPre = toolsEl.querySelector<HTMLPreElement>("pre");
    if (outsideAgentic) {
      const wrapper = addMsg("assistant");
      wrapper.appendChild(toolsEl);
      toolsEl.dataset.outsideAgentic = "true";
    } else {
      const agenticBlock = ensureLiveAgenticBlock();
      const destination = agenticBlock?.body ?? currentMsg;
      destination?.appendChild(toolsEl);
      if (name) registerAgenticTool(toolsEl, name);
      if (!agenticBlock) {
        applyToolChainIfToolFirst(); // first tool block: evaluate the 3px gap
      }
    }
  }
  return toolsEl as HTMLElement;
}

function moveAskUserOutsideAgentic(card: HTMLElement): void {
  if (card.dataset.outsideAgentic === "true") return;
  const root = card.closest<HTMLElement>(".agentic-thinking-card");
  const oldWrapper = root?.closest<HTMLElement>(".agentic-thinking-wrapper");
  unregisterAgenticItem(card);
  breakAgenticChain();
  const wrapper = addMsg("assistant");
  wrapper.appendChild(card);
  card.dataset.outsideAgentic = "true";
  if (
    root &&
    !root.querySelector(".agentic-thinking-body")?.hasChildNodes() &&
    !AGENTIC_METRICS.some((key) => agenticCounts(root)[key] > 0)
  ) {
    oldWrapper?.remove();
    updateThinkingBlocksButton();
  }
}

// --- copy (single component, same style everywhere) ---------------------------

type CopyTextSource = string | (() => string);

function makeCopyButton(text: CopyTextSource): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "copy-btn";
  btn.innerHTML = copyIcon();
  btn.title = t("copy");
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
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

function addCopyButton(container: HTMLElement, text: CopyTextSource): HTMLButtonElement {
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

function renderToolOpenButton(el: HTMLElement, filePath?: string): void {
  const row = el.parentElement;
  row?.querySelector(".tool-open-file")?.remove();
  if (!row || !filePath) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-open-file";
  button.dataset.filePath = filePath;
  button.innerHTML = openFileIcon();
  button.title = t("openFile");
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = await ideRequest({ type: "openFile", path: filePath });
    if (!result?.ok) {
      addSystemBox("error", tpl(t("openFileFailed"), { error: result?.error ?? "?" }));
    }
  });
  // Keep the action next to the tool name, before the file path. Inserting
  // after the name also places it before an existing .tool-args sibling.
  el.after(button);
}

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
  renderToolOpenButton(el, summary.filePath);
}

// track the last assistant text of the current turn: used to synthesize the
// turn-complete desktop notification at agent_settled (pi does not emit one)
let lastAssistantText = "";

function finalizeMessage(msg: FinalizedMessage): void {
  const hasVisibleText = msg.text.trim().length > 0;
  if (hasVisibleText || msg.images.length > 0) {
    trailingToolOutputs.assistantVisible(msg.text, msg.images.length > 0);
  } else if (msg.toolCalls.length > 0) trailingToolOutputs.assistantToolCall();
  const hasFinalContent =
    hasVisibleText ||
    msg.thinking.trim().length > 0 ||
    msg.toolCalls.length > 0 ||
    msg.images.length > 0;
  if (!assistantStreamPrepared) prepareAssistantStream();
  if (
    !currentMsg &&
    ((agenticThinking && hasVisibleText) || (!agenticThinking && hasFinalContent))
  ) {
    openAssistantBubble();
  }
  if (currentText || agenticThinking) {
    // thinking before the text: the slot is already before .md in the DOM
    const hadStreamedText = markdownAccum.length > 0;
    if (thinkingEl && !thinkingContentRendered) finishThinking();
    if (msg.thinking.trim() && !thinkingContentRendered) {
      const card = document.createElement("div");
      card.className = "thinking-card";
      const { head } = makeThinkingHead(false);
      const body = document.createElement("div");
      body.className = "thinking-content";
      bindThinkingBody(body, () => msg.thinking);
      const agenticBlock = ensureLiveAgenticBlock();
      activateThinkingCard(card, body, !!agenticBlock);
      if (!agenticBlock) wireThinkingHead(head, body);
      card.append(head, body);
      (agenticBlock?.body ?? thinkingSlot)?.appendChild(card);
      registerAgenticThought(card, "success");
      updateThinkingBlocksButton();
      thinkingContentRendered = true;
    }
    if (thinkingSlot && !thinkingSlot.hasChildNodes()) thinkingSlot.remove();
    // Some providers only expose the authoritative text at message_end. It is
    // still a visible-content boundary before any following tool calls.
    if (msg.text.trim() && !hadStreamedText) breakAgenticChain();
    markdownAccum = msg.text;
    if (currentText) {
      currentText.innerHTML = renderMarkdown(msg.text);
      enhanceCodeBlocks(currentText);
    }
    // tool call: reuse the streaming card for the first one (avoids duplicates)
    const toolCalls = msg.toolCalls;
    if (toolCalls.length > 0) {
      const first = toolCalls[0];
      if (first) {
        if (toolsEl) {
          toolsEl.dataset.toolName = first.name;
          if (first.name === "ask_user") moveAskUserOutsideAgentic(toolsEl);
          renderToolHeader(
            toolsEl.querySelector(".tool-name")!,
            toolSummary(first.name, first.args, workspacePath ?? undefined),
          );
          const lbl = toolsEl.querySelector(".code-label");
          if (lbl) lbl.textContent = first.name;
          if (first.name === "read") {
            renderReadToolArguments(toolsEl, first.args, true);
            toolsPre = null;
          } else if (first.name === "write") {
            renderWriteToolArguments(toolsEl, first.args, true);
          } else if (first.name === "edit") {
            renderEditToolArguments(toolsEl, first.args);
            toolsPre = null;
          } else if (isShellTool(first.name)) {
            renderShellToolArguments(toolsEl, first.args);
            toolsPre = null;
          } else if (toolsPre) {
            toolsPre.textContent = first.args;
          }
          const header = toolsEl.querySelector<HTMLElement>(".code-header");
          if (header && !header.querySelector(".copy-btn"))
            addCopyButton(header, first.args);
          if (first.id) toolCardsById.set(first.id, toolsEl as HTMLElement);
          if (first.name !== "ask_user") registerAgenticTool(toolsEl, first.name);
        } else {
          createToolCard(first);
        }
      }
      for (const tc of toolCalls.slice(1)) createToolCard(tc);
    }
  }
  if (msg.images.length > 0) {
    breakAgenticChain();
    if (!currentMsg) openAssistantBubble();
    if (currentMsg) appendChatImages(currentMsg, msg.images);
  }
  // assistant wrapper without content (e.g. empty stream): remove it,
  // otherwise it creates ghost gaps between the tool blocks in the history
  if (currentMsg) {
    const hasContent =
      !!currentMsg.querySelector(".thinking-card") ||
      !!currentMsg.querySelector(".tool-card") ||
      !!currentMsg.querySelector(".chat-image-grid") ||
      (currentText ? currentText.textContent.trim().length > 0 : false);
    if (!hasContent) currentMsg.remove();
  }
  // remember the answer for the turn-complete notification
  if (msg.text.trim()) lastAssistantText = msg.text.trim();
  // A provider failure can interrupt a tool call while its arguments are
  // still streaming, before pi emits tool_execution_start/end. Finalize those
  // orphaned cards before the error becomes a visible boundary so neither the
  // tool timer nor its aggregate counter keeps running behind the next block.
  if (msg.errorMessage) {
    interruptStreamingTools();
    breakAgenticChain();
    addSystemBox("error", msg.errorMessage);
  }
  currentMsg = null;
  currentText = null;
  thinkingSlot = null;
  assistantStreamPrepared = false;
}

function createToolCard(tc: ToolCallInfo): void {
  const card = buildToolCard(tc);
  if (tc.name === "ask_user") {
    breakAgenticChain();
    const wrapper = addMsg("assistant");
    wrapper.appendChild(card);
    card.dataset.outsideAgentic = "true";
  } else {
    const agenticBlock = ensureLiveAgenticBlock();
    (agenticBlock?.body ?? currentMsg)?.appendChild(card);
    registerAgenticTool(card, tc.name);
  }
  if (tc.id) toolCardsById.set(tc.id, card);
}

type ToolExecutionStatus = "running" | "success" | "error";

function setToolExecutionStatus(
  card: HTMLElement,
  status: ToolExecutionStatus,
  agenticState: AgenticItemState = status,
): void {
  const name = card.querySelector(".tool-name");
  if (!name) return;
  const sameStatus = card.dataset.toolStatus === status;
  let indicator = card.querySelector<HTMLElement>(".tool-status");
  if (!indicator) {
    indicator = document.createElement("span");
    indicator.className = "tool-status";
    name.before(indicator);
  }
  card.dataset.toolStatus = status;
  setAgenticItemState(card, agenticState);
  indicator.className = `tool-status tool-status-${status}`;
  const label = t(
    status === "running"
      ? "toolRunning"
      : status === "success"
        ? "toolSucceeded"
        : "toolFailed",
  );
  indicator.title = label;
  indicator.setAttribute("aria-label", label);

  // Tool argument deltas call this repeatedly. Preserve an already-correct
  // visual node so its CSS animation does not restart on every streamed chunk.
  const hasExpectedVisual =
    status === "running"
      ? indicator.querySelector(".spinner") !== null
      : indicator.querySelector("svg") !== null;
  if (sameStatus && hasExpectedVisual) return;

  indicator.replaceChildren();
  if (status === "running") {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    spinner.setAttribute("aria-hidden", "true");
    indicator.appendChild(spinner);
  } else {
    indicator.innerHTML = status === "success" ? checkIcon() : trustIcon("warn-filled");
  }
}

function renderReadToolArguments(
  card: HTMLElement,
  rawArgs: string,
  refreshCopy = false,
): void {
  const body = card.querySelector<HTMLElement>(":scope > .code-block:not(.tool-output)");
  if (!body) return;
  body.classList.add("tool-read-input");
  body.querySelector(":scope > pre")?.remove();
  let list = body.querySelector<HTMLDListElement>(":scope > .tool-read-arguments");
  if (!list) {
    list = document.createElement("dl");
    list.className = "tool-read-arguments";
    body.appendChild(list);
  }
  list.replaceChildren();
  for (const entry of readArgumentEntries(rawArgs)) {
    const key = document.createElement("dt");
    key.textContent = entry.key;
    const value = document.createElement("dd");
    value.textContent = entry.value;
    list.append(key, value);
  }
  if (refreshCopy) {
    const header = body.querySelector<HTMLElement>(":scope > .code-header");
    const oldCopy = header?.querySelector(".copy-btn");
    const copy = makeCopyButton(rawArgs);
    if (oldCopy) oldCopy.replaceWith(copy);
    else header?.appendChild(copy);
  }
}

function renderWriteToolArguments(
  card: HTMLElement,
  rawArgs: string,
  refreshCopy = false,
): void {
  const body = card.querySelector<HTMLElement>(":scope > .code-block:not(.tool-output)");
  const pre = body?.querySelector<HTMLPreElement>(":scope > pre");
  if (!body || !pre) return;
  const content = writeArgumentContent(rawArgs) ?? "";
  // JSON.parse already yields the authoritative content string. Assign it
  // directly: no trimming, escaping or unescaping beyond parsing the envelope.
  pre.textContent = content;
  if (refreshCopy) {
    const header = body.querySelector<HTMLElement>(":scope > .code-header");
    const oldCopy = header?.querySelector(".copy-btn");
    const copy = makeCopyButton(content);
    if (oldCopy) oldCopy.replaceWith(copy);
    else header?.appendChild(copy);
  }
}

function renderEditToolArguments(card: HTMLElement, rawArgs: string): void {
  const body = card.querySelector<HTMLElement>(":scope > .code-block:not(.tool-output)");
  if (!body) return;
  body.classList.add("tool-edit-input");
  body.replaceChildren();
  const path = editArgumentPath(rawArgs);
  if (path !== null) {
    const pathRow = document.createElement("div");
    pathRow.className = "tool-edit-path";
    const pathLabel = document.createElement("span");
    pathLabel.className = "tool-edit-path-label";
    pathLabel.textContent = `${t("editPath")}:`;
    const pathValue = document.createElement("span");
    pathValue.className = "tool-edit-path-value";
    pathValue.textContent = path;
    pathRow.append(pathLabel, pathValue);
    body.appendChild(pathRow);
  }
  const pairs = editArgumentPairs(rawArgs);
  for (const pair of pairs) {
    const operation = document.createElement("div");
    operation.className = "tool-edit-operation";
    for (const [kind, title, content] of [
      ["search", t("editSearch"), pair.search],
      ["replace", t("editReplace"), pair.replace],
    ] as const) {
      const fragment = document.createElement("section");
      fragment.className = `tool-edit-fragment tool-edit-${kind}`;
      const header = document.createElement("div");
      header.className = "code-header";
      const label = document.createElement("span");
      label.className = "code-label";
      label.textContent = title;
      header.appendChild(label);
      addCopyButton(header, content);
      const pre = document.createElement("pre");
      pre.textContent = content;
      fragment.append(header, pre);
      operation.appendChild(fragment);
    }
    body.appendChild(operation);
  }
}

function isShellTool(name: string): boolean {
  return name === "bash" || name === "powershell";
}

function renderShellToolArguments(card: HTMLElement, rawArgs: string): void {
  const body = card.querySelector<HTMLElement>(":scope > .code-block:not(.tool-output)");
  if (!body) return;
  body.classList.add("tool-shell-input");
  body.replaceChildren();
  const view = shellArgumentView(rawArgs);
  const timeoutRow = document.createElement("div");
  timeoutRow.className = "tool-shell-timeout";
  const timeoutLabel = document.createElement("span");
  timeoutLabel.className = "tool-shell-timeout-label";
  timeoutLabel.textContent = `${t("shellTimeout")}:`;
  const timeoutValue = document.createElement("span");
  timeoutValue.textContent = view?.timeout ?? "—";
  timeoutRow.append(timeoutLabel, timeoutValue);

  const command = view?.command ?? "";
  const commandBlock = document.createElement("div");
  commandBlock.className = "tool-shell-command";
  commandBlock.appendChild(makeCopyButton(command));
  const pre = document.createElement("pre");
  // Use the parsed command exactly once and assign it directly as text.
  pre.textContent = command;
  commandBlock.appendChild(pre);
  body.append(timeoutRow, commandBlock);
}

function renderStreamingToolArguments(
  card: HTMLElement,
  rawArgs: string,
): HTMLPreElement | null {
  const body = card.querySelector<HTMLElement>(":scope > .code-block:not(.tool-output)");
  if (!body) return null;
  let pre = body.querySelector<HTMLPreElement>(":scope > pre");
  if (!pre) {
    body.classList.remove("tool-read-input", "tool-edit-input", "tool-shell-input");
    body.replaceChildren();
    const header = document.createElement("div");
    header.className = "code-header";
    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent = card.dataset.toolName || t("tool");
    pre = document.createElement("pre");
    header.appendChild(label);
    addCopyButton(header, () => pre?.textContent ?? "");
    body.append(header, pre);
  }
  pre.textContent = rawArgs;
  return pre;
}

function buildToolCard(tc: ToolCallInfo, formatArguments = true): HTMLElement {
  const d = document.createElement("details");
  d.className = "tool-card";
  d.dataset.toolName = tc.name;
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
  addCopyButton(
    header,
    formatArguments
      ? tc.name === "write"
        ? (writeArgumentContent(tc.args) ?? "")
        : tc.args
      : () => pre.textContent ?? "",
  );
  body.append(header, pre);
  d.append(s, body);
  if (formatArguments) {
    if (tc.name === "read") renderReadToolArguments(d, tc.args);
    else if (tc.name === "write") renderWriteToolArguments(d, tc.args);
    else if (tc.name === "edit") renderEditToolArguments(d, tc.args);
    else if (isShellTool(tc.name)) renderShellToolArguments(d, tc.args);
  }
  return d;
}

function buildThinkingCard(
  content: string,
  durationMs = 0,
  insideAgenticBlock = false,
): HTMLElement {
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
  bindThinkingBody(body, () => content);
  activateThinkingCard(card, body, insideAgenticBlock);
  if (!insideAgenticBlock) wireThinkingHead(head, body);
  card.append(head, body);
  return card;
}

// compact card for a tool result (truncated output)
function buildResultCard(
  toolName: string,
  content: DisplayMessageContent,
  isError = false,
): HTMLElement {
  const d = document.createElement("details");
  d.className = "tool-card";
  d.dataset.toolName = toolName;
  const s = document.createElement("summary");
  const name = document.createElement("span");
  name.className = "tool-name";
  name.textContent = toolName;
  const tag = document.createElement("span");
  tag.className = "tool-args";
  tag.textContent = `· ${t("result")}`;
  s.append(name, tag);
  const body = document.createElement("div");
  body.className = "code-block tool-output";
  const header = document.createElement("div");
  header.className = "code-header tool-output-header";
  const label = document.createElement("span");
  label.className = "code-label";
  label.textContent = isShellTool(toolName) ? t("result") : "output";
  const MAX = 10_000;
  const truncated = content.text.length > MAX;
  const pre = document.createElement("pre");
  pre.textContent = truncated
    ? content.text.slice(0, MAX) + "\n… (troncato)"
    : content.text;
  pre.hidden = content.text.length === 0;
  header.append(label);
  addCopyButton(header, content.text);
  body.append(header, pre);
  appendChatImages(body, content.images, "tool-result-images");
  d.append(s, body);
  setToolExecutionStatus(d, isError ? "error" : "success");
  renderShellResultExitCode(d, content.text, isError);
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

function failRunningTools(): void {
  for (const card of Array.from(
    els.thread.querySelectorAll<HTMLElement>('.tool-card[data-tool-status="running"]'),
  )) {
    stopToolTimer(card);
    setToolExecutionStatus(card, "error");
  }
}

function interruptStreamingTools(): void {
  for (const card of Array.from(
    els.thread.querySelectorAll<HTMLElement>('.tool-card[data-tool-status="running"]'),
  )) {
    stopToolTimer(card);
    setToolExecutionStatus(card, "error", "interrupted");
  }
}
const toolOutputPre = new Map<string, HTMLPreElement>();

interface PendingToolOutput {
  id: string;
  toolName: string;
  content: DisplayMessageContent;
  isError: boolean;
  card: HTMLElement;
}

const trailingToolOutputs = new TrailingToolOutputResolver<PendingToolOutput>();

function markToolOutputPromoted(output: PendingToolOutput): void {
  const registered = askUserInfoByTool.get(output.id)?.cards;
  const cards = registered?.length ? registered : [output.card];
  for (const card of cards) {
    for (const result of Array.from(
      card.querySelectorAll<HTMLElement>(":scope > .tool-output"),
    )) {
      result.remove();
    }
    if (!card.querySelector(":scope > .tool-result-promoted-note")) {
      const note = document.createElement("div");
      note.className = "tool-result-promoted-note";
      note.textContent = t("toolResultShownBelow");
      card.appendChild(note);
    }
  }
  for (const key of Array.from(toolOutputPre.keys())) {
    if (key === output.id || key.startsWith(`${output.id}-q`)) toolOutputPre.delete(key);
  }
}

function promoteToolOutputs(outputs: PendingToolOutput[]): void {
  if (outputs.length === 0) return;
  const wrapper = addMsg("assistant");
  wrapper.classList.add("presented-tool-response");
  for (const output of outputs) {
    markToolOutputPromoted(output);
    wrapper.appendChild(buildPresentedToolOutput(output));
  }
  scrollToBottom(true);
}

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
  questions: AskUserQuestion[],
): HTMLElement[] {
  const cards: HTMLElement[] = [firstCard];
  firstCard.dataset.askUser = "true";
  const inheritedStatus = firstCard.dataset.toolStatus as ToolExecutionStatus | undefined;
  const firstQuestion = questions[0];
  setAskUserHeader(firstCard, firstQuestion?.question ?? "");
  const label = firstCard.querySelector(".code-label");
  if (label) label.textContent = "ask_user";
  const firstPre = firstCard.querySelector<HTMLPreElement>(".code-block pre");
  if (firstPre && firstQuestion) {
    firstPre.textContent = formatAskUserQuestion(firstQuestion, t("askUserOptions"));
  }
  // no timer for the questions: not needed (also remove from the first card,
  // which had it from buildToolCard)
  firstCard.querySelector(".tool-timer")?.remove();
  let prev = firstCard;
  for (let i = 1; i < questions.length; i++) {
    const question = questions[i]!;
    const card = buildToolCard({ id: "", name: "ask_user", args: "" });
    card.dataset.askUser = "true";
    setAskUserHeader(card, question.question);
    if (inheritedStatus) setToolExecutionStatus(card, inheritedStatus);
    const pre = card.querySelector<HTMLPreElement>(".code-block pre");
    if (pre) {
      pre.textContent = formatAskUserQuestion(question, t("askUserOptions"));
    }
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
  for (const c of Array.from(els.thread.querySelectorAll<HTMLElement>(".tool-card"))) {
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
  return displayMessageContent(content).text;
}

function ensureToolOutput(card: HTMLElement, id: string): HTMLPreElement {
  let pre = toolOutputPre.get(id);
  if (!pre || !card.contains(pre)) {
    const body = document.createElement("div");
    body.className = "code-block tool-output";
    const header = document.createElement("div");
    header.className = "code-header tool-output-header";
    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent = t("result");
    pre = document.createElement("pre");
    header.append(label);
    addCopyButton(header, () => pre?.textContent ?? "");
    body.append(header, pre);
    card.appendChild(body);
    toolOutputPre.set(id, pre);
  }
  return pre;
}

function renderToolResultImages(card: HTMLElement, images: ImageContent[]): void {
  const output = card.querySelector<HTMLElement>(":scope > .tool-output");
  output?.querySelector(":scope > .tool-result-images")?.remove();
  if (!output || images.length === 0) return;
  appendChatImages(output, images, "tool-result-images");
}

function renderToolResultContent(
  card: HTMLElement,
  id: string,
  content: DisplayMessageContent,
): void {
  const pre = ensureToolOutput(card, id);
  pre.textContent = content.text;
  pre.hidden = content.text.length === 0;
  renderToolResultImages(card, content.images);
}

function resetToolResultContent(card: HTMLElement, id: string): HTMLPreElement {
  const pre = ensureToolOutput(card, id);
  pre.hidden = false;
  pre.textContent = "";
  renderToolResultImages(card, []);
  return pre;
}

function renderShellResultExitCode(
  card: HTMLElement,
  output: string,
  isError: boolean,
  explicitCode?: unknown,
): void {
  if (!isShellTool(card.dataset.toolName ?? "")) return;
  const header = card.querySelector<HTMLElement>(
    ":scope > .tool-output > .tool-output-header",
  );
  if (!header) return;
  header.querySelector(":scope > .tool-exit-code")?.remove();
  const code = shellResultExitCode(output, isError, explicitCode);
  const exit = document.createElement("span");
  exit.className = `tool-exit-code tool-exit-code-${isError ? "error" : "success"}`;
  exit.textContent = `${t("toolExitCode")}: ${code ?? "—"}`;
  const resultLabel = header.querySelector(":scope > .code-label");
  if (resultLabel) resultLabel.after(exit);
  else header.appendChild(exit);
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
    // timer/status on ALL the cards (ask_user has one per question)
    forEachToolCard(id, (c) => {
      setToolExecutionStatus(c, "running");
      startToolTimer(c);
    });
    resetToolResultContent(card, id);
  } else if (evt.type === "tool_execution_update") {
    const part = evt.partialResult as { content?: unknown } | undefined;
    const text = extractTextContent(part?.content);
    if (text) {
      const pre = ensureToolOutput(card, id);
      pre.hidden = false;
      pre.textContent += text;
      scrollToBottom();
    }
  } else if (evt.type === "tool_execution_end") {
    const isError = evt.isError === true;
    const status: ToolExecutionStatus = isError ? "error" : "success";
    forEachToolCard(id, (c) => {
      stopToolTimer(c);
      setToolExecutionStatus(c, status);
    });
    const res = evt.result as
      | {
          content?: unknown;
          exitCode?: unknown;
          details?: { diff?: string; exitCode?: unknown };
        }
      | undefined;
    // added/removed/modified lines from the diff (edit/write/edit-diff)
    const diff = res?.details?.diff;
    if (diff) renderToolDiff(card, diff);
    const content = toolExecutionEndContent(evt);
    if (hasPresentedContent(content)) {
      trailingToolOutputs.record({
        id,
        toolName: card.dataset.toolName ?? "tool",
        content,
        isError,
        card,
      });
    }
    if (content.text && distributeAskUserResult(id, content.text)) {
      renderToolResultImages(card, content.images);
      scrollToBottom();
      return;
    }
    if (hasPresentedContent(content)) {
      renderToolResultContent(card, id, content);
      scrollToBottom();
    }
    renderShellResultExitCode(
      card,
      content.text,
      isError,
      res?.exitCode ?? res?.details?.exitCode,
    );
  }
}

function renderRpcEvent(evt: RpcEvent): void {
  trackWorking(evt);
  if (evt.type === "agent_start") {
    trailingToolOutputs.beginRun();
    finishRunningAgenticBlocks();
    activeAgenticBlock = null;
    agenticRunStartedAt = agenticThinking ? performance.now() : 0;
  } else if (evt.type === "turn_start" && agenticThinking && !agenticRunStartedAt) {
    agenticRunStartedAt = performance.now();
  }
  if (evt.type === "agent_end" || evt.type === "agent_settled") {
    interruptThinking();
    removeEmptyActiveAgenticBlock();
    finishRunningAgenticBlocks();
    activeAgenticBlock = null;
    agenticRunStartedAt = 0;
    if (evt.type === "agent_settled") promoteToolOutputs(trailingToolOutputs.settle());
  }
  if (evt.type === "queue_update") {
    const steering = Array.isArray(evt.steering)
      ? evt.steering.filter((message): message is string => typeof message === "string")
      : [];
    const followUp = Array.isArray(evt.followUp)
      ? evt.followUp.filter((message): message is string => typeof message === "string")
      : [];
    nativeFollowUpQueue = followUp;
    // Preserve the exact arrays from pi, including repeated identical messages.
    renderNativeQueues(steeringAttachments.update(steering), followUp);
    return;
  }
  // pi clamps the thinking level to the active model's supported levels (a
  // model switch included): mirror the effective level, never the stale one
  if (evt.type === "thinking_level_changed") {
    applyThinkingLevel(evt.level);
    return;
  }
  if (evt.type === "turn_end") {
    // The context gauge follows every model response, not only the end of the
    // whole run: a long tool loop kept it stale until agent_settled.
    void fetchSessionStats();
    return;
  }
  if (evt.type === "message_start") {
    const msg = (
      evt as {
        message?: {
          role?: string;
          customType?: string;
          content?: unknown;
          display?: unknown;
        };
      }
    ).message;
    const role = msg?.role;
    if (role === "user") {
      const queuedBefore = steeringAttachments.snapshot();
      const queuedAfter = steeringAttachments.delivered(extractTextContent(msg?.content));
      if (queuedAfter.length !== queuedBefore.length) {
        renderNativeQueues(queuedAfter, nativeFollowUpQueue);
      }
      // Every accepted user message is a visible boundary: close the current
      // thought/tool chain, render the message, then start a fresh provider
      // wait. pi emits the initial prompt after agent_start + turn_start and
      // emits injected steering messages before their next assistant response.
      breakInternalActivityChain();
      renderUserMessageStart(evt);
      const restartedAt = waitingResponseRestartAt(working, performance.now());
      if (restartedAt !== null) armWaitingResponse(true, restartedAt);
      return;
    }
    if (msg && role === "custom" && msg.display !== false) {
      // legacy "pi-webview-startup" custom messages (older extension versions
      // wrote them into the session): the welcome banner is pure UI now
      // (getStartupInfo), never part of the session — skip silently
      if ((msg as { customType?: string }).customType === "pi-webview-startup") {
        return;
      }
      // message injected from ANOTHER session (e.g. session-control
      // `send`): incoming bubble — the chat must show it
      renderCustomMessageBubble(msg);
      return;
    }
    // toolResult and other local messages are persisted between turns but are
    // not provider streams. Passing them to the assistant stream renderer used
    // to create and immediately remove an empty bubble, shrinking the thread
    // and occasionally breaking bottom-following.
    if (role && role !== "assistant") return;
  }
  // compaction: show the block even if started by pi (auto-compaction)
  if (evt.type === "compaction_start") {
    showCompactionBlock();
  } else if (evt.type === "compaction_end") {
    // REAL outcome from pi: errorMessage present → failed (the client cannot
    // trust the response alone: it arrives after the event)
    const errMsg = evt.errorMessage as string | undefined;
    finishCompaction(!!errMsg, errMsg);
    // pi's exact message (e.g. "Compaction failed: Nothing to compact
    // (session too small)") must be visible in the chat, not only in the
    // block tooltip
    if (errMsg) addSystemBox("error", errMsg);
    // A successful continuation emits turn_start immediately before its next
    // provider request; do not guess that boundary from compaction completion.
  } else if (evt.type === "connection_closed") {
    trailingToolOutputs.clear();
    if (evt.reason === "restart") {
      // INTENTIONAL restart (Apply CLI flags): pi is restarting with the new
      // command line → no error; the re-init arrives with pi_restarted
      renderNativeQueues([], []);
      setComposerActivity("connection_closed");
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
    failRunningTools();
    if (compacting) finishCompaction(true, (evt.errorMessage as string) ?? undefined);
    disarmWaitingResponse();
    renderNativeQueues([], []);
    setComposerActivity("connection_closed");
    initialAgentWaitStartedAt = 0;
    updateSendButton();
    if (evt.reason === "invalid_session") {
      addStatusLine(tpl(t("sessionNotFound"), { id: String(evt.sessionId ?? "") }));
      return;
    }
    const cmd = evt.command as string | undefined;
    addStatusLine(cmd ? tpl(t("piDiedHint"), { command: cmd }) : t("piDied"));
  } else if (evt.type === "panel_mode") {
    // webview in an EDITOR PANEL (not sidebar): the attached selection is
    // unreliable (panel focus clears the active-editor context) → disable
    // the selection block and never attach stale sidebar context
    panelMode = evt.enabled === true;
    if (panelMode) clearEditorSelectionPanel();
  } else if (evt.type === "pi_restarted") {
    // restart completed: re-initialize WITHOUT reload (transparent): session
    // state + config; the current session is resumed by the companion with
    // --session, currentSessionPath is still in memory
    renderNativeQueues([], []);
    piRestarting = false;
    // the fresh process reloaded the project resources: the trust chip shows
    // the status it was launched with and the pending "!" disappears
    void refreshTrust();
    // a terminal /login (or a new provider) changes the model list
    void warnWhenNoModelsAvailable();
    updateSendButton();
    // A unified Apply may have changed launch flags; keep its single dirty
    // state aligned while preserving edits staged during unrelated restarts.
    if (applyingSettings && cliDirty) {
      savedCliValues = currentCliValues();
      cliDirty = false;
      updateSettingsApplyState();
    }
    if (compacting) finishCompaction(true, "restart");
    void (async () => {
      await requestConfig();
      if (!demoMode) {
        // same loading semantics as the boot: extensions logging during the
        // re-init go under the spinner, the loader ends when they settle
        beginSessionLoading();
        await refreshSessions(true);
      }
    })();
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
  // the session model no longer exists: the host relaunched pi on the default
  // model of new sessions and reports it here (never silent)
  if (evt.type === "model_fallback") {
    const to = evt.to as { provider?: unknown; id?: unknown } | undefined;
    const model =
      typeof to?.provider === "string" && typeof to?.id === "string"
        ? `${to.provider}/${to.id}`
        : "";
    addSystemBox(
      "warn",
      model ? tpl(t("modelFallback"), { model }) : t("modelFallbackDefault"),
    );
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
    if (evt.type === "tool_execution_start") {
      // A tool card and its own timer are visible; this is local execution,
      // not a provider wait. Parallel tools need no special accounting:
      // pi emits the next turn_start only after the complete batch settles.
      disarmWaitingResponse();
    }
    return;
  }
  const action: UiAction = handleRpcEvent(stream, evt);
  switch (action.kind) {
    case "stream_start":
      // message_start arrives before real content. Agentic mode deliberately
      // defers the assistant text wrapper so internal-only messages never add
      // and later remove an empty chat block.
      prepareAssistantStream();
      if (!agenticThinking) openAssistantBubble();
      break;
    case "text_delta":
      // Visible model text is a hard boundary: close the current consecutive
      // thinking/tool chain before rendering the text itself.
      if (thinkingEl && !thinkingContentRendered) finishThinking();
      disarmWaitingResponse();
      breakAgenticChain();
      if (!currentMsg) openAssistantBubble();
      markdownAccum += action.delta;
      scheduleMarkdownRender();
      scrollToBottom();
      // The response is still open. Reset the inactivity watchdog so a pause
      // before the next text block or tool call becomes visible after 1s.
      armWaitingResponse();
      break;
    case "thinking_delta":
      // a thought follows the waiting card: PROMOTE it in place (label
      // swapped, timer continues); without a waiting card a fresh thinking
      // block is created
      if (waitingCardEl) {
        promoteWaitingToThinking();
      } else {
        // a thought is already streaming: there is no model wait anymore —
        // cancel the pending waiting timer, otherwise it fires at 1s and a
        // GHOST "waiting" card appears next to the real thinking block
        disarmWaitingResponse();
        ensureThinkingLoader();
      }
      thinkingAccum += action.delta;
      scheduleThinkingContentRender();
      break;
    case "thinking_end":
      // This ends one content block, not necessarily the complete reasoning:
      // some providers emit two or more consecutive thinking blocks. Flush
      // its last delta but keep the clock alive until text/tool/message_end.
      flushThinkingContentRender();
      break;
    case "tool_call_start":
      trailingToolOutputs.assistantToolCall();
      if (thinkingEl && !thinkingContentRendered) finishThinking();
      // the name arrives with toolcall_start (partial.content[index].name):
      // the card is born ALREADY with the real name, no "tool" placeholder
      // Keep an empty agentic shell for normal tools so the waiting card is
      // replaced in place; ask_user closes it below.
      disarmWaitingResponse(agenticThinking);
      {
        const tc = action.toolCall;
        if (tc.name) {
          // new ask_user tool: reset the counter — the cards split at the
          // first select (the args arrive with the deltas, not here)
          if (tc.name === "ask_user") {
            askUserQuestionCounter = 0;
            currentAskUserToolId = "";
            breakAgenticChain();
          }
          const card = ensureToolCard(tc.name, tc.name === "ask_user");
          card.dataset.toolName = tc.name;
          // Raw cumulative JSON remains available while arguments are generated.
          // Preserve the user's collapsed/expanded state; the specialized
          // renderer replaces it only at tool_call completion.
          toolsPre = renderStreamingToolArguments(card, "");
          // the timer starts AS SOON AS the card is born (args generation
          // included), not at tool_execution_start: while the diff counters
          // scroll the timer already runs. startToolTimer is idempotent (the
          // second start at execution_start is a no-op) and stopToolTimer at
          // execution_end freezes it.
          startToolTimer(card);
          setToolExecutionStatus(card, "running");
          // new tool: reset the args of the previous tool (multi-tool)
          toolsText = "";
          renderToolHeader(
            card.querySelector(".tool-name")!,
            toolSummary(tc.name, "", workspacePath ?? undefined),
          );
          // File tools: create the args slot immediately so the streamed path
          // can appear as soon as its JSON string is complete. The flex slot
          // also keeps diff badges aligned before the timer.
          if (
            tc.name === "read" ||
            tc.name === "write" ||
            tc.name === "edit" ||
            tc.name === "edit-diff"
          ) {
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
      // Fallback for providers/older pi versions that omit toolcall_start.
      trailingToolOutputs.assistantToolCall();
      if (thinkingEl && !thinkingContentRendered) finishThinking();
      disarmWaitingResponse(agenticThinking);
      const fallbackCard = ensureToolCard();
      startToolTimer(fallbackCard);
      setToolExecutionStatus(fallbackCard, "running");
      toolsText += action.delta;
      // Keep the cumulative raw JSON visible for EVERY tool while the model
      // generates arguments. Specialized visual formatting is intentionally
      // deferred until the authoritative tool_call event.
      if (toolsEl) {
        toolsPre = renderStreamingToolArguments(toolsEl, toolsText);
        const tName = toolsEl.querySelector(".tool-name")?.textContent ?? "";
        // write: LIVE line counter — here the deltas REALLY scroll (the
        // content is long) and the number rises in real time. The edits NO
        // (args in bursts): for them only the exact diff at execution end stays.
        const streamedPath = streamedToolPath(
          tName,
          toolsText,
          workspacePath ?? undefined,
        );
        if (streamedPath) {
          const argsEl = toolsEl.querySelector<HTMLElement>(".tool-args");
          if (argsEl && argsEl.title !== streamedPath) {
            argsEl.textContent = ` ${streamedPath}`;
            argsEl.title = streamedPath;
          }
          const filePath = streamedToolFilePath(tName, toolsText);
          const openButton = toolsEl.querySelector<HTMLElement>(".tool-open-file");
          if (filePath && openButton?.dataset.filePath !== filePath) {
            renderToolOpenButton(
              toolsEl.querySelector<HTMLElement>(".tool-name")!,
              filePath,
            );
          }
        }
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
      trailingToolOutputs.assistantToolCall();
      if (thinkingEl && !thinkingContentRendered) finishThinking();
      disarmWaitingResponse(agenticThinking);
      if (toolsEl) {
        const tcName = action.toolCall.name;
        toolsEl.dataset.toolName = tcName;
        if (tcName === "ask_user") moveAskUserOutsideAgentic(toolsEl);
        else registerAgenticTool(toolsEl, tcName);
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
        if (tcName === "read") {
          renderReadToolArguments(toolsEl, action.toolCall.args, true);
          toolsPre = null;
        } else if (tcName === "write") {
          renderWriteToolArguments(toolsEl, action.toolCall.args, true);
        } else if (tcName === "edit") {
          renderEditToolArguments(toolsEl, action.toolCall.args);
          toolsPre = null;
        } else if (isShellTool(tcName)) {
          renderShellToolArguments(toolsEl, action.toolCall.args);
          toolsPre = null;
        } else if (toolsPre) {
          toolsPre.textContent = action.toolCall.args;
        }
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
          if (lines <= 0 && toolsPre)
            lines = writeLinesFromArgs(toolsPre.textContent ?? "");
          renderWriteLines(toolsEl, lines);
        }
      }
      break;
    case "message_end":
      // Remove waiting first. In agentic mode preserve its shell until the
      // authoritative message decides whether thinking/tools fill it or a
      // visible-text / ask_user boundary removes it.
      disarmWaitingResponse(agenticThinking);
      finalizeMessage(action.message);
      removeEmptyActiveAgenticBlock();
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

// Appends a system box directly to the chat. History rendering uses this
// lower-level function so persisted errors can never be mistaken for live
// startup logs and routed under the loading spinner.
function appendSystemBox(level: "error" | "warn" | "info", text: string): void {
  const clean = formatProviderError(cleanConsoleText(text));
  if (!clean) return;
  const wrapper = addMsg("status");
  const line = document.createElement("div");
  line.className = `status-line level-${level}`;
  line.textContent = clean;
  line.title = clean;
  wrapper.appendChild(line);
  scrollToBottom();
}

// System box for LIVE events. During a session load, live lines are shown
// under the spinner and collected for the end of the resumed chat.
function addSystemBox(level: "error" | "warn" | "info", text: string): void {
  const clean = formatProviderError(cleanConsoleText(text));
  if (!clean) return;
  if (sessionLoading) {
    pushLoadingLog(level, clean);
    return;
  }
  appendSystemBox(level, clean);
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

// The one-time package-update notice uses the same card family as the
// Context/Skills/Extensions startup information, not the warning treatment.
function appendReleaseReminderCard(text: string): void {
  const wrapper = addMsg("status");
  const card = document.createElement("div");
  card.className = "startup-card release-reminder-card";
  const row = document.createElement("div");
  row.className = "startup-section release-reminder-section";
  const label = document.createElement("span");
  label.className = "startup-label";
  label.textContent = "pi-webview";
  const content = document.createElement("span");
  content.className = "startup-items release-reminder-items";
  content.textContent = text;
  row.append(label, content);
  card.appendChild(row);
  wrapper.appendChild(card);
  scrollToBottom();
}

function addReleaseReminderCard(text: string): void {
  const reminder = text.trim();
  if (!reminder) return;
  // Session history clears the thread while loading. Defer a startup-time
  // notification so it is not lost before its card can be displayed.
  if (sessionLoading || !loadingHistoryLoaded) {
    pendingReleaseReminderCards.push(reminder);
    return;
  }
  appendReleaseReminderCard(reminder);
}

function flushPendingReleaseReminderCards(): void {
  if (!loadingHistoryLoaded || pendingReleaseReminderCards.length === 0) return;
  const reminders = pendingReleaseReminderCards.splice(
    0,
    pendingReleaseReminderCards.length,
  );
  for (const reminder of reminders) appendReleaseReminderCard(reminder);
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

// --- new-session welcome banner (pure UI, never persisted) -------------------
// The pi-side extension writes the loaded resources (Context files / Skills /
// Extensions — the TUI startup banner, Themes excluded) to a per-process file
// at session_start; the host serves it via the getStartupInfo IDE request.
// The webview renders ONE banner card in the chat, ONLY while the session is
// still empty (new session / fresh boot): it is never part of the session
// jsonl and never re-rendered from history.
// set by loadHistory from the get_messages DATA (the DOM alone cannot tell
// real messages from boot/loading log boxes)
let sessionHasMessages = false;

function buildStartupBanner(data: StartupInfo): HTMLElement {
  const card = document.createElement("div");
  card.className = "startup-card";
  const section = (label: string, items: string[] | undefined): void => {
    if (!items || items.length === 0) return;
    const row = document.createElement("div");
    row.className = "startup-section";
    const tag = document.createElement("span");
    tag.className = "startup-label";
    tag.textContent = label;
    row.appendChild(tag);
    const text = document.createElement("span");
    text.className = "startup-items";
    text.textContent = items.join(", ");
    row.appendChild(text);
    card.appendChild(row);
  };
  section(t("startupContext"), data.contextFiles);
  section(t("startupSkills"), data.skills);
  section(t("startupExtensions"), data.extensions);
  // outdated pi core / npm extensions: highlighted note(s) (the header
  // button performs the update)
  if (data.updateAvailable) appendStartupUpdateRow(card, data.updateAvailable);
  return card;
}

// the pi-side check may finish AFTER the startup-info file was written:
// append the row to the already-rendered banner when the second request
// finally reports an available update (pi core and/or npm extensions)
function appendStartupUpdateRow(card: HTMLElement, ua: UpdateAvailable): void {
  if (ua.core && !card.querySelector(".startup-update-core")) {
    const row = document.createElement("div");
    row.className = "startup-section startup-update startup-update-core";
    row.textContent = tpl(t("startupUpdateNote"), {
      current: ua.core.current,
      latest: ua.core.latest,
    });
    card.appendChild(row);
  }
  if (ua.extensions.length > 0 && !card.querySelector(".startup-update-exts")) {
    const row = document.createElement("div");
    row.className = "startup-section startup-update startup-update-exts";
    row.textContent = tpl(t("startupExtensionsUpdateNote"), {
      list: ua.extensions
        .map((e) => `${e.name}: v${e.current} → v${e.latest}`)
        .join(", "),
    });
    card.appendChild(row);
  }
}

async function maybeShowStartupBanner(): Promise<void> {
  const res = await ideRequest({ type: "getStartupInfo" });
  if (!res?.ok) return;
  const info = (res.data as { info?: StartupInfo | null } | undefined)?.info;
  if (!info) return;
  // header update shield: ALWAYS visible on any session (new or resumed) —
  // blue = up-to-date (click re-checks NOW), yellow = update available.
  // The check is pi-side, done LIVE at process load (no cache); the welcome
  // banner below stays new-session-only
  els.updatePi.hidden = false;
  updateInfo = info.updateAvailable ?? null;
  applyUpdateShield();
  // one delayed re-request: the pi-side update check (npm registry lookups)
  // may complete right after the startup-info file was written for this
  // session (or a resumed one, after a window reload)
  if (!info.updateAvailable) {
    setTimeout(() => {
      void refreshStartupUpdate();
    }, 4000);
  }
  const hasResources =
    info.contextFiles.length > 0 || info.skills.length > 0 || info.extensions.length > 0;
  if (!hasResources && !info.updateAvailable) return;
  // welcome banner: only while the chat has no real messages yet (new/empty
  // session): the check is on the DATA (set by loadHistory), not the DOM —
  // boot/loading log boxes may already sit in the thread
  if (sessionHasMessages) return;
  const wrapper = addMsg("status");
  const card = buildStartupBanner(info);
  startupBannerCard = card;
  wrapper.appendChild(card);
  // above any boot/loading log boxes flushed at the end of the resume
  els.thread.prepend(wrapper);
  scrollToBottom();
}

// second pass: if the update check finished after the first startup-info
// read, surface the header button (any session) and the banner note while
// the chat is still empty
async function refreshStartupUpdate(): Promise<void> {
  const res = await ideRequest({ type: "getStartupInfo" });
  if (!res?.ok) return;
  const info = (res.data as { info?: StartupInfo | null } | undefined)?.info;
  if (!info?.updateAvailable) return;
  updateInfo = info.updateAvailable;
  applyUpdateShield();
  if (sessionHasMessages) return; // button only; the banner is new-session-only
  if (startupBannerCard) {
    appendStartupUpdateRow(startupBannerCard, info.updateAvailable);
  } else {
    const wrapper = addMsg("status");
    const card = buildStartupBanner(info);
    startupBannerCard = card;
    wrapper.appendChild(card);
    els.thread.prepend(wrapper);
  }
  scrollToBottom();
}

// last rendered startup banner card (null → not rendered this session)
let startupBannerCard: HTMLElement | null = null;

type SelectionPanel = HTMLDivElement & {
  editorSelection?: ActiveEditorSelection;
  browserContext?: BrowserPageContext;
};

function clearEditorSelectionPanel(): void {
  const panel = els.selectionPanel as SelectionPanel;
  delete panel.editorSelection;
  if (!panel.browserContext) panel.hidden = true;
}

function clearBrowserContextPanel(): void {
  const panel = els.selectionPanel as SelectionPanel;
  delete panel.browserContext;
  if (!panel.editorSelection) panel.hidden = true;
}

// The box is the source of truth: context exists only while this exact box is
// visible. There is no separate "last selection" state in the webview.
function visibleEditorSelection(): ActiveEditorSelection | null {
  const panel = els.selectionPanel as SelectionPanel;
  return panel.hidden ? null : (panel.editorSelection ?? null);
}

function visibleBrowserContext(): BrowserPageContext | null {
  const panel = els.selectionPanel as SelectionPanel;
  return panel.hidden ? null : (panel.browserContext ?? null);
}

function attachVisibleContext(message: string): string {
  return attachBrowserPageContext(
    attachEditorSelectionContext(message, visibleEditorSelection()),
    visibleBrowserContext(),
  );
}

let browserToolConfirmTail: Promise<void> = Promise.resolve();

function queueBrowserToolConfirm<T>(confirm: () => Promise<T>): Promise<T> {
  const pending = browserToolConfirmTail.then(confirm);
  browserToolConfirmTail = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function browserActionSummary(actions: BrowserPageAction[]): string {
  return actions
    .map((action, index) => {
      const selector =
        "selector" in action && action.selector
          ? action.selector
          : t("browserActionPage");
      if (action.type === "click_at") {
        return `${index + 1}. ${t("browserActionClickAt")} (${action.x}, ${action.y})`;
      }
      if (action.type === "type") {
        const text =
          action.text.length > 500 ? `${action.text.slice(0, 500)}…` : action.text;
        return `${index + 1}. ${t("browserActionType")} ${selector}\n   ${JSON.stringify(text)}`;
      }
      if (action.type === "select") {
        return `${index + 1}. ${t("browserActionSelect")} ${selector}\n   ${JSON.stringify(action.value)}`;
      }
      if (action.type === "scroll") {
        if (action.deltaX === undefined && action.deltaY === undefined) {
          return `${index + 1}. ${t("browserActionReveal")} ${selector} (${action.block ?? "center"}, ${action.inline ?? "nearest"})`;
        }
        return `${index + 1}. ${t("browserActionScroll")} ${selector} (${action.deltaX ?? 0}, ${action.deltaY ?? 0})`;
      }
      if (action.type === "reload") {
        return `${index + 1}. ${t("browserActionReload")}`;
      }
      if (action.type === "navigate") {
        const url = action.url.length > 500 ? `${action.url.slice(0, 500)}…` : action.url;
        return `${index + 1}. ${t("browserActionNavigate")}\n   ${url}`;
      }
      if (action.type === "class") {
        const changes = [
          ...(action.add ?? []).map((token) => `+${token}`),
          ...(action.remove ?? []).map((token) => `-${token}`),
        ];
        return `${index + 1}. ${t("browserActionClass")} ${selector}\n   ${changes.join(" ")}`;
      }
      if (action.type === "style") {
        const changes = [
          ...(action.set ?? []).map((value) => {
            const preview =
              value.value.length > 300 ? `${value.value.slice(0, 300)}…` : value.value;
            return `${value.property}: ${preview}${value.priority ? " !important" : ""}`;
          }),
          ...(action.remove ?? []).map((property) => `${property}: ${t("remove")}`),
        ];
        return `${index + 1}. ${t("browserActionStyle")} ${selector}\n   ${changes.join("; ")}`;
      }
      const label =
        action.type === "click"
          ? action.target === "visual"
            ? t("browserActionVisualClick")
            : t("browserActionClick")
          : t("browserActionFocus");
      return `${index + 1}. ${label} ${selector}`;
    })
    .join("\n");
}

function browserPermissionMessageKey(operation: BrowserToolOperation): string {
  if (operation === "dom") return "browserPermissionDomConsent";
  if (operation === "screenshot") return "browserPermissionScreenshotConsent";
  return "browserPermissionActionConsent";
}

async function allowBrowserToolOperation(
  origin: string,
  operation: BrowserToolOperation,
  actions?: BrowserPageAction[],
): Promise<boolean> {
  await browserSessionSettingsReady;
  if (
    browserToolPermissionGranted(
      operation,
      origin,
      browserSessionPermissions,
      browserPersistentPermissions,
    )
  ) {
    return true;
  }
  return queueBrowserToolConfirm(async () => {
    if (
      browserToolPermissionGranted(
        operation,
        origin,
        browserSessionPermissions,
        browserPersistentPermissions,
      )
    ) {
      return true;
    }
    const scope = await showBrowserPermissionDialog(
      `${tpl(t(browserPermissionMessageKey(operation)), { origin })}\n\n${t("browserPermissionScopeHelp")}`,
      operation === "action" && actions ? browserActionSummary(actions) : undefined,
    );
    if (!scope) return false;
    if (scope === "session") {
      browserSessionPermissions = grantBrowserSessionPermission(
        browserSessionPermissions,
        operation,
      );
      currentSessionSettings = {
        ...currentSessionSettings,
        browserToolPermissions: browserSessionPermissions,
      };
      persistCurrentSessionSettings();
    } else {
      browserPersistentPermissions = grantBrowserPersistentPermission(
        browserPersistentPermissions,
        operation,
        origin,
        scope,
      );
      persistWebviewConfig({
        browserToolPermissions: browserPersistentPermissions,
      });
    }
    return true;
  });
}

async function handleBrowserToolRequest(
  requestId: string,
  operation: BrowserToolOperation,
  requestedActions?: BrowserPageAction[],
  requestedSelector?: string,
): Promise<void> {
  const context = visibleBrowserContext();
  if (!context || !browserPanelConnection) {
    await ideRequest({
      type: "browserToolResponse",
      requestId,
      result: { ok: false, operation, error: t("browserPageToolDenied") },
    });
    return;
  }
  let actions: BrowserPageAction[] | undefined;
  let selector: string | undefined;
  let origin: string | null;
  let expectedOrigin: string | undefined;
  try {
    actions =
      operation === "action" ? normalizeBrowserPageActions(requestedActions) : undefined;
    selector =
      operation === "dom" && requestedSelector !== undefined
        ? normalizeBrowserElementSelector(requestedSelector)
        : undefined;
    origin = browserToolPermissionOrigin(
      operation,
      context.url,
      context.restricted,
      actions,
    );
    expectedOrigin = new URL(context.url).origin;
  } catch {
    await ideRequest({
      type: "browserToolResponse",
      requestId,
      result: { ok: false, operation, error: t("browserPageToolInvalid") },
    });
    return;
  }
  if (!origin) {
    await ideRequest({
      type: "browserToolResponse",
      requestId,
      result: { ok: false, operation, error: t("browserPageToolDenied") },
    });
    return;
  }
  const allowed = await allowBrowserToolOperation(origin, operation, actions);
  if (!allowed) {
    await ideRequest({
      type: "browserToolResponse",
      requestId,
      result: { ok: false, operation, error: t("browserPageToolDenied") },
    });
    return;
  }
  browserPanelConnection.send({
    type: "browser_tool_execute",
    requestId,
    operation,
    ...(actions ? { actions } : {}),
    ...(selector ? { selector } : {}),
    ...(expectedOrigin ? { expectedOrigin } : {}),
    expectedUrl: context.url,
    expectedDocumentId: context.documentId,
  });
}

function renderBrowserContext(context: BrowserPageContext): void {
  const panel = els.selectionPanel as SelectionPanel;
  panel.replaceChildren();
  panel.browserContext = context;
  delete panel.editorSelection;
  if (context.faviconUrl) {
    const favicon = document.createElement("img");
    favicon.className = "browser-context-favicon";
    favicon.src = context.faviconUrl;
    favicon.alt = "";
    favicon.referrerPolicy = "no-referrer";
    panel.appendChild(favicon);
  }
  const title = document.createElement("span");
  title.className = "browser-context-title";
  title.textContent = context.title || context.url;
  panel.appendChild(title);
  if (context.ranges.length > 0) {
    const ranges = document.createElement("span");
    ranges.className = "browser-context-ranges";
    ranges.textContent = `(${context.ranges.length})`;
    panel.appendChild(ranges);
  }
  panel.title = context.url;
  panel.hidden = false;
}

function renderIdeEvent(evt: IdeEvent): void {
  if (evt.type === "browser_handoff_adopted") {
    browserPanelConnection?.send({ type: "handoff_adopted" });
    return;
  }
  if (evt.type === "browser_context_changed") {
    renderBrowserContext(evt.context);
    return;
  }
  if (evt.type === "browser_context_cleared") {
    clearBrowserContextPanel();
    return;
  }
  if (evt.type === "browser_tool_request") {
    void handleBrowserToolRequest(
      evt.requestId,
      evt.operation,
      evt.actions,
      evt.selector,
    );
    return;
  }
  if (evt.type === "selection_changed" || evt.type === "selection_cleared") {
    // editor panel: selection context is disabled because panel focus clears
    // the active editor; never retain context that cannot be shown reliably
    if (panelMode) {
      clearEditorSelectionPanel();
      return;
    }
    if (evt.type === "selection_changed") {
      const ranges = (evt.ranges ?? []).filter((range) => range.text.length > 0);
      if (ranges.length === 0) {
        clearEditorSelectionPanel();
        return;
      }
      const panel = els.selectionPanel as SelectionPanel;
      panel.replaceChildren();
      panel.editorSelection = {
        filePath: evt.filePath,
        workspaceFolder: evt.workspaceFolder,
        ranges,
      };
      // dedicated block (one row, like the steering): appears with the selection
      const base = evt.filePath?.split(/[\\/]/).pop() ?? evt.filePath ?? "?";
      delete panel.browserContext;
      panel.textContent = `${t("selection")}: ${base} (${ranges.length})`;
      panel.title = `${t("selection")}: ${evt.filePath ?? "?"} — ${ranges.length} ${t("ranges")}`;
      const wasHidden = panel.hidden;
      panel.hidden = false;
      // Revealing editor context follows the same smart-scroll policy as a
      // newly added chat element: remain at the bottom only when the user was
      // already following it, never pull a detached viewport back down.
      if (wasHidden) scrollToBottom();
    } else {
      clearEditorSelectionPanel();
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
  trailingToolOutputs.clear();
  finishRunningAgenticBlocks();
  els.thread.textContent = "";
  activeAgenticBlock = null;
  agenticRunStartedAt = 0;
  let historyAgenticBlock: AgenticBlock | null = null;
  let historyAgenticStartedAt = 0;
  const finishHistoryAgenticBlock = (endedAt: number): void => {
    if (!historyAgenticBlock) return;
    const duration =
      historyAgenticStartedAt > 0 && endedAt >= historyAgenticStartedAt
        ? endedAt - historyAgenticStartedAt
        : undefined;
    finishAgenticBlock(historyAgenticBlock, duration);
    historyAgenticBlock = null;
    historyAgenticStartedAt = 0;
  };
  const ensureHistoryAgenticBlock = (startedAt: number): AgenticBlock => {
    if (!historyAgenticBlock?.root.isConnected) {
      historyAgenticBlock = createAgenticBlock();
      historyAgenticStartedAt = startedAt;
    }
    return historyAgenticBlock;
  };
  const historyTrailingOutputs = new TrailingToolOutputResolver<PendingToolOutput>();
  historyTrailingOutputs.beginRun();
  const promoteHistoryTrailingOutputs = (): void => {
    const outputs = historyTrailingOutputs.settle();
    if (outputs.length === 0) return;
    finishHistoryAgenticBlock(lastTs);
    promoteToolOutputs(outputs);
  };
  let historyToolOutputSequence = 0;
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
      promoteHistoryTrailingOutputs();
      finishHistoryAgenticBlock(lastTs);
      renderUserContent(msg.content);
    } else if (
      msg.role === "custom" &&
      (msg as { display?: unknown }).display !== false
    ) {
      // legacy "pi-webview-startup" custom messages (older extension versions
      // wrote them into the session): the banner is pure UI now, never
      // persisted — skip silently
      if ((msg as { customType?: string }).customType === "pi-webview-startup") {
        continue;
      }
      promoteHistoryTrailingOutputs();
      // message injected from another session (session-control send):
      // collapsible card like the tools, also in history (otherwise it
      // would disappear on reload)
      const raw = contentToText(msg.content);
      const text = raw.replace(/<sender_info>[\s\S]*?<\/sender_info>/g, "").trim();
      if (!text) continue;
      finishHistoryAgenticBlock(lastTs);
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
      const toolGroups: Array<{ name: string; cards: HTMLElement[] }> = [];
      for (const b of blocks) {
        if (b.type === "text" && typeof b.text === "string") textParts.push(b.text);
        else if (b.type === "thinking") {
          const thinking = visibleThinkingContent(b.thinking);
          if (thinking) {
            thinkingCards.push(buildThinkingCard(thinking, thinkDur, agenticThinking));
          }
        } else if (b.type === "toolCall" && typeof b.name === "string") {
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
              toolGroups.push({ name: b.name, cards });
              continue;
            }
          }
          // write: +N lines (pi does not save the diff → computed from the args)
          if (b.name === "write") {
            renderWriteLines(card, writeLinesFromArgs(argsJson));
          }
          toolGroups.push({ name: b.name, cards: [card] });
        }
      }
      const text = textParts.join("\n").trim();
      const images = imageContentBlocks(msg.content);
      const toolCards = toolGroups.flatMap((group) => group.cards);
      if (text || images.length > 0) {
        historyTrailingOutputs.assistantVisible(text, images.length > 0);
      } else if (toolCards.length > 0) historyTrailingOutputs.assistantToolCall();
      if (
        !text &&
        images.length === 0 &&
        thinkingCards.length === 0 &&
        toolCards.length === 0
      )
        continue;

      if (agenticThinking) {
        if (thinkingCards.length > 0) {
          const agenticBlock = ensureHistoryAgenticBlock(lastTs);
          for (const card of thinkingCards) {
            agenticBlock.body.appendChild(card);
            registerAgenticThought(card, "success");
          }
        }

        // Visible model content always terminates the preceding consecutive chain.
        if (text || images.length > 0) {
          finishHistoryAgenticBlock(assistantTs);
          const wrapper = addMsg("assistant");
          if (text) {
            const md = document.createElement("div");
            md.className = "md";
            md.innerHTML = renderMarkdown(text);
            enhanceCodeBlocks(md);
            wrapper.appendChild(md);
          }
          appendChatImages(wrapper, images);
        }

        for (const group of toolGroups) {
          if (group.name === "ask_user") {
            finishHistoryAgenticBlock(assistantTs);
            const wrapper = addMsg("assistant");
            for (const card of group.cards) wrapper.appendChild(card);
            continue;
          }
          const agenticBlock = ensureHistoryAgenticBlock(assistantTs || lastTs);
          for (const card of group.cards) {
            agenticBlock.body.appendChild(card);
            registerAgenticTool(card, group.name);
          }
        }
      } else {
        const wrapper = addMsg("assistant");
        // 3px aggregation evaluated at creation: the message starts with
        // thinking/tool and the previous one ends with thinking/tool.
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
        for (const card of thinkingCards) wrapper.appendChild(card);
        if (text) {
          const md = document.createElement("div");
          md.className = "md";
          md.innerHTML = renderMarkdown(text);
          enhanceCodeBlocks(md);
          wrapper.appendChild(md);
        }
        appendChatImages(wrapper, images);
        for (const card of toolCards) wrapper.appendChild(card);
      }
      // failed turn (provider error): the session entry keeps the error —
      // surface it in history too (terminal parity)
      const errMsg =
        (msg as { errorMessage?: unknown }).errorMessage ??
        (msg as { message?: { errorMessage?: unknown } }).message?.errorMessage;
      if (typeof errMsg === "string" && errMsg.length > 0) {
        appendSystemBox("error", errMsg);
      }
    } else if (msg.role === "toolResult" || msg.role === "bashExecution") {
      const content =
        msg.role === "bashExecution"
          ? displayMessageContent(String(msg.output ?? msg.command ?? ""))
          : historyToolResultContent(msg);
      const output = content.text;
      const tcId = (msg as { toolCallId?: string }).toolCallId;
      const card = tcId ? toolCardsById.get(tcId) : undefined;
      let renderedCard = card;
      if (card && tcId) {
        forEachToolCard(tcId, (c) =>
          setToolExecutionStatus(c, msg.isError === true ? "error" : "success"),
        );
        const start = toolStartTimes.get(tcId);
        const ts = parseTs(msg);
        // ask_user: distribute the result per question (header → answer,
        // segment in the body) and timer on ALL the cards — final state at resume
        if (distributeAskUserResult(tcId, output)) {
          renderToolResultImages(card, content.images);
          if (start !== undefined && ts > 0 && ts >= start) {
            forEachToolCard(tcId, (c) => {
              const timerEl = c.querySelector<HTMLElement>(".tool-timer");
              if (timerEl) timerEl.textContent = fmtToolTime(ts - start);
            });
          }
          scrollToBottom();
        } else {
          // Result inside the tool card, using the same text/image renderer as
          // the live tool_execution_end path.
          renderToolResultContent(card, tcId, content);
          // diff badge (edit): il diff è nei details a livello message
          const det = (msg as { details?: { diff?: string; exitCode?: unknown } })
            .details;
          const diff = det?.diff;
          if (diff) renderToolDiff(card, diff);
          // durata reale del tool: timestamp toolResult − timestamp assistant
          if (start !== undefined && ts > 0 && ts >= start) {
            const timerEl = card.querySelector<HTMLElement>(".tool-timer");
            if (timerEl) timerEl.textContent = fmtToolTime(ts - start);
          }
          renderShellResultExitCode(
            card,
            output,
            msg.isError === true,
            (msg as { exitCode?: unknown }).exitCode ?? det?.exitCode,
          );
          scrollToBottom();
        }
      } else {
        // Without a matching agent tool call (for example an interactive shell
        // command), the result does not belong to an agentic flow.
        finishHistoryAgenticBlock(lastTs);
        const wrapper = addMsg("assistant");
        renderedCard = buildResultCard(
          msg.toolName ?? "bash",
          content,
          msg.isError === true,
        );
        wrapper.appendChild(renderedCard);
      }
      if (renderedCard && hasPresentedContent(content)) {
        historyTrailingOutputs.record({
          id: tcId ?? `history-tool-output-${++historyToolOutputSequence}`,
          toolName: msg.toolName ?? renderedCard.dataset.toolName ?? "tool",
          content,
          isError: msg.isError === true,
          card: renderedCard,
        });
      }
    }
    if (ts > 0) lastTs = ts; // base for the next thinking duration
  }
  promoteHistoryTrailingOutputs();
  finishHistoryAgenticBlock(lastTs);
  updateThinkingBlocksButton();
  stickToBottom = true;
  scrollToBottom(true);
}

// --- "back to bottom" button ------------------------------------------------

// beyond this margin from the bottom the button to go back down appears
const SCROLL_BTN_MARGIN = 220;

els.scrollBottom.innerHTML = scrollDownIcon();
els.newChat.innerHTML = newChatIcon();
els.updatePi.innerHTML = updateIcon();
updateThinkingBlocksButton();
els.settingsBtn.innerHTML = settingsIcon();
els.reload.innerHTML = reloadIcon();
els.scrollBottom.title = t("scrollToBottom");
els.scrollBottom.addEventListener("click", () => {
  // Rejoin the live bottom immediately. A smooth scroll targets the old
  // scrollHeight and can fall behind content that arrives during the animation.
  stickToBottom = true;
  scrollToBottom(true);
});
els.thinkingBlocks.addEventListener("click", () => {
  const bodies = thinkingBodies();
  if (bodies.length === 0) return;
  const expand = bodies.some((body) => body.hidden);
  thinkingExpansionOverride = expand;
  for (const body of bodies) setThinkingBodyExpanded(body, expand);
  updateThinkingBlocksButton();
});
// A wheel-up gesture expresses intent before the browser emits its scroll
// event. Disable following immediately so an already scheduled render frame
// cannot pull the viewport back down and cause visible oscillation.
els.messages.addEventListener(
  "wheel",
  (event) => {
    if (event.deltaY < 0 && els.messages.scrollHeight > els.messages.clientHeight + 1) {
      cancelPendingFollow();
    }
  },
  { passive: true },
);
// Scrollbar drags and touch scrolling express user intent without a wheel
// event. Cancel a queued follow before their resulting scroll event arrives.
els.messages.addEventListener(
  "pointerdown",
  (event) => {
    const rect = els.messages.getBoundingClientRect();
    const onScrollbar = event.pointerType === "mouse" && event.clientX >= rect.right - 20;
    if (onScrollbar) cancelPendingFollow();
  },
  { passive: true },
);
els.messages.addEventListener("touchmove", cancelPendingFollow, { passive: true });
els.messages.addEventListener(
  "scroll",
  () => {
    const currentTop = els.messages.scrollTop;
    const dist = Math.max(
      0,
      els.messages.scrollHeight - currentTop - els.messages.clientHeight,
    );
    // A content mutation can emit a scroll event after scrollHeight grows but
    // before the queued alignment frame. Keep the captured follow intent in
    // that window; explicit wheel/scrollbar/touch gestures cancel it above.
    if (!followScrollPending && !forceScrollPending) {
      stickToBottom = dist <= SCROLL_RESUME_MARGIN;
    }
    els.scrollBottom.hidden =
      followScrollPending || forceScrollPending || dist < SCROLL_BTN_MARGIN;
  },
  { passive: true },
);
// Images loaded late grow the content after the initial render. The resize
// observer normally handles this; the load hook keeps an immediate fallback.
els.thread.addEventListener(
  "load",
  (event) => {
    if (event.target instanceof HTMLImageElement) scrollToBottom();
  },
  true,
);

// narrower window → native CSS ellipsis on the badge (no JS)

// Optional upstream issue reference for RPC features not exposed by pi core.
const PI_CORE_ISSUE_URL = "";

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
    if (ok) void startCompactionFromUi();
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
  // Compaction is a hard boundary for both normal thoughts and Agentic
  // thinking. Any later internal activity starts in a fresh block.
  breakInternalActivityChain();
  compacting = true;
  setComposerActivity("compaction_start");
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
  head.append(spinner, label, compactTimerEl);
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
  // Automatic compaction may continue the same outer agent run. Preserve
  // steering/STOP until agent_settled; an idle manual compact still unlocks.
  setComposerActivity("compaction_end");
  updateSendButton();
  updateSteerPlaceholder();
  updateThinkingStopBtn(false);
  els.ctxGauge.classList.remove("loading");
  void fetchSessionStats(); // the gauge updates (reset after compact)
}

// from the gauge/label click: shows the block and sends the compact RPC
// NOTE: no timeout (the compact can take tens of seconds); the outcome
// arrives from the compaction_end event (real outcome) or from the response
async function startCompactionFromUi(): Promise<void> {
  if (compacting) return;
  // clear_queue is authoritative: restore pi's pending messages before compact,
  // without maintaining a second queue in the webview.
  if (working) await dequeueSteering();
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
let agentRunActive = false;

function setComposerActivity(event: ComposerActivityEvent): void {
  const next = transitionComposerActivity(
    { agentActive: agentRunActive, working },
    event,
  );
  agentRunActive = next.agentActive;
  working = next.working;
}

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
// pi is the sole owner of delivery, ordering and queue modes.
let steeringMode: "one-at-a-time" | "all" = "one-at-a-time";
let followUpMode: "one-at-a-time" | "all" = "one-at-a-time";
let autoCompactionEnabled = true;
let thinkingLevel = "";
let currentModel: { provider?: string; name?: string; id?: string } | null = null;
let noModelsWarned = false;

function updateSendButton(): void {
  // Session loading is a full interaction lock, including keyboard input
  // beneath the fixed overlay. Model streaming alone still permits steering.
  const interactionLocked =
    statusState !== "open" || piRestarting || switchingSession || sessionLoading;
  els.send.innerHTML = sendIcon();
  els.send.title = working ? t("steerSendHint") : t("send");
  els.send.classList.toggle("working", working);
  els.send.disabled = interactionLocked;
  els.input.disabled = interactionLocked;
  els.sessionBtn.disabled = interactionLocked;
  if (interactionLocked && speechController?.active) speechController.stopSilently();
  renderSpeechButton();
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

// a sub-cent session must not read as "$0.00": extra precision below one cent
function formatCost(cost: number): string {
  if (cost >= 0.01) return cost.toFixed(2);
  if (cost >= 0.001) return cost.toFixed(3);
  return cost.toFixed(4);
}

function renderBalanceChip(): void {
  const chip = els.balanceChip;
  chip.textContent = "";
  const hasCost = sessionCost > 0;
  // providers without a balance endpoint (or with an unreachable one) have no
  // balance: the session cost still has to be visible on its own
  if (!creditText && !hasCost) {
    chip.hidden = true;
    chip.title = "";
    chip.className = "balance-chip";
    return;
  }
  chip.hidden = false;
  // session cost / balance: the COLOR lives ONLY on the balance, cost and
  // slash stay muted (and disappear together under 600px; a cost-only chip
  // keeps the cost, since there is no balance to fall back on)
  if (hasCost) {
    const cost = document.createElement("span");
    cost.className = "chip-cost";
    cost.textContent = `${creditCurrency}${formatCost(sessionCost)}`;
    chip.appendChild(cost);
    if (creditText) {
      const slash = document.createElement("span");
      slash.className = "chip-slash";
      slash.textContent = "/";
      chip.appendChild(slash);
    }
  }
  if (creditText) {
    const bal = document.createElement("span");
    bal.className = "chip-balance";
    bal.textContent = creditText;
    chip.appendChild(bal);
    chip.title = t("balanceTitle");
    chip.className = `balance-chip tone-${balanceTone(creditBalance)}`;
    return;
  }
  chip.title = t("sessionCostTitle");
  chip.className = "balance-chip cost-only";
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

/** last getTrust / applyTrustOption response: the dialog reads the prompt
 *  options and the parent folder a "trust parent" decision is saved to */
let trustState: TrustResult | null = null;

function renderTrust(res: TrustResult | null): void {
  trustState = res;
  // pi never prompts in RPC mode (--mode rpc): with no saved decision the
  // protected project resources are ignored, so the effective status is
  // always a boolean — there is no third "ask" level to show.
  const status: "trusted" | "untrusted" =
    res?.status === "trusted" ? "trusted" : "untrusted";
  const label = status === "trusted" ? t("trusted") : t("untrusted");
  // trusted → green shield, untrusted → yellow warning
  const kind: TrustIconKind = status === "trusted" ? "shield" : "warn-outline";
  els.trustIcon.innerHTML = trustIcon(kind);
  els.trustLabel.textContent = label;
  els.trust.dataset.status = status;
  // A pending change keeps the status of the RUNNING process; the red "!"
  // after the icon means a restart is required to apply the new setting.
  els.trustBadge.hidden = res?.pendingRestart !== true;
  const notes: string[] = [];
  if (res?.sessionOnly) notes.push(t("trustSessionOnly"));
  if (res?.pendingRestart) notes.push(t("trustRestartHint"));
  els.trust.title = notes.length ? `${label} — ${notes.join(" · ")}` : label;
}

async function refreshTrust(): Promise<void> {
  const res = await ideRequest({ type: "getTrust" });
  if (res?.ok) renderTrust(res.data as TrustResult | null);
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
  color = "",
): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pop-item";
  btn.classList.toggle("active", active);
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
  m.textContent = meta;
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

/**
 * First run without any provider: the TUI prints "No models available. Use
 * /login …", but that warning never reaches RPC mode. The webview must show
 * the same guidance instead of a silent "unknown" model.
 */
async function warnWhenNoModelsAvailable(): Promise<void> {
  const res = await rpcRequest(rpc.getAvailableModels()).catch(() => null);
  if (!res?.success) return; // pi not reachable: no false warning
  const models = (res.data as { models?: unknown[] } | undefined)?.models ?? [];
  if (models.length > 0) {
    noModelsWarned = false;
    return;
  }
  if (noModelsWarned) return;
  noModelsWarned = true;
  addSystemBox("warn", t("noModelsAvailable"));
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
              void syncThinkingLevelWithModel(); // clamp to the new model's levels
            }
          });
        });
      }
      if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "pop-empty";
        // no provider at all (first run) vs no search result
        empty.textContent = models.length === 0 ? t("noModelsAvailable") : "—";
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

/** Mirrors the thinking level pi actually applied (pi clamps it to the levels
 *  supported by the active model on every model switch). */
function applyThinkingLevel(level: unknown): void {
  thinkingLevel = typeof level === "string" ? level : "";
  renderThinkingInfo();
}

/** Safety net after a model switch: pi emits `thinking_level_changed` when the
 *  clamped level differs, and this keeps the UI correct even without it. */
async function syncThinkingLevelWithModel(): Promise<void> {
  const res = await rpcRequest(rpc.getAvailableThinkingLevels()).catch(() => null);
  const levels = (res?.data as { levels?: string[] } | undefined)?.levels;
  if (!Array.isArray(levels)) return;
  const next = clampThinkingLevel(thinkingLevel, levels);
  if (next === thinkingLevel) return;
  if (!next) {
    applyThinkingLevel("");
    return;
  }
  const r = await rpcRequest(rpc.setThinkingLevel(next)).catch(() => null);
  if (r?.success) applyThinkingLevel(next);
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
        thinkingColor(lvl), // level color in the dropdown
      );
    }
  });
}

// --- project trust dialog (pi TUI prompt, mouse-driven) ----------------------

/** Labels of the pi trust prompt options (pi core trust-manager, same order). */
function trustOptionLabel(id: TrustOptionId): string {
  switch (id) {
    case "trust":
      return t("trustOptionTrust");
    case "trust-parent":
      return tpl(t("trustOptionTrustParent"), { path: trustState?.parentPath ?? "" });
    case "trust-session":
      return t("trustOptionTrustSession");
    case "untrust":
      return t("trustOptionUntrust");
    default:
      return t("trustOptionUntrustSession");
  }
}

/** Modal with explicit choices: Esc / outside click → null. */
function showModalChoice(
  message: string,
  buttons: Array<{ label: string; value: string; primary?: boolean }>,
): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const { row: lead } = buildWarningModalLead(message);
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const close = (value: string | null): void => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(value);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(null);
    };
    for (const button of buttons) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = button.primary ? "btn primary" : "btn";
      btn.textContent = button.label;
      btn.addEventListener("click", () => close(button.value));
      actions.appendChild(btn);
    }
    card.append(lead, actions);
    backdrop.appendChild(card);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(null);
    });
    document.addEventListener("keydown", esc);
    document.body.appendChild(backdrop);
    actions.querySelector<HTMLButtonElement>("button")?.focus();
  });
}

// Same options as the pi TUI prompt (Trust / Trust parent folder / Trust this
// session only / Do not trust / Do not trust this session only): the choice is
// saved to ~/.pi/agent/trust.json, the session-only ones only arm the per-run
// `--approve` / `--no-approve` flags.
function openTrustDialog(): void {
  if (demoMode) return;
  const options = trustState?.options ?? [];
  // a host without the prompt options (older companion) must not open an
  // empty dialog
  if (options.length === 0) {
    addStatusLine(t("trustApplyFailed"));
    return;
  }
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const card = document.createElement("div");
  card.className = "modal";
  const { row: lead } = buildWarningModalLead(t("trustDialogDesc"));
  const list = document.createElement("div");
  list.className = "modal-select";
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn";
  cancel.textContent = t("cancel");
  actions.appendChild(cancel);
  const close = (): void => {
    backdrop.remove();
    document.removeEventListener("keydown", esc);
  };
  const esc = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  for (const option of options) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "modal-option";
    row.textContent = trustOptionLabel(option.id);
    row.addEventListener("click", () => {
      close();
      void applyTrustChoice(option.id);
    });
    list.appendChild(row);
  }
  card.append(lead, list, actions);
  backdrop.appendChild(card);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  cancel.addEventListener("click", close);
  document.addEventListener("keydown", esc);
  document.body.appendChild(backdrop);
  list.querySelector<HTMLButtonElement>("button")?.focus();
}

/** Saves the chosen option. The new setting is applied by a pi restart: with
 *  an idle session the restart is automatic, while a running turn asks first
 *  (restart now / restart later). */
async function applyTrustChoice(id: TrustOptionId): Promise<void> {
  const res = await ideRequest({ type: "applyTrustOption", option: id });
  if (!res?.ok) {
    addStatusLine(res?.error ?? t("trustApplyFailed"));
    return;
  }
  const data = (res.data ?? null) as TrustResult | null;
  if (data?.pendingRestart !== true) {
    renderTrust(data);
    return;
  }
  if (!working && !compacting) {
    await restartSessionForTrust(data);
    return;
  }
  const choice = await showModalChoice(t("trustRestartBusy"), [
    { label: t("trustRestartNow"), value: "now", primary: true },
    { label: t("trustRestartLater"), value: "later" },
  ]);
  if (choice === "now") {
    await restartSessionForTrust(data);
    return;
  }
  // keep the previous status + red "!" until the user restarts the session
  renderTrust(data);
}

/** Restart pi so it reloads the project resources with the new trust setting
 *  (transparent: connection_closed restart + pi_restarted → re-init, which
 *  also re-reads the trust state and clears the pending marker). */
async function restartSessionForTrust(data: TrustResult | null): Promise<void> {
  renderTrust(data);
  if (working) await stopWorking(); // interrupt the running turn, like STOP
  await ideRequest({ type: "restartPi" });
}

// --- confirmation modal (same behavior in browser and VS Code webview) -------

// Shared image renderer for user, assistant and tool-result content. Image
// bytes stay in data URLs and are never folded into visible/copyable text.
function appendChatImages(
  container: HTMLElement,
  images: ImageContent[],
  className?: string,
): HTMLElement | null {
  if (images.length === 0) return null;
  const grid = document.createElement("div");
  grid.className = "chat-image-grid";
  if (className) grid.classList.add(className);
  if (images.length === 1) grid.classList.add("single");
  images.forEach((image, index) => {
    const number = String(index + 1);
    const label = tpl(t("chatImageLabel"), { number });
    const src = imageDataUrl(image);
    const img = document.createElement("img");
    img.className = "chat-image";
    img.src = src;
    img.alt = label;
    img.title = label;
    img.addEventListener("click", () =>
      openImageLightbox(src, label, imageDownloadName(image, index)),
    );
    grid.appendChild(img);
  });
  container.appendChild(grid);
  return grid;
}

function appendPresentedCode(container: HTMLElement, text: string, label: string): void {
  const block = document.createElement("div");
  block.className = "code-block presented-output-code";
  const header = document.createElement("div");
  header.className = "code-header";
  const title = document.createElement("span");
  title.className = "code-label";
  title.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = text;
  header.appendChild(title);
  addCopyButton(header, text);
  block.append(header, pre);
  container.appendChild(block);
}

function appendPresentedFile(
  container: HTMLElement,
  item: Extract<PresentedContentItem, { kind: "file" }>,
): void {
  const row = document.createElement("div");
  row.className = "presented-output-file";
  const icon = document.createElement("span");
  icon.className = "chat-file-icon";
  icon.innerHTML = attachFileIcon();
  const name = document.createElement("span");
  name.className = "chat-file-name";
  name.textContent = item.name;
  name.title = item.path ?? item.name;
  row.append(icon, name);
  if (item.path) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "btn presented-output-action";
    open.textContent = t("openFile");
    open.addEventListener("click", async () => {
      const result = await ideRequest({ type: "openFile", path: item.path! });
      if (!result?.ok) {
        addSystemBox("error", tpl(t("openFileFailed"), { error: result?.error ?? "?" }));
      }
    });
    row.appendChild(open);
  }
  if (item.data) {
    const download = document.createElement("a");
    download.className = "btn presented-output-action";
    download.href = `data:${item.mimeType ?? "application/octet-stream"};base64,${item.data}`;
    download.download = item.name;
    download.textContent = t("downloadFile");
    row.appendChild(download);
  }
  container.appendChild(row);
  if (item.text) appendPresentedCode(container, item.text, item.mimeType ?? item.name);
}

function appendPresentedItem(container: HTMLElement, item: PresentedContentItem): void {
  if (item.kind === "text") {
    if (item.format === "plain") {
      const text = document.createElement("div");
      text.className = "presented-output-text";
      text.textContent = item.text;
      container.appendChild(text);
    } else {
      appendPresentedCode(
        container,
        item.text,
        item.language ?? (item.format === "json" ? "json" : t("code")),
      );
    }
    return;
  }
  if (item.kind === "file") {
    appendPresentedFile(container, item);
    return;
  }
  if (item.kind === "media") {
    const media =
      item.mediaType === "audio"
        ? document.createElement("audio")
        : document.createElement("video");
    media.className = "presented-output-media";
    media.controls = true;
    media.src = `data:${item.mimeType};base64,${item.data}`;
    media.title = item.name ?? item.mimeType;
    container.appendChild(media);
    const download = document.createElement("a");
    download.className = "btn presented-output-action";
    download.href = media.src;
    download.download = item.name ?? `pi-webview-${item.mediaType}`;
    download.textContent = t("downloadFile");
    container.appendChild(download);
    return;
  }
  if (item.kind === "link") {
    if (/^https?:\/\//i.test(item.uri)) {
      const link = document.createElement("a");
      link.className = "presented-output-link";
      link.href = item.uri;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.name ?? item.uri;
      container.appendChild(link);
    } else {
      const text = document.createElement("div");
      text.className = "presented-output-text";
      text.textContent = item.name ? `${item.name}: ${item.uri}` : item.uri;
      container.appendChild(text);
    }
  }
}

function buildPresentedToolOutput(output: PendingToolOutput): HTMLElement {
  const section = document.createElement("section");
  section.className = "presented-tool-output";
  if (output.isError) section.classList.add("error");
  const source = document.createElement("div");
  source.className = "presented-tool-source";
  source.textContent = tpl(t("toolResultFrom"), { tool: output.toolName });
  section.appendChild(source);
  const images = output.content.items.flatMap((item) =>
    item.kind === "image" ? [item.image] : [],
  );
  for (const item of output.content.items) {
    if (item.kind !== "image") appendPresentedItem(section, item);
  }
  appendChatImages(section, images);
  return section;
}

// Lightbox shared by sent and received images. Clicking outside or pressing
// Escape closes it; the localized action downloads the original image bytes.
function openImageLightbox(src: string, name: string, downloadName: string): void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const content = document.createElement("div");
  content.className = "lightbox-content";
  const img = document.createElement("img");
  img.className = "lightbox-img";
  img.src = src;
  img.alt = name;
  const download = document.createElement("a");
  download.className = "btn lightbox-download";
  download.href = src;
  download.download = downloadName;
  download.textContent = t("downloadImage");
  content.append(img, download);
  backdrop.appendChild(content);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", esc);
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", esc);
  document.body.appendChild(backdrop);
}

function showConfirm(
  message: string,
  ansiValue?: string,
  onConfirm?: () => void,
  aboveBootLoader = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.classList.toggle("above-boot-loader", aboveBootLoader);
    const card = document.createElement("div");
    card.className = "modal";
    const { row: lead, copy } = buildWarningModalLead(message);
    if (ansiValue !== undefined) {
      const value = document.createElement("div");
      value.className = "modal-status-value";
      value.innerHTML = renderAnsiToHtml(ansiValue);
      value.title = stripAnsi(ansiValue);
      copy.appendChild(value);
    }
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
    card.append(lead, actions);
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
    ok.addEventListener("click", () => {
      onConfirm?.();
      close(true);
    });
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", esc);
    ok.focus();
  });
}

function showBrowserPermissionDialog(
  message: string,
  preview?: string,
): Promise<BrowserPermissionScope | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal browser-permission-modal";
    const { row: lead, copy } = buildWarningModalLead(message);
    if (preview) {
      const value = document.createElement("div");
      value.className = "browser-permission-preview";
      value.textContent = preview;
      copy.appendChild(value);
    }
    const actions = document.createElement("div");
    actions.className = "modal-actions browser-permission-actions";
    const session = document.createElement("button");
    session.type = "button";
    session.className = "btn accent";
    session.textContent = t("browserPermissionAllowSession");
    const site = document.createElement("button");
    site.type = "button";
    site.className = "btn";
    site.textContent = t("browserPermissionAllowSite");
    const global = document.createElement("button");
    global.type = "button";
    global.className = "btn danger";
    global.textContent = t("browserPermissionAllowGlobal");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = t("cancel");
    actions.append(session, site, global, cancel);
    card.append(lead, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    const close = (scope: BrowserPermissionScope | null) => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(scope);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };
    session.addEventListener("click", () => close("session"));
    site.addEventListener("click", () => close("site"));
    global.addEventListener("click", () => close("global"));
    cancel.addEventListener("click", () => close(null));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener("keydown", esc);
    session.focus();
  });
}

function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal";
    const { row: lead } = buildWarningModalLead(message);
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn primary";
    ok.textContent = t("ok");
    actions.appendChild(ok);
    card.append(lead, actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    const close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve();
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") close();
    };
    ok.addEventListener("click", close);
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
  // the option list is host-provided (same list as the pi TUI prompt): refresh
  // before opening so the dialog reflects the current workspace
  void refreshTrust().then(() => openTrustDialog());
});

/** Render a user message exclusively from pi's authoritative content. */
function renderUserContent(content: unknown): void {
  const rawText = stripEditorSelectionContext(extractTextContent(content));
  const filePaths: string[] = [];
  const textBlocks = rawText.split("\n\n").filter((block) => {
    const match = /^\[attachment: (.+)\]$/.exec(block);
    if (!match?.[1]) return true;
    filePaths.push(match[1]);
    return false;
  });
  const text = textBlocks.join("\n\n").trim();
  const images = imageContentBlocks(content);
  if (!text && filePaths.length === 0 && images.length === 0) return;

  const wrapper = addMsg("user");
  appendChatImages(wrapper, images);
  for (const path of filePaths) {
    const chip = document.createElement("div");
    chip.className = "chat-file";
    const icon = document.createElement("span");
    icon.className = "chat-file-icon";
    icon.innerHTML = attachFileIcon();
    const name = document.createElement("span");
    name.className = "chat-file-name";
    name.textContent = path.split(/[\\/]/).pop() ?? path;
    name.title = path;
    chip.append(icon, name);
    wrapper.appendChild(chip);
  }
  if (text) {
    const bubble = document.createElement("div");
    bubble.className = "bubble user";
    bubble.textContent = text;
    wrapper.appendChild(bubble);
  }
  scrollToBottom(true);
}

function renderUserMessageStart(evt: RpcEvent): void {
  const content = (evt as { message?: { content?: unknown } }).message?.content;
  sessionHasMessages = true;
  renderUserContent(content);
}

// Built-in pi TUI commands with NO piw counterpart: pi in RPC mode does not
// execute them (the text would leak to the model), so the webview must not
// send them as prompts or queue them in steering: only an informative line
// in the chat (they work from the terminal).
const TERMINAL_ONLY_COMMANDS = new Set([
  "reload",
  "login",
  "logout",
  "import",
  "share",
  "scoped-models",
  "changelog",
  "hotkeys",
  "quit",
  "model",
  "thinking",
]);

let slashCommandSubmissionPending = false;

/**
 * Sends a completed dictation segment through the same prompt/steering paths
 * as the composer without clearing a pre-existing manual draft or attachments.
 * Spoken slash-prefixed text remains an ordinary prompt, never a UI command.
 */
function submitSpeechText(rawText: string): boolean {
  if (
    !transport ||
    statusState !== "open" ||
    switchingSession ||
    sessionLoading ||
    piRestarting
  ) {
    return false;
  }
  const text = rawText.trim();
  if (!text) return false;
  const message = attachVisibleContext(text);
  sessionHasMessages = true;
  pushMessageHistory(text);
  if (working || compacting) {
    const command = compacting
      ? rpc.steer(message)
      : rpc.prompt(message, { streamingBehavior: "steer" });
    void rpcRequest(command).then(
      (response) => {
        if (!response.success) addStatusLine(t("steerSendFailed"));
      },
      () => addStatusLine(t("steerSendFailed")),
    );
  } else {
    transport.send({ channel: "rpc", payload: rpc.prompt(message) });
  }
  scrollToBottom(true);
  return true;
}

async function sendOrStop(): Promise<void> {
  if (!transport || switchingSession || sessionLoading || piRestarting) return;
  // /settings is the same special case as pi.dev TUI: opens the panel
  // instead of sending the text to the model
  if (els.input.value.trim().toLowerCase() === "/settings") {
    if (els.settingsModal.hidden) openSettings();
    return;
  }
  // Built-in pi TUI commands: the ones with a native UI action repeat that
  // action (same code path as the GUI button); the terminal-only ones get
  // the informative line above and are never sent to pi.
  const commandName = slashCommandName(els.input.value);
  if (commandName) {
    if (TERMINAL_ONLY_COMMANDS.has(commandName)) {
      appendSystemBox("warn", t("terminalOnlyCommands"));
      return;
    }
    if (commandName === "compact") {
      // same action as the compact UI button (context gauge)
      els.input.value = "";
      resetSlashComposerState();
      resetInputHeight();
      void startCompactionFromUi();
      return;
    }
    if (commandName === "new") {
      // same action as the "new session" button in the session box
      els.input.value = "";
      resetSlashComposerState();
      resetInputHeight();
      void startNewSession();
      return;
    }
    if (commandName === "name") {
      // same action as the rename in the session box (current session)
      const name = els.input.value.trim().slice("/name".length).trim();
      if (!name) {
        appendSystemBox("warn", t("nameUsage"));
        return;
      }
      els.input.value = "";
      resetSlashComposerState();
      resetInputHeight();
      void applyCurrentSessionName(name);
      return;
    }
  }
  let extensionCommand = isExtensionSlashCommand(els.input.value);
  if (commandName && !extensionCommand) {
    if (slashCommandSubmissionPending) return;
    slashCommandSubmissionPending = true;
    const submittedText = els.input.value;
    let commandListAvailable = false;
    try {
      commandListAvailable = await fetchSlashCommands();
    } finally {
      slashCommandSubmissionPending = false;
    }
    // Do not submit a command that the user changed while get_commands was in flight.
    if (els.input.value !== submittedText) return;
    extensionCommand = isExtensionSlashCommand(submittedText);
    // Fail closed: without pi's authoritative command list, a real extension
    // command could otherwise be mistaken for steering and leak to the model.
    if (
      shouldBlockUnverifiedSlashCommand({
        commandName,
        isExtensionCommand: extensionCommand,
        commandListAvailable,
      })
    ) {
      appendSystemBox("warn", t("extensionCommandsUnavailable"));
      return;
    }
  }
  // Extension commands always go through prompt so pi can execute them
  // immediately. Every other message submitted while busy is handed to pi's
  // native steering queue right now; the webview never delays delivery.
  if ((working || compacting) && !extensionCommand) {
    submitSteering();
    return;
  }
  const text = els.input.value.trim();
  if (!text && attachments.length === 0) return;
  // Mark a real prompt immediately instead of waiting for the session list to
  // be refreshed. This prevents an in-flight first message from making the
  // current session look empty during a workspace change. Extension commands
  // do not become conversation messages by themselves.
  if (!extensionCommand) sessionHasMessages = true;
  if (text) pushMessageHistory(text);
  const imageAtts = modelSupportsVision
    ? attachments.filter((a) => a.mimeType.startsWith("image/") && a.dataBase64)
    : [];
  const fileAtts = attachments.filter((a) => !imageAtts.includes(a));
  const inlineImages = imageAtts.map((a) => ({
    type: "image" as const,
    data: a.dataBase64!,
    mimeType: a.mimeType,
  }));
  const fileMentions = fileAtts.map((a) => `[attachment: ${a.path}]`);
  const visibleMessage = [text, ...fileMentions].filter(Boolean).join("\n\n");
  // pi recognizes extension commands from their command text. Appending the
  // editor-selection transport block makes a valid command a normal model
  // prompt, so commands must be sent without implicit editor context.
  const message = shouldAttachImplicitEditorContext(extensionCommand)
    ? attachVisibleContext(visibleMessage)
    : visibleMessage;
  // Direct prompts are rendered from pi's message_start event, not
  // optimistically. Extension commands do not emit a user message, so keep
  // their invocation visible without creating a queue or delivery tracker.
  if (extensionCommand) {
    renderUserContent([{ type: "text", text: message }, ...inlineImages]);
  }
  transport.send({
    channel: "rpc",
    payload: rpc.prompt(
      message,
      inlineImages.length > 0 ? { images: inlineImages } : undefined,
    ),
  });
  // turn_start will arm the provider wait at the authoritative boundary.
  // Advertised extension commands are handled immediately by pi, even while
  // busy; unmatched slash-prefixed text remains an ordinary prompt.
  // message_start renders accepted user prompts at the authoritative boundary.
  scrollToBottom(true);
  els.input.value = "";
  resetSlashComposerState();
  resetInputHeight();
  clearAttachments();
  els.input.focus();
}

// --- steering: pi-owned queue + read-only panel (plan 0004) -----------------

// Enter while busy sends to pi immediately. prompt(streamingBehavior: "steer")
// matches the TUI path while streaming; during compaction the dedicated steer
// RPC hands the message straight to the same native queue without a webview wait.
// Pi's queue protocol currently exposes text only. This sidecar retains attachment
// bytes while queue_update remains the authority for membership and ordering.
const steeringAttachments = new SteeringAttachmentTracker<PendingAttachment>();
let nativeFollowUpQueue: string[] = [];

function submitSteering(): void {
  const text = els.input.value.trim();
  const imageAtts = modelSupportsVision
    ? attachments.filter((a) => a.mimeType.startsWith("image/") && a.dataBase64)
    : [];
  const fileAtts = attachments.filter((a) => !imageAtts.includes(a));
  const visibleMessage = [text, ...fileAtts.map((a) => `[attachment: ${a.path}]`)]
    .filter(Boolean)
    .join("\n\n");
  if (!visibleMessage && imageAtts.length === 0) return;
  const message = attachVisibleContext(visibleMessage);
  const images = imageAtts.map((a) => ({
    type: "image" as const,
    data: a.dataBase64!,
    mimeType: a.mimeType,
  }));
  sessionHasMessages = true;
  if (text) pushMessageHistory(text);
  const command = compacting
    ? rpc.steer(message, images.length > 0 ? images : undefined)
    : rpc.prompt(message, {
        ...(images.length > 0 ? { images } : {}),
        streamingBehavior: "steer",
      });
  const ticket = steeringAttachments.stage(message, attachments);
  void rpcRequest(command).then(
    (response) => {
      steeringAttachments.settle(ticket);
      if (!response.success) addStatusLine(t("steerSendFailed"));
    },
    () => {
      steeringAttachments.settle(ticket);
      addStatusLine(t("steerSendFailed"));
    },
  );
  els.input.value = "";
  resetInputHeight();
  clearAttachments();
  els.input.focus();
}

function renderNativeQueues(
  steering: QueuedAttachmentEntry<PendingAttachment>[],
  followUp: string[],
): void {
  renderSteerPanel([
    ...steering,
    ...followUp.map((message) => ({ message, attachments: [] })),
  ]);
}

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

// queue_update is the sole source for this panel. Repeated equal messages are
// intentionally rendered as separate rows in the exact order provided by pi.
function renderSteerPanel(queued: QueuedAttachmentEntry<PendingAttachment>[]): void {
  const panel = els.steerPanel;
  const wasHidden = panel.hidden;
  panel.textContent = "";
  if (queued.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  if (wasHidden) scrollToBottom(true);
  const head = document.createElement("div");
  head.className = "steer-head";
  const title = document.createElement("span");
  title.className = "steer-title";
  title.textContent = tpl(t("steerQueueCount"), { n: String(queued.length) });
  head.appendChild(title);
  const dequeue = document.createElement("button");
  dequeue.type = "button";
  dequeue.className = "steer-dequeue";
  dequeue.textContent = t("steerDequeue");
  dequeue.title = t("steerDequeueHint");
  dequeue.addEventListener("click", () => void dequeueSteering());
  head.appendChild(dequeue);
  panel.appendChild(head);
  for (const entry of queued) appendSteerRow(panel, entry);
}

function appendSteerRow(
  panel: HTMLElement,
  entry: QueuedAttachmentEntry<PendingAttachment>,
): void {
  const text = stripEditorSelectionContext(entry.message);
  const row = document.createElement("div");
  row.className = "steer-row";
  const label = document.createElement("span");
  label.className = "steer-text";
  label.textContent = text;
  label.title = text;
  row.appendChild(label);
  for (const attachment of entry.attachments) {
    const chip = document.createElement("span");
    chip.className = "steer-attachment";
    const icon = document.createElement("span");
    icon.className = "steer-attachment-icon";
    icon.innerHTML = attachFileIcon();
    const name = document.createElement("span");
    name.textContent = attachment.name;
    name.title = attachment.path;
    chip.append(icon, name);
    row.appendChild(chip);
  }
  panel.appendChild(row);
}

// pi returns and clears both native queues. No local queue is mutated or
// retried: queue_update remains authoritative for the visible state.
async function dequeueSteering(): Promise<void> {
  const attachmentSnapshot = steeringAttachments.snapshot();
  try {
    const response = await rpcRequest(rpc.clearQueue());
    if (!response.success) {
      addStatusLine(t("steerDequeueFailed"));
      return;
    }
    const data = response.data as { steering?: unknown; followUp?: unknown } | undefined;
    const steering = Array.isArray(data?.steering)
      ? data.steering.filter((message): message is string => typeof message === "string")
      : [];
    const followUp = Array.isArray(data?.followUp)
      ? data.followUp.filter((message): message is string => typeof message === "string")
      : [];
    const restoredSteering = pairQueuedAttachments(steering, attachmentSnapshot);
    const restored = [
      ...restoredSteering,
      ...followUp.map((message) => ({ message, attachments: [] as PendingAttachment[] })),
    ];
    const text = restored
      .map((entry) =>
        stripRestoredAttachmentMentions(
          stripEditorSelectionContext(entry.message),
          entry.attachments,
        ),
      )
      .filter(Boolean)
      .join("\n\n");
    const restoredAttachments = restored.flatMap((entry) => entry.attachments);
    if (!text && restoredAttachments.length === 0) return;
    const current = els.input.value;
    els.input.value = current.trim() && text ? `${text}\n\n${current}` : text || current;
    attachments.push(...restoredAttachments);
    renderAttachments();
    autogrowInput();
    els.input.focus();
  } catch {
    addStatusLine(t("steerDequeueFailed"));
  }
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
  if (last.classList.contains("thinking-card")) return true;
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
let slashCommands: SlashCommand[] = [];
let cmdOpen = false;
let cmdSelected = 0;
let cmdMatches: SlashCommand[] = [];
let slashInputActive = false;
let cmdUpdateSeq = 0;

function isExtensionSlashCommand(input: string): boolean {
  return isKnownSlashCommand(input, slashCommands);
}

// Extension commands can be registered after the initial page load. Coalesce
// concurrent lookups, but allow every new slash-input sequence to refresh the
// complete authoritative list before the palette or submit path relies on it.
let slashCommandsFetch: Promise<boolean> | null = null;
async function fetchSlashCommands(): Promise<boolean> {
  if (slashCommandsFetch) return slashCommandsFetch;
  slashCommandsFetch = (async () => {
    try {
      const res = await rpcRequest(rpc.getCommands(), `cmds-${++cmdSeq}`, 8000);
      const cmds = (
        res.data as
          | {
              commands?: Array<{
                name?: string;
                description?: string;
                source?: string;
              }>;
            }
          | undefined
      )?.commands;
      if (!res.success || !Array.isArray(cmds)) return false;
      slashCommands = normalizeExtensionCommands(cmds);
      return true;
    } catch {
      // Keep the last successful list. Text that does not match a registered
      // command continues through the normal prompt path.
      return false;
    }
  })();
  try {
    return await slashCommandsFetch;
  } finally {
    slashCommandsFetch = null;
  }
}
let cmdSeq = 0;

// closes the dropdown (without touching the text)
function closeCmdDropdown(): void {
  cmdOpen = false;
  els.cmdDropdown.hidden = true;
}

function resetSlashComposerState(): void {
  slashInputActive = false;
  cmdUpdateSeq += 1;
  closeCmdDropdown();
}

// filtering + render: the command is the first token (before the space); if
// the user is already typing arguments (space) the command is chosen → closed
function updateCmdDropdown(): void {
  const raw = els.input.value;
  const updateSeq = ++cmdUpdateSeq;
  if (!raw.startsWith("/")) {
    slashInputActive = false;
    closeCmdDropdown();
    return;
  }
  const enteringSlashInput = !slashInputActive;
  slashInputActive = true;
  const firstSpace = raw.indexOf(" ");
  if (firstSpace !== -1) {
    closeCmdDropdown(); // args in progress: the extension handles the rest
    return;
  }
  const q = raw.slice(1).toLowerCase();
  void (async () => {
    if (enteringSlashInput || slashCommands.length === 0) {
      await fetchSlashCommands();
    }
    // Ignore a slower lookup started for an older composer value.
    if (updateSeq !== cmdUpdateSeq || els.input.value !== raw) return;
    const matches = slashCommands.filter((c) =>
      !q ? true : c.name.toLowerCase().includes(q),
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
    await fetchSlashCommands();
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
      const matches = slashCommands.filter((c) => !q || c.name.toLowerCase().includes(q));
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
        row.dataset.name = c.name;
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
        const name = rows[sel]?.dataset.name;
        if (name) close(`/${name}`);
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

async function handlePastedFile(file: File): Promise<boolean> {
  const isImage = file.type.startsWith("image/");
  let base64 = "";
  let mimeType = file.type;
  try {
    const compressed = await compressImage(file);
    base64 = compressed.base64;
    mimeType = compressed.mimeType;
  } catch {
    // unreadable File (sandboxed VS Code webview): visible feedback instead
    // of a silent no-op — the drop falls back to URIs only when no File
    // objects were handed over at all
    addStatusLine(tpl(t("dropFailed"), { name: file.name || "?" }));
    return false;
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
    return true;
  }
  return false;
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
  const types = Array.from(e.dataTransfer?.types ?? []);
  // "Files" = real files (OS file manager / browser). VS Code-internal drags
  // (file explorer, editor tabs) arrive as text/uri-list with vscode-file://
  // URIs instead — treated as files too.
  return (
    types.includes("Files") || types.some((t) => t.toLowerCase() === "text/uri-list")
  );
}

/** vscode-file:///home/u/f.txt → /home/u/f.txt; Windows /c:/Users/… → c:/Users/… */
function uriPathFromDrop(uri: string): string | undefined {
  const m = uri.match(/^vscode-file:\/\/(.+)$/i) ?? uri.match(/^file:\/\/(.+)$/i);
  if (!m) return undefined;
  const p = decodeURIComponent(m[1]!);
  return p.replace(/^\/([a-zA-Z]:[\\/].*)$/, "$1");
}

/** IDE-internal dropped file: the host adapter reads it from disk. */
async function attachPathFromDrop(path: string): Promise<void> {
  const res = await ideRequest({ type: "attachPath", path });
  const data = res?.ok
    ? (res.data as
        | { path?: string; name?: string; mimeType?: string; dataBase64?: string }
        | undefined)
    : undefined;
  if (!data?.path || !data.name) {
    addStatusLine(tpl(t("dropFailed"), { name: path.split(/[\\/]/).pop() ?? path }));
    return;
  }
  addAttachment({
    path: data.path,
    name: data.name,
    mimeType: data.mimeType ?? "application/octet-stream",
    dataBase64: data.dataBase64,
  });
}

function hideDropOverlay(): void {
  if (dragDepth <= 0) els.dropOverlay.hidden = true;
}

// drag & drop handlers on `window` (CAPTURE phase). NOTE: inside the VS Code
// webview these events NEVER fire for file drags — the workbench intercepts
// drag & drop before it reaches the webview iframe (microsoft/vscode#139111,
// #182449): file drag & drop works only in the standalone browser. In the IDE
// the reliable path is the 📎 attach button (pickFile → showOpenDialog).
window.addEventListener(
  "dragenter",
  (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    els.dropOverlay.hidden = false;
  },
  true,
);

window.addEventListener(
  "dragover",
  (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  },
  true,
);

window.addEventListener(
  "dragleave",
  (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideDropOverlay();
  },
  true,
);

window.addEventListener(
  "drop",
  (e) => {
    dragDepth = 0;
    hideDropOverlay();
    if (!hasFiles(e)) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    const files = dt ? Array.from(dt.files ?? []) : [];
    let uris: string[] = [];
    if (dt) {
      try {
        // sandboxed webviews may throw on getData — never let the drop die
        uris = (dt.getData("text/uri-list") ?? "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
      } catch {
        uris = [];
      }
    }
    // VS Code sandbox: File objects from the OS drag are usually unreadable
    // (and internal explorer drags have no File objects at all) → prefer the
    // vscode-file:// URIs, read by the host adapter; real File objects are
    // the path in the standalone browser instead
    const useUris = runtime.isVsCode && uris.length > 0;
    if (files.length > 0 && !useUris) {
      for (const f of files) void handlePastedFile(f);
      return;
    }
    for (const uri of uris) {
      const path = uriPathFromDrop(uri);
      if (path) void attachPathFromDrop(path);
    }
  },
  true,
);

els.send.addEventListener("click", sendOrStop);
els.attachBtn.innerHTML = attachFileIcon(); // graffetta SVG del set icone (niente emoji)
els.browserFilePicker.addEventListener("change", () => {
  const files = Array.from(els.browserFilePicker.files ?? []);
  // Reset immediately so selecting the same file again still emits change.
  els.browserFilePicker.value = "";
  if (files.length === 0) return;
  void (async () => {
    els.attachBtn.disabled = true;
    try {
      // File objects come from the browser-side picker: their bytes are read
      // locally and uploaded through saveAttachment. No client path is sent.
      for (const file of files) await handlePastedFile(file);
    } finally {
      els.attachBtn.disabled = false;
    }
  })();
});
els.attachBtn.addEventListener("click", () => {
  if (els.attachBtn.disabled) return;
  if (!runtime.isVsCode) {
    // Standalone (including a browser on another machine) must browse the
    // browser device, never the bridge host filesystem.
    els.browserFilePicker.click();
    return;
  }
  void (async () => {
    els.attachBtn.disabled = true;
    try {
      const res = await ideRequest({ type: "pickFile" });
      const paths =
        res?.ok && Array.isArray((res.data as { paths?: string[] } | undefined)?.paths)
          ? (res.data as { paths: string[] }).paths
          : [];
      for (const p of paths) await attachPathFromDrop(p);
    } finally {
      els.attachBtn.disabled = false;
    }
  })();
});
// new chat in another panel: handled by the companion (only in the IDE;
// standalone the request falls into the void and the UI stays as is)
// new chat: in the IDE the companion handles it (new webview); standalone
// opens a NEW BROWSER TAB with a new session (plan 0005)
els.newChat.addEventListener("click", () => {
  if (runtime.isIDE) {
    void ideRequest({ type: "openNewChat" });
  } else {
    window.open(location.origin + "/?new=1", "_blank");
  }
});
// pi core / extensions update: the header shield is ALWAYS visible —
// blue = up-to-date (click runs the check NOW, live, no cache: pi-side
// `/piw update.check`, the webview polls the startup-info timestamp),
// yellow = update available (click opens a review dialog with the exact
// installed → cloud versions; confirming runs the update through the normal
// chat channel — extension command, pi executes it)
let updateInfo: UpdateAvailable | null = null;
let updateChecking = false;
let updateRunPending = false;
let updateAttemptInfo: UpdateAvailable | null = null;
let updateRestartRequired = false;
// true only while a MANUAL shield check is in flight (not while an update is
// running via proceedUpdate): the check-outcome notify is a completion signal
let manualCheckOutcomePending = false;

/** shield visual state: blue (up-to-date) / yellow (update available) /
 *  dimmed while work is in flight; after a successful update it stays blue
 *  and disabled until the required pi restart reloads this page. */
function applyUpdateShield(): void {
  const visual = updateShieldVisualState({
    checking: updateChecking,
    hasUpdate: updateInfo !== null,
    restartRequired: updateRestartRequired,
  });
  els.updatePi.disabled = visual.disabled;
  els.updatePi.classList.toggle("update-pi-ok", visual.tone === "ok");
  els.updatePi.classList.toggle("update-pi-warn", visual.tone === "warn");
  const tooltipKey =
    visual.tooltip === "restartRequired"
      ? "updateRestartRequiredTooltip"
      : visual.tooltip === "checking"
        ? "updateCheckingTooltip"
        : visual.tooltip === "available"
          ? "updateAvailableTooltip"
          : "updateUpToDateTooltip";
  els.updatePi.title = t(tooltipKey);
}

// true when the chat message is the outcome of the manual shield check
// (pi-webview extension ui.notify, rendered in every environment via
// extension_ui_request): up to date / updates available / check failed /
// already running
function isUpdateCheckOutcome(msg: string): boolean {
  return (
    msg.includes("pi-webview:") &&
    (/up to date/.test(msg) || /update check/.test(msg) || /updates? available/.test(msg))
  );
}

// the outcome box landed in the chat → the pi-side check has finished (the
// startup-info file is written BEFORE the notify). Settle the shield here:
// this path also works when the IDE host predates the startup-info
// updateCheckedAt field (new webview page + old in-memory host code, e.g.
// after a webview reload without a window reload) where the timestamp poll
// below can never match
async function finishManualUpdateCheckFromOutcome(): Promise<void> {
  if (!manualCheckOutcomePending) return; // poll (or an earlier notify) already settled
  manualCheckOutcomePending = false;
  updateChecking = false;
  // refresh from the freshest startup-info the host can serve; a host
  // without the field simply keeps the last known state
  const res = await ideRequest({ type: "getStartupInfo" });
  const info = res?.ok
    ? (res.data as { info?: StartupInfo | null } | undefined)?.info
    : undefined;
  if (info) updateInfo = info.updateAvailable ?? null;
  applyUpdateShield();
  // update found → the shield becomes the yellow one and the review dialog
  // opens, exactly as on a normal update-available click
  if (updateInfo) openUpdateModal();
}

// blue shield click: run the version check NOW via the extension command
// (pi-side, LIVE — no cache), then wait for the outcome: the timestamp poll
// (new hosts) settles it as soon as the pi process stamps a newer
// updateCheckedAt, and the outcome notify in the chat settles it in every
// environment (see isUpdateCheckOutcome / finishManualUpdateCheckFromOutcome)
async function runManualUpdateCheck(): Promise<void> {
  if (updateChecking || demoMode) return;
  updateChecking = true;
  manualCheckOutcomePending = true;
  applyUpdateShield();
  const startedAt = Date.now();
  els.input.value = "/piw update.check";
  sendOrStop();
  const deadline = startedAt + 5 * 60_000; // a few lookups; generous margin
  const poll = (): void => {
    void (async () => {
      // settled elsewhere (the outcome notify in the chat, or an earlier poll
      // tick): the check DID complete — stop silently, never time out
      if (!manualCheckOutcomePending) return;
      const res = await ideRequest({ type: "getStartupInfo" });
      const info = res?.ok
        ? (res.data as { info?: StartupInfo | null } | undefined)?.info
        : undefined;
      if (
        info &&
        typeof info.updateCheckedAt === "number" &&
        info.updateCheckedAt > startedAt
      ) {
        updateInfo = info.updateAvailable ?? null;
        updateChecking = false;
        manualCheckOutcomePending = false;
        applyUpdateShield();
        // update found → the shield becomes the yellow one and the review
        // dialog opens, exactly as on a normal update-available click
        if (updateInfo) openUpdateModal();
        return;
      }
      if (Date.now() > deadline) {
        updateChecking = false;
        manualCheckOutcomePending = false;
        applyUpdateShield();
        appendSystemBox("warn", t("updateCheckTimeout"));
        return;
      }
      setTimeout(poll, 1500);
    })();
  };
  // first poll only after the command has had time to reach pi
  setTimeout(poll, 2000);
}

function updateRow(name: string, current: string, latest: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "update-row";
  const nameEl = document.createElement("span");
  nameEl.className = "update-row-name";
  nameEl.textContent = name;
  const verEl = document.createElement("span");
  verEl.className = "update-row-versions";
  verEl.textContent = tpl(t("updateVersionRange"), { from: current, to: latest });
  row.append(nameEl, verEl);
  return row;
}

function openUpdateModal(): void {
  const ua = updateInfo;
  if (!ua || (!ua.core && ua.extensions.length === 0)) return;
  els.updateList.replaceChildren();
  if (ua.core) {
    els.updateList.append(
      updateRow(t("updateCoreName"), ua.core.current, ua.core.latest),
    );
  }
  for (const ext of ua.extensions) {
    els.updateList.append(updateRow(ext.name, ext.current, ext.latest));
  }
  els.updateModal.hidden = false;
}

function closeUpdateModal(): void {
  els.updateModal.hidden = true;
}

function finishUpdateRun(outcome: UpdateExecutionOutcome): void {
  updateRunPending = false;
  updateChecking = false;
  if (outcome === "success") {
    updateInfo = null;
    updateRestartRequired = true;
  } else {
    // Restore the yellow, clickable shield with the last reviewed update so
    // the user can retry immediately after resolving the reported failure.
    updateInfo = updateAttemptInfo;
    updateRestartRequired = false;
  }
  updateAttemptInfo = null;
  applyUpdateShield();
}

function proceedUpdate(): void {
  closeUpdateModal();
  // Keep the reviewed update available so a failed attempt can restore the
  // yellow clickable shield. A successful attempt settles it to disabled blue
  // until the required pi restart reloads the page.
  updateAttemptInfo = updateInfo;
  updateRunPending = true;
  updateRestartRequired = false;
  updateChecking = true;
  applyUpdateShield();
  els.input.value = "/piw update.pi.core.exts";
  sendOrStop();
}

els.updatePi.addEventListener("click", () => {
  if (demoMode || updateChecking) return;
  if (updateInfo) {
    openUpdateModal(); // yellow → review the available updates
    return;
  }
  void runManualUpdateCheck(); // blue → check for new releases NOW
});
els.updateClose.addEventListener("click", closeUpdateModal);
els.updateCancel.addEventListener("click", closeUpdateModal);
els.updateConfirm.addEventListener("click", proceedUpdate);
els.updateModal.addEventListener("click", (e) => {
  if (e.target === els.updateModal) closeUpdateModal();
});

// --- full reload: restart the pi process + reload the webview page -----------
let reloadInProgress = false;

els.reload.addEventListener("click", async () => {
  if (demoMode || reloadInProgress) return;
  // confirmation only when an operation is in progress (model turn or
  // compaction); otherwise the reload goes straight ahead, no dialog
  if (working || compacting) {
    const msg = usesWebSocketBridge
      ? t("reloadConfirmStandalone")
      : t("reloadConfirmIde");
    if (!(await showConfirm(msg))) return;
  }
  reloadInProgress = true;
  els.reload.disabled = true;
  if (usesWebSocketBridge) {
    // Restart is best-effort in the browser. Never await its response: when
    // the WebSocket is already closed (or dies after the click), ideRequest
    // would otherwise delay the local page reload until its 8s timeout.
    void ideRequest({ type: "restartPi" });
    // Give a connected bridge a short margin to restart pi. With an already
    // closed connection reload immediately so the page can reconnect.
    const delay = statusState === "open" ? 500 : 0;
    setTimeout(() => location.reload(), delay);
    return;
  }
  // restart the pi process (loads updated core/extensions): the webview gets
  // connection_closed(reason restart) + pi_restarted and re-initializes
  // transparently (same path as applying CLI flags)
  await ideRequest({ type: "restartPi" });
  // margin until the host re-spawned pi: the fresh page re-initializes from
  // scratch and retries get_state until pi is ready
  await new Promise((r) => setTimeout(r, 500));
  // IDE: the host re-serves the webview document. A client-side
  // location.reload() is not enough in VS Code: the host-provided HTML is
  // served once and the blank iframe never re-fetches it (the host
  // reassigns webview.html / re-navigates).
  const res = await ideRequest({ type: "reloadWebview" });
  if (!res?.ok) location.reload(); // legacy host: old best-effort path
  // the host swapped the document: this page is gone
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
        autogrowInput();
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
          e.key === "ArrowDown" ? (cmdSelected + 1) % n : (cmdSelected - 1 + n) % n;
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
    if (!switchingSession && !sessionLoading && !piRestarting) openCmdPalette();
  }
});

// the working state comes from the pi events
function trackWorking(evt: RpcEvent): void {
  if (evt.type === "agent_start") {
    setComposerActivity("agent_start");
    initialAgentWaitStartedAt = performance.now();
    armWaitingResponse(false, initialAgentWaitStartedAt);
    // an agent run is part of the extension work at resume: the loading
    // overlay must not end while it is active
    loadingAgentActive = true;
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(true);
  } else if (evt.type === "turn_start") {
    // A post-compaction continuation may emit turn_start without a second
    // agent_start. Restore steering and STOP at this authoritative boundary.
    setComposerActivity("turn_start");
    loadingAgentActive = true;
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(true);
    // The first request inherits the agent_start clock instead of resetting
    // it. Later retries/follow-up turns start a fresh one-second wait.
    const startedAt = initialAgentWaitStartedAt || performance.now();
    armWaitingResponse(false, startedAt);
    initialAgentWaitStartedAt = 0;
  } else if (evt.type === "agent_settled") {
    setComposerActivity("agent_settled");
    initialAgentWaitStartedAt = 0;
    loadingAgentActive = false;
    // extension run finished: re-evaluate the loading end (quiet + idle)
    if (sessionLoading) armLoadingQuiet();
    disarmWaitingResponse();
    // Tools aborted by STOP have no tool_execution_end: freeze their timers
    // and turn every still-running spinner into a visible failure.
    failRunningTools();
    interruptThinking();
    void fetchSessionStats(); // context/token updated at turn end
    void fetchBalance(); // the balance changes after the usage
    updateSendButton();
    updateSteerPlaceholder();
    updateThinkingStopBtn(false);
    // at turn end pi may have assigned a name to the session (auto-title)
    void refreshSessionTitle();
    // Queue delivery and any continuation are entirely owned by pi.
  }
}

els.connectBtn.addEventListener("click", () => {
  const url = els.connectUrl.value.trim();
  if (!url) return;
  if (runtime.isBrowserExtension) {
    void connectConfiguredBrowserServer(url);
  } else {
    void connect(url);
  }
});

// --- demo (dev): sample conversation, no connection ---------------------------

function renderDemo(): void {
  const user = addMsg("user");
  const ub = document.createElement("div");
  ub.className = "bubble user";
  ub.textContent = t("demoUser");
  user.appendChild(ub);

  const asst = addMsg("assistant");

  // Thinking precedes the text and follows pi's default visibility setting.
  const thought = document.createElement("div");
  thought.className = "thinking-card";
  const { head } = makeThinkingHead(false);
  const tb = document.createElement("div");
  tb.className = "thinking-content";
  bindThinkingBody(tb, () => t("demoThought"));
  activateThinkingCard(thought, tb);
  wireThinkingHead(head, tb);
  thought.append(head, tb);
  asst.appendChild(thought);
  updateThinkingBlocksButton();

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
  setToolExecutionStatus(tool, "success");
  asst.appendChild(tool);
}

// --- startup -----------------------------------------------------------------

// immediate theme/strings init (at module scope): in the VS Code webview
// without this the text would stay with the default color (black on the IDE bg)
applyTheme(themePref);
applyUiStrings();

async function boot(): Promise<void> {
  if (runtime.mode === "standalone") startBrowserCompanionDiscovery();
  if (runtime.isBrowserExtension) {
    document.documentElement.dataset.runtime = "browser-extension";
    browserPanelConnection = connectBrowserPanel((message) => {
      if (message.type === "browser_context_changed" && message.context) {
        renderIdeEvent({ type: "browser_context_changed", context: message.context });
      } else if (message.type === "browser_microphone_permission") {
        const granted = message.granted === true;
        setSpeechMicrophonePermission(granted ? "granted" : "denied");
        speechError = granted
          ? t("speechStatusChromePermissionGranted")
          : t("speechStatusChromePermissionDenied");
        renderSpeechSettings();
        renderSpeechButton();
      } else if (message.type === "browser_context_cleared") {
        renderIdeEvent({ type: "browser_context_cleared", reason: message.error });
      } else if (message.type === "browser_handoff_available") {
        location.reload();
      } else if (message.type === "browser_tool_result") {
        const result = (message as unknown as { result?: Record<string, unknown> })
          .result;
        if (result && typeof result.requestId === "string") {
          const requestId = result.requestId;
          const { requestId: _requestId, ...payload } = result;
          void ideRequest({
            type: "browserToolResponse",
            requestId,
            result: payload as unknown as BrowserToolPayload,
          });
        }
      }
    });
    els.connectUrl.value = await getBrowserServerUrl();
  }
  if (demoMode) {
    renderDemo();
    hideBootLoader();
  }
  // runtime mode: inside an IDE (e.g. VS Code webview) postMessage is used,
  // standalone the WebSocket bridge (src/web/environment.ts)
  if (runtime.isVsCode) {
    const vscode = createVsCodeTransport();
    if (vscode) {
      // onStatus() is synchronous for IDE transports; assign first so the
      // initial config/session requests are not sent while transport is null.
      transport = vscode;
      setupTransport(vscode);
      els.connectPanel.hidden = true;
      return;
    }
  }
  if (runtime.mode === "ide") {
    // WebView2 (adapter Visual Studio, concept 0005)
    const wv2 = createWebView2Transport();
    if (wv2) {
      // onStatus() is synchronous for IDE transports; assign first so the
      // initial config/session requests are not sent while transport is null.
      transport = wv2;
      setupTransport(wv2);
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
  els.connectPanel.hidden = runtime.isBrowserExtension;
  const errorBox = document.getElementById("connect-error");
  if (errorBox && runtime.isBrowserExtension) errorBox.textContent = "";
  hideBootLoader();
  if (runtime.isBrowserExtension) {
    await explainBrowserConnectionFailure(browserConnectionError);
  } else if (usesWebSocketBridge) {
    // standalone: without a resolvable bridge URL (bridge down, rotated token)
    // the dot alone would stay red forever, because the reconnect loop starts
    // only once a transport exists. Report the failure and keep retrying.
    appendSystemBox("error", t("bridgeUnreachable"));
    reconnect.start();
  } else {
    // pi is reachable: on a first run with no provider configured, explain
    // how to authenticate instead of leaving the model picker empty
    void warnWhenNoModelsAvailable();
  }
}

void boot().catch((error: unknown) => {
  if (runtime.isBrowserExtension && isBrowserExtensionContextInvalidated(error)) {
    location.reload();
    return;
  }
  statusState = "closed";
  updateStatus();
  hideBootLoader();
  if (runtime.isBrowserExtension) {
    void explainBrowserConnectionFailure(browserConnectionMessage(error));
  }
});
