export const COLLAPSE_FOOTER_MIN_REM = 5;

export function joinCollapseHeaderParts(parts: string[]): string {
  return parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

export function shouldShowCollapseFooter(
  expanded: boolean,
  totalBlockHeight: number,
  visibleFooterHeight: number,
  rootFontSize: number,
): boolean {
  if (!expanded || rootFontSize <= 0) return false;
  const blockHeightWithoutFooter = Math.max(0, totalBlockHeight - visibleFooterHeight);
  return blockHeightWithoutFooter > COLLAPSE_FOOTER_MIN_REM * rootFontSize;
}
