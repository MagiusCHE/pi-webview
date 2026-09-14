import type { ImageContent } from "./protocol.ts";

export type TextPresentationFormat = "plain" | "json" | "code";

export type PresentedContentItem =
  | {
      kind: "text";
      text: string;
      format: TextPresentationFormat;
      language?: string;
    }
  | { kind: "image"; image: ImageContent }
  | {
      kind: "media";
      mediaType: "audio" | "video";
      data: string;
      mimeType: string;
      name?: string;
    }
  | {
      kind: "file";
      name: string;
      mimeType?: string;
      data?: string;
      path?: string;
      text?: string;
    }
  | { kind: "link"; uri: string; name?: string; mimeType?: string };

export interface DisplayMessageContent {
  text: string;
  images: ImageContent[];
  items: PresentedContentItem[];
}

function isMimeType(value: string, family: string): boolean {
  return new RegExp(`^${family}/[a-z0-9][a-z0-9.+-]*$`, "i").test(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function textItem(text: string): PresentedContentItem {
  const fenced = /^```([\w.+-]*)\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text.trim());
  if (fenced) {
    return {
      kind: "text",
      text: fenced[2] ?? "",
      format: "code",
      ...(fenced[1] ? { language: fenced[1] } : {}),
    };
  }
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return {
        kind: "text",
        text: JSON.stringify(JSON.parse(trimmed), null, 2),
        format: "json",
        language: "json",
      };
    } catch {
      // It only resembles JSON; preserve it as plain text.
    }
  }
  return { kind: "text", text, format: "plain" };
}

function imageItem(block: Record<string, unknown>): PresentedContentItem | null {
  const data = stringField(block.data);
  const mimeType = stringField(block.mimeType);
  if (!data || !mimeType || !isMimeType(mimeType, "image")) return null;
  return { kind: "image", image: { type: "image", data, mimeType } };
}

function mediaItem(block: Record<string, unknown>): PresentedContentItem | null {
  const data = stringField(block.data);
  const mimeType = stringField(block.mimeType);
  if (!data || !mimeType) return null;
  const mediaType = isMimeType(mimeType, "audio")
    ? "audio"
    : isMimeType(mimeType, "video")
      ? "video"
      : null;
  if (!mediaType) return null;
  return {
    kind: "media",
    mediaType,
    data,
    mimeType,
    ...(stringField(block.name) ? { name: String(block.name) } : {}),
  };
}

function fileItem(block: Record<string, unknown>): PresentedContentItem | null {
  const name = stringField(block.name) ?? stringField(block.filename);
  const path = stringField(block.path);
  const data = stringField(block.data) ?? stringField(block.blob);
  const text = stringField(block.text);
  const mimeType = stringField(block.mimeType);
  if (!name && !path) return null;
  return {
    kind: "file",
    name: name ?? path!.split(/[\\/]/).pop() ?? path!,
    ...(mimeType ? { mimeType } : {}),
    ...(data ? { data } : {}),
    ...(path ? { path } : {}),
    ...(text ? { text } : {}),
  };
}

function resourceItem(block: Record<string, unknown>): PresentedContentItem | null {
  const resource =
    typeof block.resource === "object" && block.resource !== null
      ? (block.resource as Record<string, unknown>)
      : block;
  const uri = stringField(resource.uri);
  const name = stringField(resource.name);
  const mimeType = stringField(resource.mimeType);
  const data = stringField(resource.blob) ?? stringField(resource.data);
  const text = stringField(resource.text);
  if (data || text) {
    return {
      kind: "file",
      name: name ?? uri?.split("/").pop() ?? "resource",
      ...(mimeType ? { mimeType } : {}),
      ...(data ? { data } : {}),
      ...(text ? { text } : {}),
      ...(uri?.startsWith("file://") ? { path: uri.slice("file://".length) } : {}),
    };
  }
  return uri
    ? {
        kind: "link",
        uri,
        ...(name ? { name } : {}),
        ...(mimeType ? { mimeType } : {}),
      }
    : null;
}

function unknownItem(block: unknown): PresentedContentItem {
  let text: string;
  try {
    text = JSON.stringify(block, null, 2) ?? String(block);
  } catch {
    text = String(block);
  }
  return { kind: "text", text, format: "json", language: "json" };
}

function contentItems(content: unknown): PresentedContentItem[] {
  if (typeof content === "string") return [textItem(content)];
  const blocks = Array.isArray(content) ? content : content == null ? [] : [content];
  return blocks.flatMap((raw): PresentedContentItem[] => {
    if (typeof raw === "string") return [textItem(raw)];
    if (typeof raw !== "object" || raw === null) return [unknownItem(raw)];
    const block = raw as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return [textItem(block.text)];
    }
    if (block.type === "image") {
      const item = imageItem(block);
      return item ? [item] : [];
    }
    if (block.type === "audio" || block.type === "video") {
      const item = mediaItem(block);
      return item ? [item] : [];
    }
    if (block.type === "file") {
      const item = fileItem(block);
      return item ? [item] : [unknownItem(raw)];
    }
    if (block.type === "resource" || block.type === "resource_link") {
      const item = resourceItem(block);
      return item ? [item] : [unknownItem(raw)];
    }
    if (typeof block.text === "string") return [textItem(block.text)];
    return [unknownItem(raw)];
  });
}

export function imageContentBlocks(content: unknown): ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = imageItem(raw as Record<string, unknown>);
    return (raw as { type?: unknown }).type === "image" && item?.kind === "image"
      ? [item.image]
      : [];
  });
}

export function displayMessageContent(content: unknown): DisplayMessageContent {
  const items = contentItems(content);
  const rawBlocks = Array.isArray(content) ? content : [content];
  const rawText = rawBlocks
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      if (
        typeof block === "object" &&
        block !== null &&
        typeof (block as { text?: unknown }).text === "string"
      )
        return [(block as { text: string }).text];
      return [];
    })
    .join("");
  const fallbackText = items
    .flatMap((item) => (item.kind === "text" ? [item.text] : []))
    .join("");
  const images = items.flatMap((item) => (item.kind === "image" ? [item.image] : []));
  return { text: rawText || fallbackText, images, items };
}

export function toolExecutionEndContent(event: unknown): DisplayMessageContent {
  const content = (event as { result?: { content?: unknown } } | null)?.result?.content;
  return displayMessageContent(content);
}

export function historyToolResultContent(message: unknown): DisplayMessageContent {
  const content = (message as { content?: unknown } | null)?.content;
  return displayMessageContent(content);
}

export function hasPresentedContent(content: DisplayMessageContent): boolean {
  return content.items.some((item) =>
    item.kind === "text" ? item.text.length > 0 : true,
  );
}

export function imageDataUrl(image: ImageContent): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export function imageDownloadName(image: ImageContent, index: number): string {
  const subtype = image.mimeType.slice("image/".length).toLowerCase();
  const extension = subtype === "jpeg" ? "jpg" : subtype.replace(/\+xml$/, "");
  return `pi-webview-image-${index + 1}.${extension || "img"}`;
}
