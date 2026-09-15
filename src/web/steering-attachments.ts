export interface QueuedAttachmentEntry<T> {
  message: string;
  attachments: T[];
}

interface PendingAttachmentEntry<T> extends QueuedAttachmentEntry<T> {
  ticket: number;
}

/**
 * Retains only the attachment payload that pi's text-only queue_update and
 * clear_queue responses cannot represent. Pi remains authoritative for queue
 * membership and ordering; every update rebuilds this sidecar from its queue.
 */
export class SteeringAttachmentTracker<T> {
  private nextTicket = 1;
  private pending: PendingAttachmentEntry<T>[] = [];
  private current: QueuedAttachmentEntry<T>[] = [];

  stage(message: string, attachments: readonly T[]): number {
    const ticket = this.nextTicket++;
    this.pending.push({ ticket, message, attachments: [...attachments] });
    return ticket;
  }

  /** Discard a staged request if pi did not add it to the authoritative queue. */
  settle(ticket: number): void {
    const index = this.pending.findIndex((entry) => entry.ticket === ticket);
    if (index >= 0) this.pending.splice(index, 1);
  }

  update(messages: readonly string[]): QueuedAttachmentEntry<T>[] {
    const oldMessages = this.current.map((entry) => entry.message);
    const overlap = suffixPrefixOverlap(oldMessages, messages);
    const preserved =
      overlap > 0 ? this.current.slice(this.current.length - overlap) : [];
    const next: QueuedAttachmentEntry<T>[] = [...preserved];

    for (let index = overlap; index < messages.length; index++) {
      const message = messages[index]!;
      let pendingIndex = this.pending.findIndex((entry) => entry.message === message);
      // Input hooks and prompt expansion can change the text before pi emits
      // queue_update. Queue ordering still provides an unambiguous fallback.
      if (pendingIndex < 0 && this.pending.length > 0) pendingIndex = 0;
      const staged = pendingIndex >= 0 ? this.pending.splice(pendingIndex, 1)[0] : null;
      next.push({ message, attachments: staged ? [...staged.attachments] : [] });
    }

    this.current = next;
    return this.snapshot();
  }

  /** Remove a queue row when pi emits its authoritative delivered user message. */
  delivered(message: string): QueuedAttachmentEntry<T>[] {
    const index = this.current.findIndex((entry) => entry.message === message);
    if (index >= 0) this.current.splice(index, 1);
    return this.snapshot();
  }

  snapshot(): QueuedAttachmentEntry<T>[] {
    return this.current.map((entry) => ({
      message: entry.message,
      attachments: [...entry.attachments],
    }));
  }
}

/** Longest suffix of the old queue that is also a prefix of the new queue. */
function suffixPrefixOverlap(
  oldMessages: readonly string[],
  next: readonly string[],
): number {
  const max = Math.min(oldMessages.length, next.length);
  for (let length = max; length > 0; length--) {
    const oldStart = oldMessages.length - length;
    let equal = true;
    for (let index = 0; index < length; index++) {
      if (oldMessages[oldStart + index] !== next[index]) {
        equal = false;
        break;
      }
    }
    if (equal) return length;
  }
  return 0;
}

/** Match a clear_queue text snapshot with attachment payload captured before clearing. */
export function pairQueuedAttachments<T>(
  messages: readonly string[],
  snapshot: readonly QueuedAttachmentEntry<T>[],
): QueuedAttachmentEntry<T>[] {
  const remaining = snapshot.map((entry) => ({
    message: entry.message,
    attachments: [...entry.attachments],
  }));
  return messages.map((message) => {
    const index = remaining.findIndex((entry) => entry.message === message);
    if (index < 0) return { message, attachments: [] };
    const [entry] = remaining.splice(index, 1);
    return entry!;
  });
}

/** Remove only file markers represented by restored attachment chips. */
export function stripRestoredAttachmentMentions<T extends { path: string }>(
  message: string,
  attachments: readonly T[],
): string {
  if (attachments.length === 0) return message;
  const paths = new Set(attachments.map((attachment) => attachment.path));
  return message
    .split("\n\n")
    .filter((block) => {
      const match = /^\[attachment: (.+)\]$/.exec(block);
      return !match?.[1] || !paths.has(match[1]);
    })
    .join("\n\n")
    .trim();
}
