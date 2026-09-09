export interface ToolArgumentEntry {
  key: string;
  value: string;
}

export interface EditArgumentPair {
  search: string;
  replace: string;
}

export interface ShellArgumentView {
  command: string;
  timeout: string | null;
}

function argumentValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function argumentObject(raw: unknown): Record<string, unknown> | null {
  let parsed = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export function readArgumentEntries(raw: unknown): ToolArgumentEntry[] {
  const parsed = argumentObject(raw);
  if (!parsed) return [];
  return Object.entries(parsed)
    .filter(([key]) => key !== "command")
    .map(([key, value]) => ({ key, value: argumentValue(value) }));
}

export function writeArgumentContent(raw: unknown): string | null {
  const parsed = argumentObject(raw);
  return typeof parsed?.content === "string" ? parsed.content : null;
}

export function editArgumentPath(raw: unknown): string | null {
  const parsed = argumentObject(raw);
  return typeof parsed?.path === "string" ? parsed.path : null;
}

export function editArgumentPairs(raw: unknown): EditArgumentPair[] {
  const parsed = argumentObject(raw);
  if (!parsed || !Array.isArray(parsed.edits)) return [];
  return parsed.edits.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [];
    }
    const edit = candidate as Record<string, unknown>;
    if (typeof edit.oldText !== "string" || typeof edit.newText !== "string") return [];
    return [{ search: edit.oldText, replace: edit.newText }];
  });
}

export function shellArgumentView(raw: unknown): ShellArgumentView | null {
  const parsed = argumentObject(raw);
  if (!parsed || typeof parsed.command !== "string") return null;
  const timeout = parsed.timeout;
  return {
    command: parsed.command,
    timeout:
      typeof timeout === "number" || typeof timeout === "string" ? String(timeout) : null,
  };
}

export function shellResultExitCode(
  output: string,
  isError: boolean,
  explicitCode?: unknown,
): number | null {
  if (typeof explicitCode === "number" && Number.isFinite(explicitCode)) {
    return explicitCode;
  }
  if (!isError) return 0;
  const match = /(?:^|\n)Command exited with code (-?\d+)\s*$/.exec(output);
  return match ? Number(match[1]) : null;
}
