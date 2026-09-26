// Painting policy of the thought blocks (src/web/main.ts).
//
// A thought stays raw text until its block is open: a collapsed block is never
// formatted and never re-parsed while the reasoning streams, and it is painted
// the first time the user expands it. Rendering itself (marked + DOMPurify and
// the code-block enhancement) stays in the webview; only the decision is here,
// so it can be tested without a DOM.

export type ThinkingPaintDecision = "paint" | "collapsed" | "current";

export function thinkingPaintDecision(
  hidden: boolean,
  source: string,
  painted: string | undefined,
): ThinkingPaintDecision {
  if (hidden) return "collapsed";
  if (painted === source) return "current";
  return "paint";
}
