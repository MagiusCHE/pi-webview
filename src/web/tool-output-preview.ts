import { t } from "./i18n.ts";

export const TOOL_OUTPUT_PREVIEW_LINES = 3;

export function toolOutputNeedsExpansion(height: number, lineHeight: number): boolean {
  // DOM heights are rounded to whole pixels; tolerate that rounding at line 3.
  return lineHeight > 0 && height > TOOL_OUTPUT_PREVIEW_LINES * lineHeight + 1;
}

interface PreviewBinding {
  box: HTMLElement;
  text: HTMLElement;
  toggle: HTMLButtonElement;
  expanded: boolean;
  frame: number | null;
}

const previews = new WeakMap<HTMLElement, PreviewBinding>();
const observedText = new WeakMap<HTMLElement, PreviewBinding>();
let resizeObserver: ResizeObserver | null = null;
let previewId = 0;

function updatePreview(binding: PreviewBinding): void {
  const label = t(binding.expanded ? "toolOutputShowLess" : "toolOutputShowAll");
  if (binding.toggle.textContent !== label) binding.toggle.textContent = label;
  binding.toggle.setAttribute("aria-expanded", String(binding.expanded));
  binding.box.classList.toggle("is-expanded", binding.expanded);
  if (!binding.text.isConnected || binding.text.clientWidth === 0) return;
  const lineHeight = Number.parseFloat(getComputedStyle(binding.text).lineHeight);
  binding.toggle.hidden = !toolOutputNeedsExpansion(
    binding.text.scrollHeight,
    lineHeight,
  );
}

function schedulePreviewUpdate(binding: PreviewBinding): void {
  if (binding.frame !== null) return;
  // A toggle changes layout. Defer it out of ResizeObserver delivery to avoid
  // resize loops when a button or a scrollbar changes the available width.
  binding.frame = requestAnimationFrame(() => {
    binding.frame = null;
    if (!binding.box.isConnected) {
      resizeObserver?.unobserve(binding.text);
      observedText.delete(binding.text);
    } else updatePreview(binding);
  });
}

/** Wrap only textual content; rich attachments remain outside the preview. */
export function wrapToolOutputPreview(
  content: HTMLElement,
  text: HTMLElement = content,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "presented-output-preview";
  text.classList.add("presented-output-preview-text");
  text.id = `tool-output-preview-${++previewId}`;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn presented-output-toggle";
  toggle.hidden = true;
  toggle.setAttribute("aria-controls", text.id);
  const binding: PreviewBinding = { box, text, toggle, expanded: false, frame: null };
  previews.set(box, binding);
  toggle.addEventListener("click", () => {
    binding.expanded = !binding.expanded;
    updatePreview(binding);
  });
  box.append(content, toggle);
  updatePreview(binding);
  return box;
}

function visitPreviews(
  node: HTMLElement,
  visit: (binding: PreviewBinding) => void,
): void {
  const own = previews.get(node);
  if (own) visit(own);
  for (const box of node.querySelectorAll<HTMLElement>(".presented-output-preview")) {
    const binding = previews.get(box);
    if (binding) visit(binding);
  }
}

/** Called after insertion, so overflow includes wrapping at the actual width. */
export function observeToolOutputPreviews(node: HTMLElement): void {
  visitPreviews(node, (binding) => {
    if (observedText.has(binding.text)) return;
    resizeObserver ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const text = entry.target as HTMLElement;
        const current = observedText.get(text);
        if (!current) continue;
        schedulePreviewUpdate(current);
      }
    });
    observedText.set(binding.text, binding);
    resizeObserver.observe(binding.text);
  });
}

/** Stop observing outputs discarded by history rebuilds or message limits. */
export function discardToolOutputPreviews(node: HTMLElement): void {
  visitPreviews(node, (binding) => {
    if (binding.frame !== null) cancelAnimationFrame(binding.frame);
    binding.frame = null;
    resizeObserver?.unobserve(binding.text);
    observedText.delete(binding.text);
  });
}

export function refreshToolOutputPreviews(node: HTMLElement): void {
  visitPreviews(node, updatePreview);
}
