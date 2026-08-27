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

> **⚠️ The companions are checked at every pi start** (the extension
> installs/updates them from the bundled VSIXes if missing or outdated —
> idempotent, silent when the target IDE is not installed):
>
> - **VS Code** companion: checked always — the `code` CLI is resolved from
>   `PATH` or from the standard install locations, with a last-resort direct
>   extraction into the extensions folder (no CLI needed; silent when VS Code
>   is not installed);
> - **Visual Studio** companion (Windows only): detected via `vswhere.exe`,
>   installed per instance with `VSIXInstaller.exe /quiet /instanceIds:`
>   (VS 2022 + 2026; VS 2019 is out of the manifest range) when VS is present;
>   disable all auto-install with `PI_WEBVIEW_AUTO_INSTALL=0`.
>   You can also install explicitly with **`/pi-webview install`** from a pi
>   terminal, or manually (`code --install-extension companion/pi-webview-ide.vsix`
>   / `VSIXInstaller /q companion/pi-webview-visualstudio.vsix` from the package
>   dir), then reload the window / restart Visual Studio.

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
3. the package itself from pi (`pi remove npm:@magiusche/pi-webview` — il prefisso `npm:` è richiesto, come per `pi install`).

Then **restart pi** to finish (and **reload the VS Code window** if the companion was removed).

If `pi remove` fails, or you already removed the package manually, do it by hand: `pi remove npm:@magiusche/pi-webview` (il prefisso `npm:` è richiesto); if the `piw` link is left behind (now a dangling symlink), remove it manually: `rm ~/.local/bin/piw` (it is a symlink; verify with `ls -la`).

## How it works

Both entry points run the **same centralized companion logic** (`ensureCompanions` in `src/bridge/companions.ts`):

- **`pi` start (the extension)**: (1) checks the **VS Code companion** against the bundled VSIX (installs/updates if missing or outdated; idempotent; the `code` CLI is resolved from `PATH` or known install locations, falling back to direct vsix extraction into the extensions folder when no CLI exists; silent when VS Code is not installed; disable with `PI_WEBVIEW_AUTO_INSTALL=0`), (2) checks the **Visual Studio companion** on Windows (vswhere → `VSIXInstaller /instanceIds:` for **each** VS 2022/2026 instance, silent when no VS or no bundled vsix) and (3) re-creates the **`piw` link** on your `PATH` if missing (the package has no install scripts — this is the only way the link is created; it never touches user files, only its own link).
- **`piw` start (standalone bridge)**: runs the **same check for both companions** (VS Code + Visual Studio), printing the outcome to the console.

Every install/update/error is reported — in the pi.dev TUI and in the webview (via `ui.notify`, `pi-webview: …`) and on the `piw` console (`piw: …`). Only two cases stay silent: the target app is not installed, or the installed companion already matches the bundled VSIX.

The companion can also be installed explicitly:

```
/pi-webview install
```

(or `code --install-extension companion/pi-webview-ide.vsix` from the package dir), then **reload the VS Code window** — a **pi** icon appears in the activity bar with the webview chat. Subcommands: `status | install | reinstall | uninstall` (`/pi-webview` for the list). `uninstall` removes both the companion and the `piw` link.

The companion spawns `pi --mode rpc` and bridges the UI via `postMessage` (same UI and protocol as standalone; editor selection flows directly to the webview).

- **Standalone mode**: a Node bridge spawns `pi --mode rpc` and exposes it over a local WebSocket; open the UI in your browser.
- **IDE mode**: the same UI runs inside a VS Code webview via `postMessage` or inside a Visual Studio WebView2 tool window "pi" (virtual host `piw.local`, `window.chrome.webview`) — transport-agnostic.

## Requirements

- Node.js >= 22.6
- VS Code ^1.90 (for the VS Code companion)
- Visual Studio 2022/2026 (for the VS companion, Windows only — the vsix is included in the package)
- pi installed on the same machine

## Features

- **Full chat UI** — streaming markdown (`marked` + `DOMPurify`), thinking blocks with spinner and elapsed time, collapsible tool cards with command summaries, copy buttons
- **Sessions** — switch, filter by folder, fork of sessions from other folders (same behavior as pi), new session
- **Composer controls** — model picker, thinking level, project trust (writes `~/.pi/agent/trust.json`, with confirmation for full access)
- **Attachments** — paste or drag & drop of files and images, with inline previews
- **Editor selection context** — when pi-webview runs in the **sidebar view**, selecting text in the editor shows a discreet one-line selection block (attach context for your messages). **In editor-area panels** ("new chat in a new panel") the selection mode is **inhibited**: a webview panel steals editor focus, which would clear the attached selection — so the block is hidden there and selection works only from the sidebar.
- **Extension status** — status/widget lines set by pi extensions (`setStatus` / `setWidget`) rendered live in the chat footer
- **Themes** (light/dark/system) and **i18n** (it/en)
- **Settings modal** — three groups: (1) webview preferences (language, theme, history limit, version), (2) pi.dev `/settings` (placeholder — managed from the pi terminal), (3) **pi.dev CLI launch flags**, listed **dynamically** from the flags registered by pi and its extensions (`pi --help` → "Extension CLI Flags", e.g. `--session-control` from pi-agent-extensions; a flag appears only if its extension is installed). Boolean flags are toggles; string flags are shown as not-yet-supported. Changes reveal an **Apply** button that **restarts pi transparently** with the new command line (no webview reload): the current session is resumed, and if work is in progress pi asks for confirmation and dequeues/stops first.

  CLI flags are **per-session**: they are stored as a `pi-webview-cli-flags` custom entry **inside the session's `.jsonl` file** (last one wins — never in the shared settings), so each open session keeps its own flags and the settings storage never grows with the session count. New sessions start without flags; forks inherit the parent's flags entry.

## Security

Pi extensions run with your full system permissions and can execute arbitrary code. Review the source before installing — as you would with any third-party package.

## License

MIT. See [LICENSE](LICENSE).
