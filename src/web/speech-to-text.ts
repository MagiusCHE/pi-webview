import type { SpeechInputMode, SpeechToTextShortcuts } from "../ide/speech-config.ts";

/**
 * Minimal local declarations for the experimental Web Speech recognition API.
 * TypeScript's DOM lib deliberately does not expose the complete API yet.
 */
export interface SpeechRecognitionAlternativeLike {
  transcript?: string;
}

export interface SpeechRecognitionResultLike {
  isFinal?: boolean;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
}

export interface SpeechRecognitionResultEventLike {
  results?: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
  available?: (options: SpeechRecognitionModelOptions) => Promise<unknown>;
  install?: (options: SpeechRecognitionModelOptions) => Promise<unknown>;
}

export interface SpeechRecognitionModelOptions {
  langs: string[];
  processLocally: boolean;
}

export interface SpeechRuntime {
  createRecognition(): SpeechRecognitionLike;
  available?: (options: SpeechRecognitionModelOptions) => Promise<unknown>;
  install?: (options: SpeechRecognitionModelOptions) => Promise<unknown>;
}

export type SpeechModelAvailability =
  "available" | "downloadable" | "downloading" | "unavailable" | "unknown";

/** Why the local model controls cannot offer a download in this runtime. */
export type SpeechModelControlState =
  | SpeechModelAvailability
  | "recognition-unavailable"
  | "local-recognition-unavailable"
  | "availability-unavailable"
  | "install-unavailable";

export type SpeechMicrophonePermission = "prompt" | "granted" | "denied" | "unknown";

export interface SpeechCapabilities {
  recognition: boolean;
  localRecognition: boolean;
  cloudRecognition: boolean;
  modelAvailability: boolean;
  modelInstall: boolean;
  /** Web Speech has no verified uninstall API. Keep this explicit. */
  modelRemoval: false;
  inputEnumeration: boolean;
  inputSelection: boolean;
  /** Whether the embedding document delegates microphone capture at all. */
  microphonePolicyAllowsCapture: boolean;
  /** Updated asynchronously without triggering a microphone prompt. */
  microphonePermission: SpeechMicrophonePermission;
}

interface BrowserSpeechGlobal {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  navigator?: {
    mediaDevices?: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">;
    permissions?: {
      query?: (descriptor: { name: string }) => Promise<{ state?: string }>;
    };
    language?: string;
    languages?: readonly string[];
  };
  document?: {
    permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
    /** Legacy name retained by Chromium-based embedded views. */
    featurePolicy?: { allowsFeature?: (feature: string) => boolean };
  };
}

function defaultGlobal(): BrowserSpeechGlobal {
  return globalThis as unknown as BrowserSpeechGlobal;
}

/** Returns the browser recognition constructor without starting microphone access. */
export function getSpeechRuntime(
  source: BrowserSpeechGlobal = defaultGlobal(),
): SpeechRuntime | null {
  const candidate = source.SpeechRecognition ?? source.webkitSpeechRecognition;
  if (typeof candidate !== "function") return null;
  const constructor = candidate as SpeechRecognitionConstructorLike;
  return {
    createRecognition: () => new constructor(),
    ...(typeof constructor.available === "function"
      ? { available: constructor.available.bind(constructor) }
      : {}),
    ...(typeof constructor.install === "function"
      ? { install: constructor.install.bind(constructor) }
      : {}),
  };
}

/**
 * Checks the embedding document's Permissions Policy without asking for a
 * microphone grant. VS Code extension Webviews, for example, can expose the
 * Web Speech objects while still forbidding microphone capture entirely.
 */
export function microphonePolicyAllowsCapture(
  source: BrowserSpeechGlobal = defaultGlobal(),
): boolean {
  const policy = source.document?.permissionsPolicy ?? source.document?.featurePolicy;
  if (typeof policy?.allowsFeature !== "function") return true;
  try {
    return policy.allowsFeature("microphone");
  } catch {
    // An unknown policy API must not be treated as a denial. getUserMedia will
    // still enforce the browser's actual permission decision on user gesture.
    return true;
  }
}

