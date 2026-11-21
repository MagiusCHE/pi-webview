import { linkTooltip, localLinkPath } from "../ide/local-link.ts";
import { linkImageMime, webImageUrl, type LinkImage } from "../ide/link-image.ts";
import { LOCAL_LINK_HREF } from "./markdown.ts";

interface ChatLinkActions {
  tooltipMaxChars: () => number;
  menuLabel: (key: "cut" | "copy" | "paste" | "copyLink") => string;
  copy: (text: string) => void;
  openLocal: (path: string) => void;
  readImage: (path: string) => Promise<LinkImage | null>;
}

function eventLink(event: Event): HTMLAnchorElement | undefined {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  // Download buttons can carry large base64 payloads, not link destinations.
  return anchor instanceof HTMLAnchorElement && !anchor.hasAttribute("download")
    ? anchor
    : undefined;
}

function destination(anchor: HTMLAnchorElement): string {
  const href = anchor.getAttribute(LOCAL_LINK_HREF) ?? anchor.getAttribute("href") ?? "";
  // Resolve protocol-relative links, but never expand a fragment to the
  // current Webview URL (which may contain a private bridge token).
  return href.startsWith("//") ? anchor.href : href;
}

function positionOverlay(element: HTMLElement, x: number, y: number): void {
  element.style.left = `${Math.max(0, Math.min(x, window.innerWidth - element.offsetWidth))}px`;
  element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - element.offsetHeight))}px`;
}

function installImagePreview(actions: ChatLinkActions): () => void {
  let hovered: HTMLAnchorElement | undefined;
  let overlay: HTMLElement | undefined;
  let timer: number | undefined;
  let lastTitle = "";
  let generation = 0;
  const observer = new MutationObserver(() => {
    if (!hovered?.isConnected) dismiss();
  });
  const dismiss = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    if (hovered && overlay) hovered.title = lastTitle;
    hovered = undefined;
    overlay?.remove();
    overlay = undefined;
    generation++;
  };

  document.addEventListener("pointerover", (event) => {
    const anchor = eventLink(event);
    if (
      !event.isTrusted ||
      event.pointerType === "touch" ||
      !anchor ||
      anchor === hovered
    )
      return;
    dismiss();
    const href = destination(anchor);
    const path = anchor.hasAttribute(LOCAL_LINK_HREF) ? localLinkPath(href) : undefined;
    const mime = path && linkImageMime(path);
    const webUrl = webImageUrl(href);
    if (!mime && !webUrl) return;
    hovered = anchor;
    const id = generation;
    const stillHovered = () =>
      id === generation && anchor.isConnected && anchor.matches(":hover");
    timer = window.setTimeout(async () => {
      if (!stillHovered()) return;
      let src = webUrl;
      if (path && mime) {
        const data = await actions.readImage(path).catch(() => null);
        if (!data || data.mimeType !== mime) return;
        src = `data:${mime};base64,${data.dataBase64}`;
      }
      if (!src || !stillHovered()) return;
      const image = new Image();
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      image.onload = () => {
        if (!stillHovered()) return;
        lastTitle = anchor.title;
        anchor.title = "";
        const label = document.createElement("div");
        label.textContent = linkTooltip(href, actions.tooltipMaxChars());
        overlay = document.createElement("div");
        overlay.className = "link-image-preview";
        overlay.setAttribute("aria-hidden", "true");
        overlay.append(image, label);
        document.body.append(overlay);
        const rect = anchor.getBoundingClientRect();
        const gap = 6;
        const y =
          rect.bottom + gap + overlay.offsetHeight <= window.innerHeight
            ? rect.bottom + gap
            : rect.top - overlay.offsetHeight - gap;
        positionOverlay(overlay, rect.left, y);
        observer.observe(document.body, { childList: true, subtree: true });
      };
      image.src = src;
    }, 300);
  });
  document.addEventListener("pointerout", (event) => {
    if (
      hovered &&
      eventLink(event) === hovered &&
      !(event.relatedTarget instanceof Node && hovered.contains(event.relatedTarget))
    )
      dismiss();
  });
  window.addEventListener("blur", dismiss);
  return dismiss;
}

export function installChatLinks(actions: ChatLinkActions): void {
  const dismissPreview = installImagePreview(actions);
  let menu: HTMLElement | undefined;
  let trigger: HTMLAnchorElement | undefined;
  const close = (restoreFocus = false) => {
    menu?.remove();
    menu = undefined;
    if (restoreFocus) trigger?.focus({ preventScroll: true });
    trigger = undefined;
  };

  // Delegation handles both streaming DOM replacements and reconstructed history.
  const updateTooltip = (event: Event) => {
    const anchor = eventLink(event);
    if (anchor)
      anchor.title = linkTooltip(destination(anchor), actions.tooltipMaxChars());
  };
  document.addEventListener("pointerover", updateTooltip);
  document.addEventListener("focusin", updateTooltip);
  document.addEventListener(
    "click",
    (event) => {
      const href = eventLink(event)?.getAttribute(LOCAL_LINK_HREF);
      if (href == null) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.isTrusted) return;
      const path = localLinkPath(href);
      if (path) actions.openLocal(path);
    },
    true,
  );
  document.addEventListener("auxclick", (event) => {
    if (eventLink(event)?.hasAttribute(LOCAL_LINK_HREF)) event.preventDefault();
  });

  document.addEventListener(
    "contextmenu",
    (event) => {
      const anchor = eventLink(event);
      close();
      if (!anchor || anchor.isContentEditable) return;
      dismissPreview();
      const value = destination(anchor);
      if (!value) return;
      event.preventDefault();
      event.stopPropagation();

      trigger = anchor;
      menu = document.createElement("div");
      menu.className = "link-context-menu";
      const selection = document.getSelection()?.toString() ?? "";
      const addItem = (
        key: Parameters<ChatLinkActions["menuLabel"]>[0],
        content?: string,
      ) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "pop-item";
        item.textContent = actions.menuLabel(key);
        item.disabled = !content;
        if (content)
          item.addEventListener("click", (event) => {
            close(true);
            if (event.isTrusted) actions.copy(content);
          });
        menu?.append(item);
        return item;
      };
      // Links are in read-only content; the browser leaves Cut and Paste
      // disabled there. The native menu remains untouched in editable content.
      addItem("cut");
      addItem("copy", selection);
      addItem("paste");
      const copyLink = addItem("copyLink", value);
      document.body.append(menu);
      const { left, bottom } = anchor.getBoundingClientRect();
      const atPointer = event.clientX !== 0 || event.clientY !== 0;
      const x = atPointer ? event.clientX : left;
      const y = atPointer ? event.clientY : bottom;
      positionOverlay(menu, x, y);
      copyLink.focus({ preventScroll: true });
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      dismissPreview();
      if (menu && !menu.contains(event.target as Node)) close();
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    if (menu && !menu.contains(event.target as Node)) close();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      dismissPreview();
      if (menu) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
      }
    },
    true,
  );
  const closeOverlays = () => {
    dismissPreview();
    close();
  };
  window.addEventListener("scroll", closeOverlays, true);
  window.addEventListener("resize", closeOverlays);
}

/** Clipboard fallback for browsers on plain HTTP (e.g. remote piw). */
export function copyWithSelection(text: string): boolean {
  const focused = document.activeElement;
  const input = document.createElement("textarea");
  input.className = "link-clipboard-fallback";
  input.value = text;
  input.readOnly = true;
  document.body.append(input);
  input.select();
  try {
    return document.execCommand("copy");
  } finally {
    input.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
