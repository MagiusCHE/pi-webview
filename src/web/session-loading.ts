// A startup extension may ask for input while the session is still loading.
// Pi cannot consume a response until its RPC input reader has been installed.
const interactiveMethods = new Set(["select", "confirm", "input", "editor"]);

export function isUnanswerableStartupRequest(
  rpcReady: boolean,
  method: string | undefined,
): boolean {
  return !rpcReady && interactiveMethods.has(method ?? "");
}

// Revealing the chat does not make the session ready for normal interaction.
export function canFinishSessionLoading(
  historyLoaded: boolean,
  agentActive: boolean,
  interactivePending: boolean,
  historyRetryInFlight: boolean,
): boolean {
  return historyLoaded && !agentActive && !interactivePending && !historyRetryInFlight;
}
