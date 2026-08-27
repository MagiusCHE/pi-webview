# Piano 0006 — Adapter Visual Studio (C# nativo, concept 0005)

> Stato: **IMPLEMENTATO** (2026-08-26) — vedi i mark ✅ nei passi e nei commit
> `988c3cb` (import dal fork) e `27acb46` (build versionata + auto-install).
> Branch: `feat/vs-adapter` (in attesa di merge in `main`).

## Fatto

- [x] **Trasporto `webview2` in UI** (`src/ide/transport.ts`,
      `src/web/environment.ts`, bootstrap in `src/web/main.ts`): rilevamento
      `window.chrome.webview` → mode `ide`; i punti `isVsCode` → `isIDE` dove il
      comportamento vale per ogni IDE (versione addon, titolo, browse folder,
      persistSessionPath, new chat). Test: `tests/webview2-transport.test.ts`.
- [x] **Fixture condivise del protocollo** (`tests/fixtures/ide-protocol/*.json`)
      validate sia dai test TS (`tests/fixtures-ide.test.ts`) sia dai test C# —
      mitigazione del drift (concept 0005 D3).
- [x] **`PiWebview.Vs.Core`** (netstandard2.0) — port 1:1 dei moduli bridge:
  - `Protocol/Dto.cs` (Frame, IdeRequest/Response/Event, UserConfig, SessionInfo…)
  - `Rpc/Jsonl.cs` (writer con coda+backpressure, reader split solo `\n`)
  - `Rpc/PiProcess.cs` (spawn via `cmd /c`, restart con backoff, stabilità 30s,
    kill dell'albero via taskkill)
  - `Platform/PiResolver.cs` + `BashDetector` (pi.cmd + bash Git Bash/MSYS2/Cygwin/WSL)
  - `Config/UserConfigStore.cs` (`%APPDATA%\pi-webview\config.json`, condiviso
    col bridge standalone) + `CompactionSettingsReader`
  - `Sessions/SessionStore.cs` (list/fork/rename/delete/cli-flags per-sessione)
  - `Platform/TrustStore.cs`, `Attachments.cs`, `BalanceClient.cs`,
    `ReloadSignal.cs` (concept 0004, watcher incluso)
- [x] **`PiWebview.Vs`** (net472, VSIX) — l'host:
  - `PiWebviewPackage.cs` (AsyncPackage, tool window multi-instance, comandi
    comando "pi" in **View > Other Windows** (con icona), reload signal,
    SelectionTracker)
  - `PiToolWindow.cs` + `PiToolWindowControl` (WebView2, virtual host
    `piw.local` → `dist/web`, ponte `WebMessageReceived`/`PostWebMessageAsJson`)
  - `Host/PiWebviewHost.cs` (spawn/restart di pi, cli flags da `pi --help`,
    fork cross-workspace, env `PI_WEBVIEW_COMPANION=1`, PATH+bash)
  - `Host/IdeBridge.cs` (tutte le IdeRequest del companion VS Code + openFile +
    clipboardWrite; steer queue persistita per workspace)
  - `Editor/SelectionTracker.cs` (MEF `ITextCaret`/`ITextSelection` +
    `WindowActivated` → `selection_changed`/`selection_cleared`/`at_mentioned`,
    debounce 150ms, semantica "non azzerare sul focus non-editor")
- [x] **Build VSIX verificata**: `PiWebview.Vs.vsix` con `dist/web` inclusa,
  InstallationTarget `[17.0,19.0)` (VS 2022 e 2026), `ProductArchitecture`
  amd64+arm64. Toolchain: metapackage VS SDK 17.14 + `Microsoft.VSSDK.BuildTools`
  18.4.33 (trova VS 2026 via vswhere) + `VSSDKBuildToolsAutoSetup=true`.
  La UI va buildata prima (`pnpm build`): il csproj dà errore chiaro se
  `dist/web/index.html` manca.
- [x] **Test C#** (`PiWebview.Vs.Core.Tests`, xunit): 33 test verdi — fixture
      del protocollo, JSONL, SessionStore (fork/rename/delete/cli-flags/filtro
      workspace), Trust, Config, Attachments, ReloadSignal, PiResolver.
- [x] **Fix parità TS**: `encodeProjectFolder` in `src/bridge/sessions.ts`
      ora codifica anche `:` e `\` (su Windows prima produceva nomi cartella
      invalidi e il filtro workspace non matchava le cartelle reali di pi:
      `--C--proj--`). Test in `tests/sessions.test.ts`.

## Verifiche manuali (esito test amico, VS 2026/18.0 preview, 2026-08-27)

- [x] **Smoke test in Visual Studio** (manuale, su Windows): il package
      carica, i comandi funzionano, la tool window si apre. Spawn di pi,
      chat, selezione editor: ok.
- [x] **Due difetti trovati e corretti** (build 2026-08-27):
  - le voci `pi: Attach Selection` / `pi: Focus` comparivano nel menu
    **Strumenti** e la tool window NON compariva in **View > Other Windows**
    → su VS moderno la voce "Altre finestre" NON è auto-generata dalla
    registry: nasce SOLO da un bottone VSCT nel gruppo
    `IDG_VS_WNDO_OTRWNDWS1` (stesso meccanismo dell'estensione di riferimento
    dliedke/ChatGPTExtension). Il VSCT ora ha un solo bottone "pi" in quel
    gruppo; i due comandi Tools sono rimossi (la selezione editor è già
    automatica via SelectionTracker);
  - **mancava l'icona** → aggiunta `<Bitmaps>` al VSCT con PNG 16×16
    derivato da `media/icon-mark-128.png`
    (`Commands/Resources/icon.png`): l'icona del bottone (voce "Altre
    finestre") è anche l'icona della tool window (titolo + menu). VSCTCompile
    la incorpora compressa nel `.cto` (verificato: 663 → 907 byte).

## Fatto (aggiunte dopo la stesura)

- [x] **Auto-install lato estensione pi** (`packages/pi-webview/`): rileva
      Visual Studio con `vswhere.exe` (solo Windows), installa il vsix con
      `VSIXInstaller.exe /quiet` — come avviene con
      `code --install-extension`. Il vsix è incluso nel package pi
      (`companion/pi-webview-visualstudio.vsix`, via `pnpm package:visualstudio`).
- [x] **Integrazione release**: build del vsix nel flusso `pnpm package:pi`
      (`pnpm package:vscode` → `pnpm package:visualstudio` → `build-addon.mjs` copia i due
      vsix in `packages/pi-webview/companion/`); `pnpm release` usa lo stesso
      flusso. Bump di versione sincronizzato con l'estensione pi (il reload
      signal confronta le versioni).
- [x] **Build VSIX su Linux (wine)**: `tools/setup-vs-wine.mjs` crea il
      WINEPREFIX dedicato nel progetto (`src/adapters/visualstudio/.wine/`,
      gitignored — non tocca `~/.wine`) con .NET Framework 4.8 (winetricks
      dotnet48) e applica le patch al pacchetto VSSDK.BuildTools nel nuget
      cache (symlink case, wrapper shims wine per VSCT/CreatePkgDef, Newtonsoft
      netstandard2.0). `pnpm package:visualstudio` = `pnpm build` + `dotnet build` +
      copia in `dist/`.
- [x] **Nome e icona allineati al companion VS Code**: DisplayName "pi",
      icona 32x32 generata da `media/icon-mark-128.png` nel vsix
      (`<Icon>icon.png</Icon>`), strings utente localizzate via
      `HostText.T(it, en)` con locale dalla config condivisa.
## Futuro (opzionale, NON in questo piano)

- **Tema v2** (concept 0005 D6): mappare `VSColorTheme.ThemeChanged` →
  variabili CSS `--vscode-*` sul body della webview.
- **Persistenza sessione corrente** al riavvio dell'IDE: oggi il resume è solo
  via dropdown (il companion VS Code usa workspaceState; in VS serve un
  equivalente — file per-soluzione o soluzione+toolwindow id).
- **CI**: eseguire `dotnet test` della solution in aggiunta a `pnpm test`
  (`dotnet test src/adapters/visualstudio/PiWebview.Vs.slnx`).

## Note di build (Linux)

```bash
# dalla radice del repo
pnpm build                                     # UI → dist/web (prerequisito del vsix)
node tools/setup-vs-wine.mjs                   # una tantum: prefix wine + patch VSSDK
pnpm package:visualstudio                     # dotnet build → dist/pi-webview-visualstudio.vsix
pnpm package:pi                               # tutto: UI + vsix VS Code + vsix VS + bundle pi
dotnet test src/adapters/visualstudio/PiWebview.Vs.slnx   # 33 test C#
```
