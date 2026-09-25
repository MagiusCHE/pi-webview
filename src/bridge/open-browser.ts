// Open the default browser without letting cmd.exe split URLs at `&` on Windows.
import { spawn } from "node:child_process";

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === "win32") {
    // `start` takes the first quoted argument as a window title. Quote the URL
    // separately, and pass the quotes verbatim so cmd keeps its query intact.
    return {
      command: "cmd",
      args: ["/d", "/c", "start", '""', `"${url.replace(/"/g, "%22")}"`],
      windowsVerbatimArguments: true,
    };
  }
  return platform === "darwin"
    ? { command: "open", args: [url] }
    : { command: "xdg-open", args: [url] };
}

export function openBrowser(url: string): void {
  const { command, args, windowsVerbatimArguments } = browserOpenCommand(url);
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    ...(windowsVerbatimArguments ? { windowsVerbatimArguments } : {}),
  });
  child.on("error", () => {
    // The printed URL remains available if no browser can be opened.
  });
  child.unref();
}
