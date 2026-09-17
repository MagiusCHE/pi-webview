# @magiusche/pi-webview

A rich WebView UI for [pi](https://pi.dev), the coding agent — a modern alternative to running pi in a terminal. Built as a framework-agnostic web app, it works **standalone in the browser** and inside supported **IDE webviews** with the same codebase.

![pi-webview in VS Code](https://raw.githubusercontent.com/MagiusCHE/pi-webview/main/media/pi-webview-preview.jpg)

![pi-webview standalone in the browser](https://raw.githubusercontent.com/MagiusCHE/pi-webview/main/media/pi-webview-standalone.jpg)

![Composer and extension status in the webview UI](https://raw.githubusercontent.com/MagiusCHE/pi-webview/main/media/pi-webview-status.jpg)

> ⚠️ **Experimental.** Actively developed. Things can break, change or disappear. Use it for exploration, not production.

## Implemented companions

- **VS Code**
- **Visual Studio 2022**
- **Visual Studio 2026**
- **Google Chrome** — Side Panel companion; Chrome Web Store publication pending

The three IDE companions are included in the package and installed or updated automatically when the corresponding IDE is present. Chrome requires the installation confirmation imposed by the browser; `/piw install` opens the official Web Store flow when available, or the guided local installation during development.

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
piw --install-chrome # opens the official Chrome installation flow
piw --uninstall-chrome # opens Chrome extension management for removal
```

`piw` resolves `pi` on the `PATH` (on Windows the `pi.cmd` shim), spawns it with `--mode rpc` and opens `http://127.0.0.1:<port>/`. A new session starts in the shell directory from which `piw` was invoked—even when reusing an existing bridge—and falls back to the user home if that directory is unavailable. Exit with Ctrl+C.

The default bind remains loopback-only. `--ip <IPv4>` (also accepted as `--host <IPv4>`) adds a specific local address while preserving `127.0.0.1`; `--ip 0.0.0.0` listens on every IPv4 interface. For a non-loopback bind, `piw` prints authenticated remote-access links. Treat those links as secrets: anyone who has one can operate pi with your local user permissions. Use this only on a trusted network, preferably behind a host firewall or private VPN. If the active single-instance bridge has a different binding, stop it with `piw -k` before restarting it with the desired `--ip`.

A reverse proxy on the same machine may keep `piw` loopback-only and forward HTTP/WebSocket traffic to it. The bridge trusts `X-Forwarded-For` and `X-Forwarded-Proto` only when the direct peer is loopback, so remote token checks remain active and HTTPS proxies receive a `wss://` URL.

### Chrome Side Panel companion

The Chrome companion runs the same chat UI in the browser’s Side Panel. It connects to a `piw` server that is already running and does not start or stop it.

Its connection setting accepts a complete HTTP or HTTPS URL and defaults to:

```text
http://127.0.0.1:7361
```

Authenticated URLs printed by `piw-public`, including HTTP addresses over Tailscale, are supported. The complete URL can contain a private token and is stored only in Chrome’s local extension storage. Session-resume intents are stored separately, so the settings field always contains only the endpoint entered by the user. If the connection fails, the panel explains the problem before opening connection settings.

A direct Side Panel connection starts new sessions in the operating-system user’s home directory. Resumed sessions keep the workspace stored in their session header, while an accepted handoff keeps the standalone session’s current workspace.

When the standalone UI detects the enabled companion, it asks whether to move the current session into the Side Panel before loading config, sessions and history. An accepted handoff reuses the existing bridge channel and pi process; as soon as the bridge confirms atomic adoption, Chrome replaces the original standalone tab with a normal New Tab without waiting for the panel history loader.

The composer shows the active page favicon and title, with the page URL on hover. URL and title remain prompt context even when no text is selected. A current selection is added to the same visible context chip.

Where Chrome exposes a usable speech engine, dictation opens a short pi-webview permission window only after an explicit action in the Side Panel. Chrome asks for microphone access only when the user selects **Allow microphone** in that window. It captures only the selected microphone input—never tab, desktop, meeting or file audio—and does not record or send raw audio to `piw`. Cloud transcription remains off until the user explicitly enables it.

The agent gains nine browser tools while running through `piw`:

- `browser_page_dom` serializes the complete active-page DOM. Large results are saved in a private temporary file on the piw machine;
- `browser_page_element_dom` serializes only the element matching a known CSS selector, avoiding repeated full-page reads;
- `browser_page_screenshot` captures the visible viewport as an image result;
- `browser_page_class` adds or removes CSS class tokens on selected elements;
- `browser_page_style` sets or removes validated inline CSS properties on selected elements;
- `browser_page_click` clicks the element visually covering a selected control, clicks the selected node directly, or uses viewport CSS coordinates as a controlled fallback;
- `browser_page_navigation` reloads the active page or navigates its tab to an absolute HTTP/HTTPS URL through Chrome's Tabs API;
- `browser_page_scroll` scrolls the page or a container by bounded deltas, or brings a selected element into view;
- `browser_page_action` performs a validated sequence of click, type, select, focus and scroll actions. None of these tools evaluates arbitrary JavaScript.

Complete and targeted DOM reads share the DOM authorization. Screenshot access remains independent. Selector/visual/coordinate clicks, type/select/focus/scroll actions, reload/navigation and CSS-class/inline-style mutations share the page-action authorization. For each operation, the user can authorize the current pi session, the current website across sessions, or every website globally. The first page-action request shows its targets, coordinates and value previews and explains that later sequences run without another prompt within the selected scope. Session grants live inside the pi session; site and global grants live in piw config and can be reset from the Chrome-only settings. Navigation accepts only absolute HTTP/HTTPS URLs. Pointer actions are synthetic DOM events: the companion does not request Chrome's `debugger` permission or use CDP. Chrome-protected pages cannot be read, captured or controlled.

Once the Web Store listing is approved, install it with:

```bash
piw --install-chrome
```

Chrome opens the Web Store listing and requires the normal browser confirmation. `piw --uninstall-chrome` opens Chrome’s extension manager for user-confirmed removal.

Until the Web Store listing is approved, developers can run `pnpm package:chrome`, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/pi-webview-chrome`.

### Browser-local attachments

The paperclip in standalone mode opens the browser’s native file picker. This matters when the browser and bridge run on different machines: the picker shows files from the **browser device**, never the remote bridge filesystem. The browser reads the selected files and uploads their name, MIME type and bytes; it does not send a local path. The bridge stores a temporary copy so pi and its tools can access it.

Paste, drag and drop, multiple selection and image previews use the same upload path. In VS Code the paperclip continues to use the IDE’s native file dialog.

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

On the first start after an install or update, pi-webview shows one informational card, styled like the Context / Skills / Extensions startup summary. It lists every available mode—Browser View (`piw` / `piw-public`), the automatically managed VS Code and Visual Studio companions, and the [Google Chrome Side Panel companion](https://chromewebstore.google.com/detail/hcdjfkcgojomhpmcfgipginghhlncamn)—followed by the English notes for that version from the bundled [`CHANGELOG.md`](https://github.com/MagiusCHE/pi-webview/blob/main/CHANGELOG.md), with a localized heading. The reminder is stored outside conversation sessions and is not repeated for the same version.

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
>   `PATH` or from the standard install locations. Without the CLI, the bundled
>   VSIX is extracted directly and safely into every detected desktop or VS Code
>   Server extensions directory, including Remote SSH and Insiders variants;
>   no external archive command is required, and the check stays silent when no
>   VS Code installation is detected;
> - **Visual Studio** companion (Windows only): detected via `vswhere.exe`,
>   installed per instance with `VSIXInstaller.exe /quiet /instanceIds:`
>   (VS 2022 + 2026; VS 2019 is out of the manifest range) when VS is present;
> - **Chrome** companion: `/piw install` opens the browser-managed installation
>   flow. Chrome always requires the user’s confirmation; the package does not
>   claim a silent installation;
>   disable the automatic IDE check with `PI_WEBVIEW_AUTO_INSTALL=0` (explicit
>   commands below are NOT affected).
>   You can also install explicitly with **`/piw install`** (or reinstall
>   with **`/piw reinstall`**) from a pi terminal: the command reports every
>   step as it runs (e.g. "VS Code: checking code CLI…", "Visual Studio
>   2026: installing the bundled version (per-user)…"), or manually
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

1. the IDE companion extension (`magiusche.pi-webview-ide`, if installed in VS Code — via `code --uninstall-extension`, or directly from every detected desktop/Server extensions directory when the CLI is unavailable), and opens Chrome’s extension manager so the browser companion can be removed with Chrome’s required confirmation;
2. the `piw` and `piw-public` links on your `PATH` (`~/.local/bin/<name>` / `%APPDATA%\npm\<name>.cmd` — only when they point to this package, never user files), and
3. the package itself from pi (`pi remove npm:@magiusche/pi-webview` — il prefisso `npm:` è richiesto, come per `pi install`).

Then **restart pi** to finish (and **reload the VS Code window** if the companion was removed).

If `pi remove` fails, or you already removed the package manually, do it by hand: `pi remove npm:@magiusche/pi-webview` (the `npm:` prefix is required). If launcher links remain as dangling symlinks, verify them with `ls -la` and remove `~/.local/bin/piw` and `~/.local/bin/piw-public` manually.

## How it works

The extension and standalone bridge run the **same centralized companion logic** (`ensureCompanions` in `src/bridge/companions.ts`):

- **`pi` start (the extension)**: (1) checks the **VS Code companion** against the bundled VSIX (installs/updates if missing or outdated; idempotent; the `code` CLI is resolved from `PATH` or known install locations, falling back to safe in-process VSIX extraction across detected desktop and VS Code Server/Remote SSH extension directories when no CLI exists; silent when VS Code is not installed; disable with `PI_WEBVIEW_AUTO_INSTALL=0`), (2) checks the **Visual Studio companion** on Windows (vswhere → `VSIXInstaller /instanceIds:` for **each** VS 2022/2026 instance, silent when no VS or no bundled vsix) and (3) re-creates the **`piw` and `piw-public` links** on your `PATH` if either is missing (the package has no install scripts; it never touches user files, only its own links).
- **`piw` start (standalone bridge)**: runs the same silent IDE companion check (VS Code + Visual Studio), printing an outcome only when work is required. Browser installation remains an explicit, user-confirmed action.

Every install/update/error is reported — in the pi.dev TUI and in the webview (via `ui.notify`, `pi-webview: …`) and on the `piw` console (`piw: …`). Only two cases stay silent: the target app is not installed, or the installed companion already matches the bundled VSIX.

The companion can also be installed explicitly:

```
/piw install
```

(or `code --install-extension companion/pi-webview-ide.vsix` from the package dir), then **reload the VS Code window** — a **pi** icon appears in the activity bar with the webview chat. Subcommands: `status | install | reinstall | uninstall | update.check | update.pi.core.exts` (`/piw` for the list). `install` installs only what is missing or outdated and ensures both launcher links; `reinstall` forces a full reinstall of the companions and re-creates both links. `uninstall` removes the companions and both links.

### Updating pi and the extensions

The shield in the header is always visible. Every pi process performs a fresh, non-blocking registry check for pi core and npm-installed extensions; results are not cached:

- **blue shield**: everything is current. Clicking it runs `/piw update.check` immediately and refreshes the result in place;
- **yellow animated shield**: updates are available. Clicking it opens a review dialog before running `/piw update.pi.core.exts`.

The update command executes `pi update --all --approve` in a child process. It updates the `@earendil-works/pi-coding-agent` core package and all installed npm extensions without prompting. Local and git extension sources are intentionally excluded from registry comparisons.

If npm stops an update with `EALLOWREMOTE` because an extension depends directly on a remote URL, the **Webview** settings include **Allow remote npm dependencies during updates**. Enabling it requires confirmation of a supply-chain warning; while enabled, only Webview-started update child processes receive `npm_config_allow_remote=all`. The npm override is not applied to pi, the bridge, the IDE, or terminal-started updates. The chat suggests this setting when it recognizes the corresponding npm failure.

npm can also complete an update while warning that dependency install scripts were blocked by `allowScripts`. The chat reports this condition and points to the separate **Allow all npm install scripts during updates** Webview setting. Enabling it requires confirmation of the arbitrary-code-execution risk and adds `npm_config_dangerously_allow_all_scripts=true` only to Webview-started update child processes. This bypass allows every dependency lifecycle script, including explicitly denied ones; leave it disabled unless every involved package is trusted.

The running process keeps its loaded code until pi is restarted. The reload button in the header restarts pi, resumes the current session and reloads the page or IDE webview. In standalone mode the page reload is local and still happens if the bridge connection has already dropped; restarting pi is best-effort in that case.

The companion spawns `pi --mode rpc` and bridges the UI via `postMessage` (same UI and protocol as standalone; editor selection flows directly to the webview).

- **Standalone mode**: a Node bridge spawns `pi --mode rpc` and exposes it over a local WebSocket; open the UI in your browser.
- **IDE mode**: the same UI runs inside a VS Code webview via `postMessage` or inside a Visual Studio WebView2 tool window "pi" (virtual host `piw.local`, `window.chrome.webview`) — transport-agnostic.

## Requirements

- Node.js >= 22.6
- VS Code ^1.90 (for the VS Code companion)
- Visual Studio 2022/2026 (for the VS companion, Windows only — the vsix is included in the package)
- Google Chrome 116 or newer (for the Side Panel companion)
- pi installed on the same machine as `piw`

## Features

- **Full chat UI** — streaming Markdown (`marked` + `DOMPurify`), thinking with elapsed time, collapsible tool cards, copy actions and smart auto-scroll
- **Agentic thinking** — optional global presentation mode, disabled by default. It groups each consecutive thinking/tool chain in one collapsible block with a global spinner, elapsed timer and live counters for `thought`, `read`, `write` (`write` + `edit`), `bash` and other `tools`. Thinking remains expanded inside the block; individual tools keep their normal collapsible behavior. Visible assistant text, `ask_user`, compaction and injected steering messages close the current thought/Agentic chain; later internal activity starts a new block. Internal-only messages do not create empty assistant wrappers. Before the first real thought/tool, the live header shows `Waiting for response` one second after processing starts; it changes to `Agentic thinking` only when internal activity actually begins
- **Final tool outputs** — if the agent run ends with tool results and no later visible assistant response, the final tool batch is promoted outside the Agentic block as the chat response. Plain text, JSON, fenced code, images, files, audio/video and resource links use dedicated renderers; images have a lightbox and download, files can be downloaded or opened through the host. Resume/reload reconstructs the same presentation
- **Sessions** — switch, rename, delete, filter by folder, fork across workspaces and create new sessions. Confirmed session-changing operations immediately show the loading overlay and lock the complete UI until the refreshed history is ready. Resume summaries include relative activity, compaction count and session-file size. Browser refresh resumes the same session in its saved workspace
- **Composer controls** — model picker, thinking level and project trust. The trust chip always shows the effective status of the running pi process (trusted / untrusted): pi never prompts in RPC mode, so with no saved decision the project-local resources are ignored. Clicking it opens the same choices as the pi terminal prompt (Trust / Trust parent folder / Trust this session only / Do not trust / Do not trust this session only); a session-only choice is not persisted and starts pi with `--approve` / `--no-approve` for that process only. A new decision is applied by restarting pi: the restart is automatic on an idle session, otherwise the dialog asks for _Restart now_ / _Restart later_, and a red `!` next to the icon marks the pending restart until it happens
- **Attachments** — paperclip picker, paste and drag and drop, multiple files and inline image previews. Browser mode selects files on the browser device and uploads their bytes to the bridge
- **Editor and browser context** — editor selection is available in the VS Code sidebar. The Chrome companion keeps active-page URL/title visible and attached to prompts, adds the current page selection, and offers consent-gated complete/targeted DOM, viewport-screenshot, visual/coordinate click, CSS mutation, navigation, scrolling and structured page-action tools
- **Built-in commands** — `/compact`, `/new` and `/name` map to their webview actions. Terminal-only commands are blocked locally with an explanatory chat message instead of being sent to the model
- **Header controls** — session picker, connection state, reload and live update shield
- **Automatic reconnect (browser)** — if the bridge is restarted or disappears, the page retries every 5 seconds while the window/tab is active (and immediately when it becomes visible again). When the bridge is back the status dot turns green again and the same session resumes without a manual page reload
- **Extension status** — `setStatus`/`setWidget` output rendered in the footer; placement, compactness and hidden sources are configurable
- **Themes and localization** — light/dark/system themes and Italian/English UI
- **Settings modal** — webview preferences include language, theme, history limit, Agentic thinking, notification defaults, status-bar layout and hidden sources. Staged pi.dev settings include new-session model/thinking defaults and dynamic extension CLI flags

CLI flags are **per-session**: they are stored as a `pi-webview-cli-flags` custom entry inside the session `.jsonl` file, so each session retains its launch configuration. New sessions start without flags; applying flags while a session is still empty takes effect on the immediate restart and is persisted as soon as its JSONL path is materialized. Forks inherit the parent entry. Changing Agentic thinking affects future events only; reloading the session re-renders its complete history without modifying the JSONL.

## Security

Pi extensions run with your full system permissions and can execute arbitrary code. Review the source before installing — as you would with any third-party package.

The Chrome companion declares `<all_urls>` host access because Chrome requires it for asynchronous `captureVisibleTab` screenshots. The implementation still limits page context and tools to HTTP and HTTPS pages. URL/title and selected text are visible in the composer. Complete/targeted DOM reads, screenshots and structured actions remain separately authorized; visual/coordinate clicks, CSS mutations, scrolling and reload/navigation use the structured-action grant. Navigation rejects non-HTTP(S) URLs. Grants can be scoped to the current pi session, one website across sessions, or every website globally, and subsequent requests within the selected scope do not prompt again. The companion does not request Chrome's `debugger` permission or use CDP. Chrome-protected pages remain inaccessible. See the [privacy policy](https://github.com/MagiusCHE/pi-webview/blob/main/PRIVACY.md).

## License

MIT. See [LICENSE](LICENSE).
