// Shared discovery and argument handling for pi extension CLI flags.
// Used by standalone piw and the VS Code companion.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliFlagInfo, CliFlags } from "../ide/protocol.ts";
import { resolveDirectNode } from "./spawn.ts";

const execFileAsync = promisify(execFile);

export function parseAvailableCliFlags(help: string): CliFlagInfo[] {
  const out = help.replace(/\x1b\[[0-9;]*m/g, "");
  const section = out.split("Extension CLI Flags:")[1]?.split(/\n\s*\n/)[0] ?? "";
  const flags: CliFlagInfo[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match = /^\s*--([a-z0-9-]+)( <value>)?\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    flags.push({
      name: match[1] ?? "",
      type: match[2] ? "string" : "boolean",
      description: match[3] ?? "",
    });
  }
  return flags;
}

export function cliFlagArgs(flags: CliFlags): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(flags)) {
    if (value === true) args.push(`--${name}`);
    else if (typeof value === "string" && value !== "") args.push(`--${name}`, value);
  }
  return args;
}

async function readPiHelp(piCommand: string): Promise<string> {
  const direct = resolveDirectNode(piCommand);
  if (direct) {
    const { stdout } = await execFileAsync(direct.node, [direct.script, "--help"], {
      timeout: 15_000,
      windowsHide: true,
    });
    return String(stdout);
  }

  if (process.platform === "win32") {
    // A custom pi command may still be a .cmd/.bat that cannot be executed
    // directly by execFile. Quote the complete command line through cmd.exe.
    const cmdLine = [piCommand, "--help"]
      .map((arg) => (/\s|"/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg))
      .join(" ");
    const { stdout } = await execFileAsync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `"${cmdLine}"`],
      {
        timeout: 15_000,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
    return String(stdout);
  }

  const { stdout } = await execFileAsync(piCommand, ["--help"], { timeout: 15_000 });
  return String(stdout);
}

export async function fetchAvailableCliFlags(
  piCommand: string,
  onError?: (message: string) => void,
): Promise<CliFlagInfo[]> {
  try {
    return parseAvailableCliFlags(await readPiHelp(piCommand));
  } catch (err) {
    onError?.(
      `CLI flag discovery failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
