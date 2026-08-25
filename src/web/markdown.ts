// Markdown rendering of the assistant messages.
// marked (GFM) + DOMPurify to sanitize the model output.

import { marked } from "marked";
import DOMPurify from "dompurify";

// Model links open in a new tab, with safety rel attributes.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
