# @magiusche/pi-webview

A rich WebView UI for [pi](https://pi.dev), the coding agent — a modern alternative to running pi in a terminal. Built as a framework-agnostic web app, it works **standalone in the browser** and inside supported **IDE webviews** with the same codebase.

> ⚠️ **Experimental.** Actively developed. Things can break, change or disappear. Use it for exploration, not production.

## Implemented IDE companions

- **VS Code**
- **Visual Studio 2022**
- **Visual Studio 2026**

All three companions are included in the package and are automatically installed or updated when the corresponding IDE is present.

## Standalone (browser)

The package also includes the web UI and a local bridge, launchable from the shell with the `piw` binary (script on Linux/macOS, `piw.cmd` on Windows):

```bash
piw                 # starts the bridge, serves the UI and opens the browser
piw --port 8900     # fixed port (default: random port)
piw --ip 192.168.1.20 # also listens on this IPv4 address and on 127.0.0.1
piw --ip 0.0.0.0    # listens on every IPv4 interface (including loopback)
piw --no-open       # does not open the browser: prints the link to the console
piw --session <id>  # resumes a session (partial id or path)
piw --no-idle       # disables the automatic idle shutdown
piw --background    # starts detached in the background and opens the browser
piw -b              # same as --background
piw -k              # stops the background bridge (same as --kill)
```

`piw` resolves `pi` on the `PATH` (on Windows the `pi.cmd` shim), spawns it with `--mode rpc` and opens `http://127.0.0.1:<port>/`. A new session starts in the shell directory from which `piw` was invoked—even when reusing an existing bridge—and falls back to the user home if that directory is unavailable. Exit with Ctrl+C.

The default bind remains loopback-only. `--ip <IPv4>` (also accepted as `--host <IPv4>`) adds a specific local address while preserving `127.0.0.1`; `--ip 0.0.0.0` listens on every IPv4 interface. For a non-loopback bind, `piw` prints authenticated remote-access links. Treat those links as secrets: anyone who has one can operate pi with your local user permissions. Use this only on a trusted network, preferably behind a host firewall or private VPN. If the active single-instance bridge has a different binding, stop it with `piw -k` before restarting it with the desired `--ip`.

A reverse proxy on the same machine may keep `piw` loopback-only and forward HTTP/WebSocket traffic to it. The bridge trusts `X-Forwarded-For` and `X-Forwarded-Proto` only when the direct peer is loopback, so remote token checks remain active and HTTPS proxies receive a `wss://` URL.

### Public-access QR launcher

The cross-platform `piw-public` launcher starts `piw` on a requested port and IPv4 address with idle shutdown disabled, creates a **new authentication token**, and prints both the complete remote URL and a terminal QR code. The address can be supplied explicitly or detected through Tailscale:

```bash
piw-public 7361 --ip 192.168.1.20
piw-public 7361 --tailscale
piw-public 7361 --tailscale --wait # keep a shortcut-launched terminal open
```

If a managed `piw` bridge is already active, the launcher shows its port and asks for confirmation before stopping it. Declining leaves the existing bridge untouched; if no bridge is active, no confirmation is shown. A non-interactive invocation never stops an existing bridge because it cannot obtain confirmation. `--tailscale` requires the Tailscale CLI to be installed and connected; `--ip` has no Tailscale dependency. QR rendering is built in and does not require `qrencode`.

The generated URL contains a private bearer credential. Expose the selected address only on a trusted network and do not publish, log, or share the URL.

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

> **⚠️ The companions are checked at every pi start** — the check **blocks
> startup until it finishes** (pi.dev / the webview never start with a pending
> install). The check steps are silent while nothing is being done; the **first
> action** (install/update/error) flushes the whole trace immediately and the
> following steps are streamed as they happen — console,
> `~/.pi/pi-webview/companion-install.log` and notifications. When everything
> is already current the check is **totally silent**: no log lines, no
> notifications. The explicit commands `/piw install|reinstall|uninstall`
> **always log**: every step is streamed and the final recap (one notify)
> summarizes what was done with a **single reload hint per IDE** — never one
> per installed extension. The extension installs/updates the companions from
> the bundled VSIXes if missing or outdated — idempotent:
>
> - **VS Code** companion: checked always — the `code` CLI is resolved from
>   `PATH` or from the standard install locations, with a last-resort direct
>   extraction into the extensions folder (no CLI needed; silent when VS Code
>   is not installed);
> - **Visual Studio** companion (Windows only): detected via `vswhere.exe`,
>   installed per instance with `VSIXInstaller.exe /quiet /instanceIds:`
>   (VS 2022 + 2026; VS 2019 is out of the manifest range) when VS is present;
>   disable the automatic check with `PI_WEBVIEW_AUTO_INSTALL=0` (explicit
>   commands below are NOT affected).
>   You can also install explicitly with **`/piw install`** (or reinstall
>   with **`/piw reinstall`**) from a pi terminal: the command reports every
>   step as it runs (e.g. "VS Code: checking code CLI…", "Visual Studio
>   2026: installing 0.2.3 (per-user)…"), or manually
>   (`code --install-extension companion/pi-webview-ide.vsix`
>   / `VSIXInstaller /q companion/pi-webview-visualstudio.vsix` from the package
>   dir), then reload the window / restart Visual Studio.

Try it without installing permanently:

```bash
pi -e npm:@magiusche/pi-webview
```

### Launcher links (no install scripts)

This package has **no npm install scripts** (nothing to approve, no `npm warn install-scripts`). The `piw` and `piw-public` links on your `PATH` (`~/.local/bin/<name>`, or `%APPDATA%\npm\<name>.cmd` on Windows) are created together by the extension at the **first pi start** and re-created whenever either is missing. So: install the package, start pi once, and both launchers work. If you need them before the first pi start, just start pi or create the links manually.

### Uninstalling

`pi remove` cannot clean up by itself (no uninstall scripts in the package, and pi has no package-removal hook). Run this **inside pi** (while the extension is still loaded) — it removes everything and then uninstalls the package from pi itself:

```
/piw uninstall
```

It removes, in order:

1. the IDE companion extension (`magiusche.pi-webview-ide`, if installed in VS Code — via `code --uninstall-extension`),
2. the `piw` and `piw-public` links on your `PATH` (`~/.local/bin/<name>` / `%APPDATA%\npm\<name>.cmd` — only when they point to this package, never user files), and
3. the package itself from pi (`pi remove npm:@magiusche/pi-webview` — il prefisso `npm:` è richiesto, come per `pi install`).

Then **restart pi** to finish (and **reload the VS Code window** if the companion was removed).

If `pi remove` fails, or you already removed the package manually, do it by hand: `pi remove npm:@magiusche/pi-webview` (the `npm:` prefix is required). If launcher links remain as dangling symlinks, verify them with `ls -la` and remove `~/.local/bin/piw` and `~/.local/bin/piw-public` manually.

## How it works

The extension and standalone bridge run the **same centralized companion logic** (`ensureCompanions` in `src/bridge/companions.ts`):

- **`pi` start (the extension)**: (1) checks the **VS Code companion** against the bundled VSIX (installs/updates if missing or outdated; idempotent; the `code` CLI is resolved from `PATH` or known install locations, falling back to direct vsix extraction into the extensions folder when no CLI exists; silent when VS Code is not installed; disable with `PI_WEBVIEW_AUTO_INSTALL=0`), (2) checks the **Visual Studio companion** on Windows (vswhere → `VSIXInstaller /instanceIds:` for **each** VS 2022/2026 instance, silent when no VS or no bundled vsix) and (3) re-creates the **`piw` and `piw-public` links** on your `PATH` if either is missing (the package has no install scripts; it never touches user files, only its own links).
- **`piw` start (standalone bridge)**: runs the **same check for both companions** (VS Code + Visual Studio), printing the outcome to the console.

Every install/update/error is reported — in the pi.dev TUI and in the webview (via `ui.notify`, `pi-webview: …`) and on the `piw` console (`piw: …`). Only two cases stay silent: the target app is not installed, or the installed companion already matches the bundled VSIX.

The companion can also be installed explicitly:

```
/piw install
```

(or `code --install-extension companion/pi-webview-ide.vsix` from the package dir), then **reload the VS Code window** — a **pi** icon appears in the activity bar with the webview chat. Subcommands: `status | install | reinstall | uninstall | update.pi.core.exts` (`/piw` for the list). `install` installs only what is missing or outdated and ensures both launcher links; `reinstall` forces a full reinstall of the companions and re-creates both links. `uninstall` removes the companions and both links.

### Updating pi and the extensions

When the pi core is outdated, the webview shows a note in the new-session banner and an **update button in the header**. Clicking it (or typing the command) runs:

```
/piw update.pi.core.exts
```

which executes `pi update --all --approve` in a child process: it updates the pi core (the `@earendil-works/pi-coding-agent` npm package) and **all installed extensions/packages**, never prompting. The running pi keeps the old code in memory — **restart pi** to load the updated version (reload the IDE window for the companions).

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
- **Sessions** — switch, filter by folder, fork of sessions from other folders (same behavior as pi), new session; in standalone browser mode, a session from another workspace can instead move the current workspace to its original folder and resume there without a fork, and refreshing the browser resumes the same session in its saved workspace
- **Composer controls** — model picker, thinking level, project trust (writes `~/.pi/agent/trust.json`, with confirmation for full access)
- **Attachments** — paste or drag & drop of files and images, with inline previews
- **Editor selection context** — when pi-webview runs in the **sidebar view**, selecting text in the editor shows a discreet one-line selection block (attach context for your messages). **In editor-area panels** ("new chat in a new panel") the selection mode is **inhibited**: a webview panel steals editor focus, which would clear the attached selection — so the block is hidden there and selection works only from the sidebar.
- **Extension status** — status/widget lines set by pi extensions (`setStatus` / `setWidget`) rendered live in the chat footer; status placement and compact/multi-line layout are independent settings, and clicking a status source hides it after confirmation (hidden sources can be restored in settings)
- **Themes** (light/dark/system) and **i18n** (it/en)
- **Settings modal** — four groups: (1) info, (2) webview preferences (language, theme, history limit, notifications, status-bar position/compactness and hidden status sources), (3) staged pi.dev settings, including new-session model/thinking defaults, and (4) **pi.dev CLI launch flags**, listed **dynamically** from the flags registered by pi and its extensions (`pi --help` → "Extension CLI Flags", e.g. `--session-control` from pi-agent-extensions; a flag appears only if its extension is installed). Applying restart-backed changes resumes the current session transparently; if work is in progress pi asks for confirmation and dequeues/stops first.

  CLI flags are **per-session**: they are stored as a `pi-webview-cli-flags` custom entry **inside the session's `.jsonl` file** (last one wins — never in the shared settings), so each open session keeps its own flags and the settings storage never grows with the session count. New sessions start without flags; forks inherit the parent's flags entry.

## Security

Pi extensions run with your full system permissions and can execute arbitrary code. Review the source before installing — as you would with any third-party package.

## License

MIT. See [LICENSE](LICENSE).
