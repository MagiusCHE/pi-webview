export function sessionIdFromPageSearch(search: string): string | null {
  return new URLSearchParams(search).get("s");
}

export function bridgeUrlWithPageIntent(bridgeUrl: string, pageSearch: string): string {
  const params = new URLSearchParams(pageSearch);
  const sessionId = sessionIdFromPageSearch(pageSearch);
  const legacySessionPath = params.get("session");
  const launchId = params.get("launch");
  const url = new URL(bridgeUrl);
  if (sessionId) url.searchParams.set("sessionId", sessionId);
  else if (legacySessionPath) url.searchParams.set("session", legacySessionPath);
  else if (params.get("new") === "1") {
    url.searchParams.set("new", "1");
    if (launchId) url.searchParams.set("launchId", launchId);
  }
  return url.toString();
}

export function pageUrlForSession(currentUrl: string, sessionId: string): string {
  const url = new URL(currentUrl);
  url.searchParams.delete("new");
  url.searchParams.delete("session");
  url.searchParams.delete("launch");
  url.searchParams.set("s", sessionId);
  return url.toString();
}
