// Rendering markdown dei messaggi dell'assistente.
// marked (GFM) + DOMPurify per sanitizzare l'output del modello.

import { marked } from "marked";
import DOMPurify from "dompurify";

// I link del modello si aprono in nuova scheda, con rel di sicurezza.
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
