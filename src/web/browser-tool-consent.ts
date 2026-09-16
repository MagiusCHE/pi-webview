export type BrowserReadOperation = "dom" | "screenshot";

export function browserReadConsentKey(
  origin: string,
  operation: BrowserReadOperation,
): string {
  return `${operation}:${origin}`;
}

export class BrowserReadConsentStore {
  private readonly allowed = new Set<string>();
  private readonly pending = new Map<string, Promise<boolean>>();

  allow(
    origin: string,
    operation: BrowserReadOperation,
    confirm: () => Promise<boolean>,
  ): Promise<boolean> {
    const key = browserReadConsentKey(origin, operation);
    if (this.allowed.has(key)) return Promise.resolve(true);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = confirm().then(
      (accepted) => {
        this.pending.delete(key);
        if (accepted) this.allowed.add(key);
        return accepted;
      },
      (error: unknown) => {
        this.pending.delete(key);
        throw error;
      },
    );
    this.pending.set(key, request);
    return request;
  }
}
