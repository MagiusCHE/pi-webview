import { randomBytes } from "node:crypto";

interface Handoff<T> {
  channel: T;
  createdAt: number;
  expiresAt: number;
}

export class BrowserHandoffRegistry<T> {
  private readonly values = new Map<string, Handoff<T>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
  }

  create(channel: T, now = Date.now()): { ticket: string; expiresAt: number } {
    this.prune(now);
    const ticket = randomBytes(24).toString("hex");
    const expiresAt = now + this.ttlMs;
    this.values.set(ticket, { channel, createdAt: now, expiresAt });
    return { ticket, expiresAt };
  }

  consume(ticket: string, now = Date.now()): T | null {
    const handoff = this.values.get(ticket);
    this.values.delete(ticket);
    if (!handoff || handoff.expiresAt <= now) return null;
    return handoff.channel;
  }

  removeChannel(channel: T): void {
    for (const [ticket, handoff] of this.values) {
      if (handoff.channel === channel) this.values.delete(ticket);
    }
  }

  prune(now = Date.now()): void {
    for (const [ticket, handoff] of this.values) {
      if (handoff.expiresAt <= now) this.values.delete(ticket);
    }
  }
}