/** Detects synchronous API capabilities without prompting for microphone permission. */
export function detectSpeechCapabilities(
  source: BrowserSpeechGlobal = defaultGlobal(),
): SpeechCapabilities {
  const runtime = getSpeechRuntime(source);
  let localRecognition = false;
  if (runtime) {
    try {
      localRecognition = "processLocally" in runtime.createRecognition();
    } catch {
      localRecognition = false;
    }
  }
  const mediaDevices = source.navigator?.mediaDevices;
  const inputEnumeration = typeof mediaDevices?.enumerateDevices === "function";
  const inputSelection =
    inputEnumeration && typeof mediaDevices?.getUserMedia === "function";
  return {
    recognition: runtime !== null,
    localRecognition,
    // A legacy recognizer may use a browser cloud service. It is not selected
    // until the explicit config opt-in is true.
    cloudRecognition: runtime !== null,
    modelAvailability: typeof runtime?.available === "function",
    modelInstall: typeof runtime?.install === "function",
    modelRemoval: false,
    inputEnumeration,
    inputSelection,
    microphonePolicyAllowsCapture: microphonePolicyAllowsCapture(source),
    microphonePermission: "unknown",
  };
}

/** Checks the browser's existing microphone grant without requesting access. */
export async function getSpeechMicrophonePermission(
  source: BrowserSpeechGlobal = defaultGlobal(),
): Promise<SpeechMicrophonePermission> {
  const permissions = source.navigator?.permissions;
  if (typeof permissions?.query !== "function") return "unknown";
  try {
    const result = await permissions.query({ name: "microphone" });
    return result.state === "prompt" ||
      result.state === "granted" ||
      result.state === "denied"
      ? result.state
      : "unknown";
  } catch {
    return "unknown";
  }
}

function availability(value: unknown): SpeechModelAvailability {
  return value === "available" ||
    value === "downloadable" ||
    value === "downloading" ||
    value === "unavailable"
    ? value
    : "unknown";
}

/**
 * Resolves the precise local-model capability instead of treating every
 * unavailable state as a missing language package. This is especially useful
 * in embedded Webviews, which can expose legacy recognition but no on-device
 * model-management API.
 */
export function localSpeechModelControlState(
  capabilities: SpeechCapabilities,
  availability: SpeechModelAvailability,
): SpeechModelControlState {
  if (!capabilities.recognition) return "recognition-unavailable";
  if (!capabilities.localRecognition) return "local-recognition-unavailable";
  if (!capabilities.modelAvailability) return "availability-unavailable";
  if (availability === "downloadable" && !capabilities.modelInstall) {
    return "install-unavailable";
  }
  return availability;
}

export async function getLocalSpeechModelAvailability(
  runtime: SpeechRuntime | null,
  language: string,
): Promise<SpeechModelAvailability> {
  if (!runtime?.available) return "unknown";
  try {
    return availability(
      await runtime.available({ langs: [language], processLocally: true }),
    );
  } catch {
    return "unknown";
  }
}

export async function installLocalSpeechModel(
  runtime: SpeechRuntime | null,
  language: string,
): Promise<boolean> {
  if (!runtime?.install) return false;
  try {
    return (await runtime.install({ langs: [language], processLocally: true })) === true;
  } catch {
    return false;
  }
}

function normalizeTranscriptPart(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Splits browser results into stable final text and a replaceable interim tail. */
export function transcriptFromRecognitionEvent(event: SpeechRecognitionResultEventLike): {
  finalText: string;
  interimText: string;
} {
  const finals: string[] = [];
  const interims: string[] = [];
  const results = event.results;
  if (!results) return { finalText: "", interimText: "" };
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const text = normalizeTranscriptPart(result?.[0]?.transcript);
    if (!text) continue;
    if (result?.isFinal) finals.push(text);
    else interims.push(text);
  }
  return { finalText: finals.join(" "), interimText: interims.join(" ") };
}

