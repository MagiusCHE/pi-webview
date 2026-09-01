// Summary of the tool card headers: the tool name (accent) and the muted
// arguments. No JS truncation: the CSS (single-line ellipsis) does the cutting
// using all the available space. For file tools (read/edit/write/...) the path
// is made relative to the workspace (./…).

export interface ToolSummary {
  name: string;
  args: string; // empty when there is no useful summary
  /** Original path sent by read/edit/write, used by the host-side open-file action. */
  filePath?: string;
}

function relativeToolPath(path: string, workspace?: string): string {
  if (!workspace || !path) return path;
  const ws = workspace.replace(/[\\/]+$/, "");
  if (path.startsWith(ws)) {
    const rest = path.slice(ws.length).replace(/^[\\/]+/, "");
    return rest ? `./${rest}` : "./";
  }
  return path;
}

function partialJsonString(fragment: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(fragment);
  if (!match || match.index === undefined) return "";
  const start = match.index + match[0].length - 1;
  for (let index = start + 1; index < fragment.length; index += 1) {
    const char = fragment[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char !== '"') continue;
    try {
      const value = JSON.parse(fragment.slice(start, index + 1)) as unknown;
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }
  return "";
}

// File-tool paths normally arrive before the potentially large edit/write
// payload. Extract the first complete JSON string without waiting for the
// enclosing object to finish streaming.
export function streamedToolFilePath(name: string, argsFragment: string): string {
  if (name !== "read" && name !== "edit" && name !== "edit-diff" && name !== "write")
    return "";
  return (
    partialJsonString(argsFragment, "path") || partialJsonString(argsFragment, "filePath")
  );
}

export function streamedToolPath(
  name: string,
  argsFragment: string,
  workspace?: string,
): string {
  return relativeToolPath(streamedToolFilePath(name, argsFragment), workspace);
}

export function toolSummary(
  name: string,
  argsJson: string,
  workspace?: string,
): ToolSummary {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return { name, args: "" };
  }

  const str = (k: string): string =>
    typeof args[k] === "string" ? (args[k] as string) : "";
  const num = (k: string): number | undefined =>
    typeof args[k] === "number" ? (args[k] as number) : undefined;
  const rel = (path: string): string => relativeToolPath(path, workspace);

  switch (name) {
    case "bash": {
      const cmd = str("command");
      // like pi.dev: "$" highlighted (accent in the name), command muted
      // in the args — without the word "bash"
      if (!cmd) return { name: "$", args: "" };
      return { name: "$", args: cmd };
    }
    case "read": {
      const filePath = str("path") || str("filePath");
      const path = rel(filePath);
      const startLine = num("startLine");
      const endLine = num("endLine");
      const offset = num("offset");
      const length = num("length");
      const hasRange =
        startLine !== undefined ||
        endLine !== undefined ||
        offset !== undefined ||
        length !== undefined;
      if (hasRange) {
        const start = startLine ?? offset ?? 0;
        const end =
          endLine ??
          (offset !== undefined && length !== undefined ? offset + length : undefined);
        const range = end !== undefined ? `[${start}-${end}]` : `[${start}-…]`;
        return {
          name,
          args: `${path} ${range}`.trim(),
          filePath: filePath || undefined,
        };
      }
      return { name, args: path, filePath: filePath || undefined };
    }
    case "edit":
    case "edit-diff":
    case "write": {
      const filePath = str("path") || str("filePath");
      return { name, args: rel(filePath), filePath: filePath || undefined };
    }
    case "grep":
    case "find": {
      const pattern = str("pattern");
      const path = rel(str("path") || str("filePath"));
      return { name, args: [pattern, path].filter(Boolean).join(" · ") };
    }
    case "ls": {
      return { name, args: rel(str("path")) };
    }
    default: {
      // generico: primo argomento stringa significativo
      for (const v of Object.values(args)) {
        if (typeof v === "string" && v.trim()) {
          return { name, args: v.trim() };
        }
      }
      return { name, args: "" };
    }
  }
}
