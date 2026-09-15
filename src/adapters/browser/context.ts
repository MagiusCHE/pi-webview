const SENSITIVE_QUERY_KEY =
  /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|auth|authorization|oauth[_-]?code|code|api[_-]?key|apikey|key|secret|password|passwd|signature|sig|jwt|credential)$/i;

export function safeBrowserPageUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    if (/(?:token|secret|password|code|signature|credential)=/i.test(url.hash)) {
      url.hash = "#[redacted]";
    }
    return url.toString();
  } catch {
    return value;
  }
}
