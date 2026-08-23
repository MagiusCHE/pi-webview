// Sunto dell'header delle card dei tool: il nome del tool (accent) e gli
// argomenti attenuati (muted). Nessuna troncatura JS: è il CSS (ellipsis su
// una riga) a tagliare usando tutto lo spazio disponibile. Per i tool file
// (read/edit/write/...) il percorso è reso relativo al workspace (./…).

export interface ToolSummary {
  name: string;
  args: string; // vuoto se non c'è un sunto utile
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
  // percorso relativo al workspace: /ws/proj/src/x.ts → ./src/x.ts
  const rel = (p: string): string => {
    if (!workspace || !p) return p;
    const ws = workspace.replace(/[\\/]+$/, "");
    if (p.startsWith(ws)) {
      const rest = p.slice(ws.length).replace(/^[\\/]+/, "");
      return rest ? `./${rest}` : "./";
    }
    return p;
  };

  switch (name) {
    case "bash": {
      const cmd = str("command");
      // come pi.dev: "$" evidenziato (accent nel nome), comando attenuato
      // negli args — senza la parola "bash"
      if (!cmd) return { name: "$", args: "" };
      return { name: "$", args: cmd };
    }
    case "read": {
      const path = rel(str("path") || str("filePath"));
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
        return { name, args: `${range} ${path}`.trim() };
      }
      return { name, args: path };
    }
    case "edit":
    case "edit-diff":
    case "write": {
      return { name, args: rel(str("path") || str("filePath")) };
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
