# @magiusche/pi-webview

A rich WebView UI for [pi](https://pi.dev), the coding agent — a modern alternative to running pi in a terminal. Built as a framework-agnostic web app, it works **standalone in the browser** and is designed to run inside an **IDE webview** (VS Code first) with the same codebase.

> ⚠️ **Experimental.** Actively developed. Things can break, change or disappear. Use it for exploration, not production.

## Standalone (browser)

The package also includes the web UI and a local bridge, launchable from the shell with the `piw` binary (script on Linux/macOS, `piw.cmd` on Windows):

```bash
piw                 # starts the bridge, serves the UI and opens the browser
piw --port 8900     # fixed port (default: random port)
piw --no-open       # does not open the browser: prints the link to the console
piw --session <id>  # resumes a session (partial id or path)
piw --no-idle       # disables the automatic idle shutdown
piw --background    # starts detached in the background and opens the browser
piw -b              # same as --background
piw -k              # stops the background bridge (same as --kill)
```

`piw` resolves `pi` on the `PATH` (on Windows the `pi.cmd` shim), spawns it with `--mode rpc` and opens `http://127.0.0.1:<port>/`. Exit with Ctrl+C.

### One bridge per system

`piw` is single-instance: if a bridge is already running, a new invocation **does not start a second one** — it just opens a new browser tab (with a new session). The active bridge is recorded in `~/.pi/pi-webview/bridge.json` and validated at every startup (pid + health check), so a crash never leaves a stale lock.

### Running in the background (fire-and-forget)

`piw` stays alive while the bridge is running. To detach it from the terminal, use the built-in switch (cross-platform, recommended):

```bash
piw --background          # starts the bridge in the background and opens the browser
piw -b                    # same as --background
piw -b --no-open          # background without the browser: prints the link instead
piw -k                    # stops the background bridge (reads the pid from the lock)
```

On Linux/macOS it re-launches itself detached (`setsid`-like), on Windows it runs hidden without a console window. The background process shuts down by itself with the automatic idle shutdown (see below).

Manual alternatives (if you prefer to manage it yourself):

- **Linux / macOS** (bash/zsh):
  ```bash
  nohup piw >/dev/null 2>&1 &
  ```
- **Windows** (cmd):
  ```cmd
  start /b piw
  ```
- **Windows** (PowerShell):
  ```powershell
  Start-Process -WindowStyle Hidden piw
  ```

To stop a background bridge, the recommended way is the built-in switch:

```bash
piw -k   # stops the bridge (reads the pid from the lock file and cleans up)
```

Manually, the pid is in the lock file:

```bash
cat ~/.pi/pi-webview/bridge.json   # reads the bridge pid
kill <pid>                          # Linux/macOS — on Windows: taskkill /PID <pid> /F
```

### Automatic shutdown

The bridge shuts down by itself after **1 minute with no open session** (no connected tab) — the browser connection is the activity signal, no keep-alive needed. The next `piw` starts it again. To disable it (debug): `piw --no-idle`.

## Install

```bash
pi install npm:@magiusche/pi-webview
```

> **⚠️ The VS Code companion is checked at every pi start** (the extension
> installs/updates it from the bundled VSIX if missing or outdated — idempotent,
> silent when `code` is not on `PATH`; disable with `PI_WEBVIEW_AUTO_INSTALL=0`).
> `piw` repeats the same check at its startup. You can also do it explicitly with
> **`/pi-webview install`** from a pi terminal, or manually
> (`code --install-extension companion/pi-webview-ide.vsix` from the package dir),
> then reload the window.

Try it without installing permanently:

```bash
pi -e npm:@magiusche/pi-webview
```

### The `piw` link (no install scripts)

This package has **no npm install scripts** (nothing to approve, no `npm warn install-scripts`). The `piw` link on your `PATH` (`~/.local/bin/piw`, or `%APPDATA%\npm\piw.cmd` on Windows) is created by the extension at the **first pi start** (and re-created at every pi start if missing). So: install the package, start pi once, and `piw` works. If you need `piw` before the first pi start, just start pi (or create the link manually).

### Uninstalling

`pi remove` cannot clean up by itself (no uninstall scripts in the package, and pi has no package-removal hook). Run this **inside pi** (while the extension is still loaded) — it removes everything and then uninstalls the package from pi itself:

```
/pi-webview uninstall
```

It removes, in order:

1. the IDE companion extension (`magiusche.pi-webview-ide`, if installed in VS Code — via `code --uninstall-extension`),
2. the `piw` link on your `PATH` (`~/.local/bin/piw` / `%APPDATA%\npm\piw.cmd` — only if it points to this package, never user files), and
3. the package itself from pi (`pi remove @magiusche/pi-webview`).

Then **restart pi** to finish (and **reload the VS Code window** if the companion was removed).

If `pi remove` fails, or you already removed the package manually, do it by hand: `pi remove @magiusche/pi-webview`; if the `piw` link is left behind (now a dangling symlink), remove it manually: `rm ~/.local/bin/piw` (it is a symlink; verify with `ls -la`).

## How it works

Two entry points, both ensuring the VS Code companion:

- **`pi` start (the extension)**: (1) checks the **VS Code companion** against the bundled VSIX (installs/updates with `--force` if missing or outdated; idempotent; silent when `code` is not on `PATH`; disable with `PI_WEBVIEW_AUTO_INSTALL=0`) and (2) re-creates the **`piw` link** on your `PATH` if missing (the package has no install scripts — this is the only way the link is created; it never touches user files, only its own link).
- **`piw` start (standalone bridge)**: repeats the **VS Code companion** check (same logic, same silence when `code` is missing).

The companion can also be installed explicitly:

```
/pi-webview install
```

(or `code --install-extension companion/pi-webview-ide.vsix` from the package dir), then **reload the VS Code window** — a **pi** icon appears in the activity bar with the webview chat. Subcommands: `status | install | reinstall | uninstall` (`/pi-webview` for the list). `uninstall` removes both the companion and the `piw` link.

The companion spawns `pi --mode rpc` and bridges the UI via `postMessage` (same UI and protocol as standalone; editor selection flows directly to the webview).

- **Standalone mode**: a Node bridge spawns `pi --mode rpc` and exposes it over a local WebSocket; open the UI in your browser.
- **IDE mode**: the same UI runs inside a VS Code webview via `postMessage` (transport-agnostic).

## Requirements

- Node.js >= 22.6
- VS Code ^1.90 (for the IDE companion)
- pi installed on the same machine

## Features

- **Full chat UI** — streaming markdown (`marked` + `DOMPurify`), thinking blocks with spinner and elapsed time, collapsible tool cards with command summaries, copy buttons
- **Sessions** — switch, filter by folder, fork of sessions from other folders (same behavior as pi), new session
- **Composer controls** — model picker, thinking level, project trust (writes `~/.pi/agent/trust.json`, with confirmation for full access)
- **Attachments** — paste or drag & drop of files and images, with inline previews
- **Extension status** — status/widget lines set by pi extensions (`setStatus` / `setWidget`) rendered live in the chat footer
- **Themes** (light/dark/system) and **i18n** (it/en)

## Security

Pi extensions run with your full system permissions and can execute arbitrary code. Review the source before installing — as you would with any third-party package.

## License

MIT. See [LICENSE](LICENSE).
