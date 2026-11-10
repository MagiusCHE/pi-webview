import type { RpcEvent } from "./protocol.ts";

export interface ExtensionStatus {
  statusKey: string;
  statusText: string;
}

/** Volatile presentation state only; never retain dialogs or notifications. */
export class ExtensionUiState {
  private readonly state = new Map<string, RpcEvent>();

  record(event: RpcEvent): void {
    if (event.type !== "extension_ui_request") return;
    const key =
      event.method === "setStatus" && typeof event.statusKey === "string"
        ? `status:${event.statusKey}`
        : event.method === "setWidget" && typeof event.widgetKey === "string"
          ? `widget:${event.widgetKey}`
          : event.method === "setTitle" || event.method === "set_editor_text"
            ? event.method
            : null;
    if (key) this.state.set(key, { ...event });
  }

  clear(): void {
    this.state.clear();
  }

  events(): RpcEvent[] {
    return Array.from(this.state.values(), (event) => ({ ...event }));
  }

  statuses(): ExtensionStatus[] {
    return this.events()
      .filter((event) => event.method === "setStatus")
      .map((event) => ({
        statusKey: event.statusKey as string,
        // Keep clears as tombstones so a suspended UI can remove stale statuses.
        statusText: typeof event.statusText === "string" ? event.statusText : "",
      }));
  }
}

/** Do not let a delayed snapshot overwrite a newer live status event. */
export function recoverableStatuses(
  snapshot: unknown,
  versions: ReadonlyMap<string, number>,
  requestedAt: number,
): ExtensionStatus[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.filter(
    (item): item is ExtensionStatus =>
      item !== null &&
      typeof item === "object" &&
      typeof item.statusKey === "string" &&
      typeof item.statusText === "string" &&
      (versions.get(item.statusKey) ?? 0) <= requestedAt,
  );
}
