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
