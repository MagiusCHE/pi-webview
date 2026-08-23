// Apre il browser di default in modo cross-platform (concept 0002 D6).
import { spawn } from "node:child_process";

export function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {
    // niente browser disponibile: l'utente apre l'URL a mano
  });
  child.unref();
}