const REGION_FOR_LANGUAGE: Record<string, string> = {
  de: "DE",
  en: "US",
  es: "ES",
  fr: "FR",
  hi: "IN",
  id: "ID",
  it: "IT",
  ja: "JP",
  ko: "KR",
  pl: "PL",
  pt: "BR",
  ru: "RU",
  th: "TH",
  tr: "TR",
  vi: "VN",
  zh: "CN",
};

/**
 * Resolves the system language to a useful BCP-47 speech tag. The browser is
 * still authoritative about actual model availability.
 */
export function systemSpeechLanguage(
  languages: readonly string[] | undefined = defaultGlobal().navigator?.languages,
  fallbackLanguage: string | undefined = defaultGlobal().navigator?.language,
): string {
  const candidate =
    languages?.find((value) => typeof value === "string" && value) ?? fallbackLanguage;
  if (!candidate) return "it-IT";
  try {
    const canonical = Intl.getCanonicalLocales(candidate)[0];
    if (!canonical) return "it-IT";
    if (canonical.includes("-")) return canonical;
    const region = REGION_FOR_LANGUAGE[canonical.toLowerCase()];
    return region ? `${canonical}-${region}` : canonical;
  } catch {
    return "it-IT";
  }
}

/** Languages Chrome documents for the current on-device implementation. */
export const SPEECH_LANGUAGE_CATALOG = [
  "it-IT",
  "en-US",
  "de-DE",
  "es-ES",
  "fr-FR",
  "hi-IN",
  "id-ID",
  "ja-JP",
  "ko-KR",
  "pl-PL",
  "pt-BR",
  "ru-RU",
  "th-TH",
  "tr-TR",
  "vi-VN",
  "zh-CN",
  "zh-TW",
] as const;

export function speechLanguageDisplayName(language: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type ShortcutModifier = (typeof MODIFIER_ORDER)[number];

export interface ParsedSpeechShortcut {
  modifiers: Set<ShortcutModifier>;
  code: string;
}

function shortcutCodeLabel(code: string): string {
  if (code === "Space") return "Space";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

/**
 * Accepts stored event-code shortcuts such as Ctrl+Alt+Space. Requiring a
 * modifier avoids stealing ordinary composer typing from the user.
 */
export function parseSpeechShortcut(value: string): ParsedSpeechShortcut | null {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const modifiers = new Set<ShortcutModifier>();
  let code = "";
  for (const part of parts) {
    const modifier = MODIFIER_ORDER.find(
      (candidate) => candidate.toLowerCase() === part.toLowerCase(),
    );
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (code) return null;
    code = part === " " ? "Space" : part;
  }
  if (!code || modifiers.size === 0) return null;
  return { modifiers, code };
}

export function formatSpeechShortcut(value: string): string {
  const parsed = parseSpeechShortcut(value);
  if (!parsed) return value;
  return [
    ...MODIFIER_ORDER.filter((modifier) => parsed.modifiers.has(modifier)),
    shortcutCodeLabel(parsed.code),
  ].join("+");
}

export function speechShortcutMatchesEvent(
  value: string,
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): boolean {
  const parsed = parseSpeechShortcut(value);
  if (!parsed || event.code !== parsed.code) return false;
  return (
    event.ctrlKey === parsed.modifiers.has("Ctrl") &&
    event.altKey === parsed.modifiers.has("Alt") &&
    event.shiftKey === parsed.modifiers.has("Shift") &&
    event.metaKey === parsed.modifiers.has("Meta")
  );
}

export function speechShortcutForMode(
  shortcuts: SpeechToTextShortcuts,
  mode: SpeechInputMode,
): string {
  return mode === "push-to-talk" ? shortcuts.pushToTalk : shortcuts.toggleToTalk;
}

/** Captures a normalized, modifier-based shortcut from a keydown event. */
export function speechShortcutFromKeyboardEvent(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): string | null {
  const modifierCodes = new Set([
    "ControlLeft",
    "ControlRight",
    "AltLeft",
    "AltRight",
    "ShiftLeft",
    "ShiftRight",
    "MetaLeft",
    "MetaRight",
  ]);
  if (!event.code || modifierCodes.has(event.code)) return null;
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  return modifiers.length > 0 ? [...modifiers, event.code].join("+") : null;
}
