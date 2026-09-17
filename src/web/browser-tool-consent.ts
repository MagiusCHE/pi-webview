import {
  isolatedBrowserNavigationAction,
  type BrowserPageAction,
  type BrowserPersistentPermissions,
  type BrowserToolOperation,
} from "../ide/browser-tools.ts";

export type BrowserPermissionScope = "session" | "site" | "global";

const OPERATIONS: BrowserToolOperation[] = ["dom", "screenshot", "action"];

/**
 * Determines the origin shown in a browser-tool consent dialog. A navigation
 * from a browser-internal page has no page origin that can be granted, so it
 * is scoped to the validated HTTP(S) destination instead.
 */
export function browserToolPermissionOrigin(
  operation: BrowserToolOperation,
  pageUrl: string,
  restricted: boolean | undefined,
  actions?: BrowserPageAction[],
): string | null {
  const navigation =
    operation === "action" && actions
      ? isolatedBrowserNavigationAction(actions)
      : undefined;
  if (restricted && navigation?.type !== "navigate") return null;
  const candidate = navigation?.type === "navigate" ? navigation.url : pageUrl;
  try {
    const origin = new URL(candidate).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function normalizeBrowserPermissionOperations(
  value: unknown,
): BrowserToolOperation[] {
  if (!Array.isArray(value)) return [];
  const requested = new Set(value);
  return OPERATIONS.filter((operation) => requested.has(operation));
}

export function normalizeBrowserPersistentPermissions(
  value: unknown,
): BrowserPersistentPermissions {
  if (!value || typeof value !== "object") return {};
  const candidate = value as {
    global?: unknown;
    sites?: unknown;
  };
  const global = normalizeBrowserPermissionOperations(candidate.global);
  const sites: Record<string, BrowserToolOperation[]> = {};
  if (candidate.sites && typeof candidate.sites === "object") {
    for (const [origin, operations] of Object.entries(candidate.sites)) {
      try {
        if (new URL(origin).origin !== origin) continue;
      } catch {
        continue;
      }
      const normalized = normalizeBrowserPermissionOperations(operations);
      if (normalized.length > 0) sites[origin] = normalized;
    }
  }
  return {
    ...(global.length > 0 ? { global } : {}),
    ...(Object.keys(sites).length > 0 ? { sites } : {}),
  };
}

export function browserToolPermissionGranted(
  operation: BrowserToolOperation,
  origin: string,
  sessionPermissions: BrowserToolOperation[],
  persistentPermissions: BrowserPersistentPermissions,
): boolean {
  return (
    sessionPermissions.includes(operation) ||
    persistentPermissions.global?.includes(operation) === true ||
    persistentPermissions.sites?.[origin]?.includes(operation) === true
  );
}

export function grantBrowserSessionPermission(
  permissions: BrowserToolOperation[],
  operation: BrowserToolOperation,
): BrowserToolOperation[] {
  return normalizeBrowserPermissionOperations([...permissions, operation]);
}

export function grantBrowserPersistentPermission(
  permissions: BrowserPersistentPermissions,
  operation: BrowserToolOperation,
  origin: string,
  scope: Exclude<BrowserPermissionScope, "session">,
): BrowserPersistentPermissions {
  const normalized = normalizeBrowserPersistentPermissions(permissions);
  if (scope === "global") {
    return {
      ...normalized,
      global: normalizeBrowserPermissionOperations([
        ...(normalized.global ?? []),
        operation,
      ]),
    };
  }
  return {
    ...normalized,
    sites: {
      ...(normalized.sites ?? {}),
      [origin]: normalizeBrowserPermissionOperations([
        ...(normalized.sites?.[origin] ?? []),
        operation,
      ]),
    },
  };
}

export function hasBrowserPersistentPermissions(
  permissions: BrowserPersistentPermissions,
): boolean {
  const normalized = normalizeBrowserPersistentPermissions(permissions);
  return (
    (normalized.global?.length ?? 0) > 0 || Object.keys(normalized.sites ?? {}).length > 0
  );
}
