// A new-session request must also recover a host whose pi RPC process has
// already stopped, for example after attempting to resume an invalid file.
export function shouldRestartPiForNewSession(
  commandType: unknown,
  piRunning: boolean,
): boolean {
  return commandType === "new_session" && !piRunning;
}
