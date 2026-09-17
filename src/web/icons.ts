// Monochrome Material icons in SVG, colorable via CSS (currentColor).

export type TrustIconKind = "shield" | "warn-outline" | "warn-filled";

// Material "shield"
const SHIELD =
  '<path d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"/>';

// Material "warning": same triangle, reused for outline and filled
const WARN = '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>';

export function trustIcon(kind: TrustIconKind): string {
  if (kind === "shield") {
    return `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true">${SHIELD}</svg>`;
  }
  if (kind === "warn-outline") {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">${WARN}</svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true">${WARN}</svg>`;
}

// Material "arrow_upward" (send)
const SEND = '<path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>';

// Material "stop" (quadrato pieno, interrompi)
const STOP = '<path d="M6 6h12v12H6z"/>';

export function sendIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" aria-hidden="true">${SEND}</svg>`;
}

// Material "mic". The active state uses the separate waveform below so the
// browser microphone state is apparent even without relying on color alone.
const MICROPHONE =
  '<path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21H8v2h8v-2h-3v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>';

export function microphoneIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="17" height="17" aria-hidden="true">${MICROPHONE}</svg>`;
}

const WAVEFORM =
  '<path class="speech-wave-bar speech-wave-bar-1" d="M4 10h2v4H4z"/>' +
  '<path class="speech-wave-bar speech-wave-bar-2" d="M8 6h2v12H8z"/>' +
  '<path class="speech-wave-bar speech-wave-bar-3" d="M12 3h2v18h-2z"/>' +
  '<path class="speech-wave-bar speech-wave-bar-4" d="M16 7h2v10h-2z"/>' +
  '<path class="speech-wave-bar speech-wave-bar-5" d="M20 10h2v4h-2z"/>';

export function speechWaveformIcon(): string {
  return `<svg class="speech-waveform" viewBox="0 0 26 24" fill="currentColor" width="18" height="18" aria-hidden="true">${WAVEFORM}</svg>`;
}

export function stopIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true">${STOP}</svg>`;
}

// Material "attach_file" (attachment)
const ATTACH =
  '<path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>';

export function attachFileIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">${ATTACH}</svg>`;
}

// lucide "square-pen" (stesso icon di Codex/Copilot): quadrato con la matita
const NEW_CHAT =
  '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

export function newChatIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">${NEW_CHAT}</svg>`;
}

// Lucide "chevrons-up-down" / "chevrons-down-up": expand or collapse all
// thinking blocks in the displayed chat.
const THINKING_EXPAND =
  '<path d="m7 15 5 5 5-5M7 9l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const THINKING_COLLAPSE =
  '<path d="m7 20 5-5 5 5M7 4l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

export function thinkingBlocksIcon(action: "expand" | "collapse"): string {
  const path = action === "expand" ? THINKING_EXPAND : THINKING_COLLAPSE;
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">${path}</svg>`;
}

// Lucide "arrow-up": repeated-header control at the bottom of long,
// expanded collapsible sections.
const ARROW_UP =
  '<path d="m18 15-6-6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M12 9v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

export function arrowUpIcon(): string {
  return `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${ARROW_UP}</svg>`;
}

// Material "edit" (matita) per rinomina sessione
const PENCIL =
  '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>';
export function pencilIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true">${PENCIL}</svg>`;
}

// Material "delete" (cestino) per eliminazione sessione
const TRASH =
  '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>';
export function trashIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true">${TRASH}</svg>`;
}

// Material "settings" (ingranaggio, 16px come le altre icone header)
const SETTINGS =
  '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>';

export function settingsIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">${SETTINGS}</svg>`;
}

// Material "refresh" (full reload: restart the pi process + reload the
// webview page)
const RELOAD =
  '<path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>';

export function reloadIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">${RELOAD}</svg>`;
}

// pi core update available (header button, tinted yellow via --warn): reuses the
// "shield" path already defined above (trust icon)
export function updateIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">${SHIELD}</svg>`;
}

// Material "chat_bubble" (icona del pensiero nella toolbar)
const CHAT =
  '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>';

export function chatIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true">${CHAT}</svg>`;
}

// Material "folder" (browse workspace folder)
const FOLDER =
  '<path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>';

export function folderIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">${FOLDER}</svg>`;
}

// Material "arrow_downward" (back to bottom)
const ARROW_DOWN =
  '<path d="M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"/>';

export function scrollDownIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">${ARROW_DOWN}</svg>`;
}

// Material "open_in_new" (open a tool file in the host environment)
const OPEN_IN_NEW =
  '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>';

export function openFileIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">${OPEN_IN_NEW}</svg>`;
}

// Material "content_copy" (copia)
const COPY =
  '<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>';

// Material "check" (copiato)
const CHECK = '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>';

export function copyIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true">${COPY}</svg>`;
}

export function checkIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" aria-hidden="true">${CHECK}</svg>`;
}
