// Message timestamp label shared by the whole web UI (standalone bridge, IDE
// companions, Chrome side panel). A session can span several days, so the short
// label is relative to today: time only for today, "yesterday 21:42" for the
// previous day, and a date prefix for anything older (with the year when it is
// not the current one). The full label always carries date, time and seconds.

export interface MessageTimeLabel {
  /** Compact label shown in the transcript on hover. */
  short: string;
  /** Complete localized date and time for the tooltip. */
  full: string;
  /** Machine-readable value for the `datetime` attribute. */
  iso: string;
}

export interface MessageTimeOptions {
  locale: string;
  /** Localized word for "yesterday", injected by the caller (i18n). */
  yesterday: string;
  /** Localized separator between the date and the clock of older messages. */
  dateSeparator?: string;
  /** 12-hour clock when true; 24-hour (default) otherwise. */
  hour12?: boolean;
  /** Reference instant, injectable for tests. */
  now?: number;
}

function startOfDay(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export function messageTimeLabel(
  timestamp: number,
  options: MessageTimeOptions,
): MessageTimeLabel {
  const { locale } = options;
  const date = new Date(timestamp);
  const now = new Date(options.now ?? Date.now());
  // explicit hourCycle: the locale default (12h in en-US) never overrides the
  // user preference, and the tooltip obeys the same choice as the short label
  const hourCycle = options.hour12 ? "h12" : "h23";
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle,
  }).format(date);
  const full = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle,
  }).format(date);
  const days = Math.round((startOfDay(now.getTime()) - startOfDay(timestamp)) / DAY_MS);

  let short: string;
  if (days <= 0) {
    short = time;
  } else if (days === 1) {
    short = `${options.yesterday} ${time}`;
  } else {
    const sameYear = date.getFullYear() === now.getFullYear();
    const day = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(date);
    short = `${day}${options.dateSeparator ?? ", "}${time}`;
  }

  return { short, full, iso: date.toISOString() };
}
