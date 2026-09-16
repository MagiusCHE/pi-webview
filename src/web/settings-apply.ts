export function browserServerSettingDirty(
  currentUrl: string,
  savedUrl: string,
  ready: boolean,
  browserExtension: boolean,
): boolean {
  return browserExtension && ready && currentUrl.trim() !== savedUrl.trim();
}

export function settingRecordsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

export function settingsApplyNeeded(
  browserDirty: boolean,
  cliDirty: boolean,
  pendingPiSettings: number,
): boolean {
  return browserDirty || cliDirty || pendingPiSettings > 0;
}
