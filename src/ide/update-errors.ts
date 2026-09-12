/** npm 12 refusal for package dependencies that resolve directly from remote URLs. */
export function hasRemoteNpmDependencyDisabledError(text: string): boolean {
  return (
    /\bEALLOWREMOTE\b/i.test(text) ||
    /fetching packages of type ["']?remote["']? (?:have|has) been disabled/i.test(text)
  );
}

/** Only extension update failures should produce the Webview settings hint. */
export function isRemoteNpmDependencyDisabledUpdate(text: string): boolean {
  return (
    /pi-webview:\s*update failed/i.test(text) && hasRemoteNpmDependencyDisabledError(text)
  );
}

/** npm update completed without running one or more dependency lifecycle scripts. */
export function hasBlockedNpmInstallScripts(text: string): boolean {
  return /install scripts blocked because they are not covered by allowScripts/i.test(
    text,
  );
}

/** Only pi-webview update output should produce the dangerous-scripts hint. */
export function isBlockedNpmInstallScriptsUpdate(text: string): boolean {
  return /pi-webview:/i.test(text) && hasBlockedNpmInstallScripts(text);
}

export type UpdateExecutionOutcome = "success" | "failure";

/** Completion signal emitted by `/piw update.pi.core.exts`. */
export function updateExecutionOutcome(text: string): UpdateExecutionOutcome | null {
  if (/pi-webview:\s*update finished\b/i.test(text)) return "success";
  if (/pi-webview:\s*update failed\b/i.test(text)) return "failure";
  return null;
}
