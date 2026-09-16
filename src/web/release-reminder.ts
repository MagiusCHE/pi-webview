// The release reminder is a regular informational notification. Its first
// line is intentionally stable so the webview can render it with the same
// card family as the Context / Skills / Extensions startup information.
export function isReleaseReminderMessage(message: string): boolean {
  return /^pi-webview\s+v?\d+(?:\.\d+)+(?:-[0-9A-Za-z.-]+)?(?:\s|$)/i.test(message);
}
