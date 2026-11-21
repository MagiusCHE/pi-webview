// Markdown rendering of the assistant messages.
// marked (GFM) + DOMPurify to sanitize the model output.

import { marked } from "marked";
import DOMPurify from "dompurify";
import { localLinkPath } from "../ide/local-link.ts";
import { runtime } from "./environment.ts";

export const LOCAL_LINK_HREF = "data-piw-local-link-href";
const localDestinations = new WeakMap<Element, string>();

DOMPurify.addHook("uponSanitizeAttribute", (node, attr) => {
  // VS Code allows web images for deliberate hover previews. Keep Markdown
  // from automatically loading third-party images (including picture/poster).
  if (runtime.isVsCode) {
    if (["srcset", "imagesrcset"].includes(attr.attrName)) attr.keepAttr = false;
    if (["src", "poster", "background"].includes(attr.attrName)) {
      try {
        const url = new URL(attr.attrValue, location.href);
        if (/^https?:$/.test(url.protocol) && url.origin !== location.origin)
          attr.keepAttr = false;
      } catch {
        attr.keepAttr = false;
      }
    }
  }
  if (node.tagName === "A" && attr.attrName === "href" && localLinkPath(attr.attrValue)) {
    // Never put a local path or a file: URL in a navigable attribute.
    localDestinations.set(node, attr.attrValue);
    attr.attrValue = "#";
  }
});
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return;
  const localHref = localDestinations.get(node);
  if (localHref !== undefined) {
    node.setAttribute(LOCAL_LINK_HREF, localHref);
    node.removeAttribute("target");
  } else {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: [LOCAL_LINK_HREF],
  });
}
