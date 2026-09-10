export interface SlashCommand {
  name: string;
  description?: string;
}

export interface RpcSlashCommand {
  name?: string;
  description?: string;
  source?: string;
}

export function normalizeExtensionCommands(commands: RpcSlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  const normalized: SlashCommand[] = [];
  for (const command of commands) {
    if (command.source !== "extension" || typeof command.name !== "string") continue;
    const name = command.name.replace(/^\/+/, "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ name, description: command.description ?? "" });
  }
  return normalized;
}

export function slashCommandName(input: string): string | null {
  return /^\/([^\s/]+)(?=\s|$)/.exec(input.trim())?.[1]?.toLowerCase() ?? null;
}

export function isKnownSlashCommand(input: string, commands: SlashCommand[]): boolean {
  const name = slashCommandName(input);
  return name !== null && commands.some((command) => command.name.toLowerCase() === name);
}
