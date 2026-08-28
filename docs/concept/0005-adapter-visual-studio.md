# Concept 0005 — Adapter Visual Studio 2022/2026 (C# nativo)

> Stato: bozza. Riferimenti: concept 0002 (D3 multi-IDE, D6 cross-platform),
> concept 0004 (reload signal multi-IDE).

## Contesto

Visual Studio 2022/2026 ha un modello di estensione completamente diverso da
VS Code: **C#/.NET, VSIX, WebView2** (non TypeScript + WebviewPanel). Il codice
dell'adapter VS Code (`src/adapters/vscode/`, ~940 righe) **non è riusabile
come codice**, ma il layering del concept 0002 lo isola: si riusano al 100%
la UI (`src/web/`, ~6.5k righe), il contratto del protocollo
(`src/ide/protocol.ts`) e la logica di spawn di pi (`src/bridge/pi-process.ts`
come riferimento 1:1). L'adapter si riscrive in C#, il protocollo resta
identico.

Strada scelta: **1 — adapter C# nativo** (vs 2 — riuso del bridge standalone
Node dentro un ToolWindow). La strada 1 non aggiunge processi Node intermedi,
resta fedele al layering D3 e dà pieno controllo su selezione editor e
lifecycle.

## Decisioni

### D1 — AsyncPackage + ToolWindow + WebView2

- `Microsoft.VisualStudio.Sdk` metapackage (17.x, minimo comune 2022/2026;
  target aggiornabile a 18.x appena pubblicato) + `Microsoft.Web.WebView2`.
- Target framework: `net8.0-windows` (VS 2022 17.10+) oppure `net472` per
  massima compatibilità — da fissare nel piano di implementazione.
- ToolWindow "pi" ancorabile (in VS 2022 non esiste una sidebar webview:
  `ToolWindowPane` è l'equivalente più vicino).
- La UI buildata (`dist/web`) viene copiata nell'output/vsix e servita con
  `CoreWebView2.SetVirtualHostNameToFolderMapping("piw.local", <dist/web>,
HostResourceAccessKind.Allow)` → `Navigate("https://piw.local/index.html")`.
- Ponte: `WebMessageReceived` (UI → host) e `PostWebMessageAsJson`
  (host → UI), frame JSON identici a quelli del postMessage VS Code.

### D2 — UI riusata al 100%, nuovo trasporto `webview2`

- `src/web/transport.ts`: nuovo `createWebView2Transport()` basato su
  `window.chrome.webview.postMessage` + evento `message`. Formato `Frame`
  invariato.
- `src/web/environment.ts`: rileva `window.chrome.webview` → mode `ide`
  (il marker `?ide=…` via query param è già previsto: `?ide=visualstudio`).
- Nessun altro cambiamento UI.

### D3 — Protocollo identico, DTO C# con System.Text.Json

- Classi C# mirror di `Frame` / `RpcCommand` / `IdeRequest` / `IdeResponse` /
  `IdeEvent` (`src/ide/protocol.ts`), naming policy camelCase.
- Mitigazione del drift TS↔C#: fixture JSON committate in `tests/fixtures/`
  (sample di ogni tipo di messaggio) consumate sia dai test TS esistenti sia
  da test C# che le deserializzano nei DTO.

### D4 — Spawn di pi da C#

Replica 1:1 di `src/bridge/pi-process.ts` (~300 righe):

- `System.Diagnostics.Process`; su Windows pi è uno shim npm → eseguito via
  `cmd.exe /c` (stesso approccio del bridge).
- **Bash detection** (0002 D6): localizza Git Bash / MSYS2 / WSL (path
  candidati), estende `PATH`, errore chiaro se assente.
- JSONL rigoroso: split della stdout **solo su `\n`**, scrittura stdin con
  coda + backpressure (write asincrone, niente `WriteLine` sincrona).
- Lifecycle: restart con backoff (max 5, reset dopo 30s di stabilità), kill
  alla chiusura del ToolWindow, flag di stopping.

### D5 — Selezione editor: DTE + API editor MEF

- Modifiche riga: `TextEditorEvents.LineChanged` (DTE).
- Caret/selezione pura (DTE non li espone bene): import MEF di
  `ITextCaret.PositionChanged` / `ITextSelection.SelectionChanged`
  dell'editor attivo.
- Mapping → `selection_changed` / `selection_cleared` con lo stesso shape del
  protocollo (`filePath`, `workspaceFolder` = soluzione aperta via
  `DTE.Solution`, `ranges`); `at_mentioned` su @file (stessa euristica della
  webview).
- Tutto su UI thread via `JoinableTaskFactory`.

### D6 — Tema

- v1: mode `ide` → la UI usa il **tema standalone** dalla config utente
  (0002 D7): già supportato (token "Absolutely" + `color-scheme`), zero lavoro.
- v2 opzionale: mappa `VSColorTheme.ThemeChanged` in CSS vars `--vscode-*` +
  attributo tema sul body via `ExecuteScriptAsync` (la UI in mode `ide` potrà
  accettarle). Non bloccante.

### D7 — Config utente condivisa

`%APPDATA%\pi-webview\config.json` — **lo stesso file** del bridge standalone
su Windows (`src/bridge/config.ts`): `getConfig`/`setConfig` C# leggono e
scrivono lo stesso JSON `{ theme, locale, historyLimit }`. Preferenze
condivise tra standalone e Visual Studio.

### D8 — Reload signal (concept 0004)

- `checkReloadSignal()` all'attivazione + `FileSystemWatcher` su
  `~/.pi/pi-webview` filtrato su `companion-reload.json` → stesso confronto di
  versione.
- In VS non esiste il reload della finestra: la notifica chiede il **riavvio
  dell'IDE** (message box + eventuale `DTE.ExecuteCommand` di chiusura).

### D9 — Packaging e distribuzione

- VSIX con `InstallationTarget` 17.x (e 18.x quando disponibile), assets:
  `dist/web`, icone.
- Install: `VSIXInstaller.exe` in quiet mode; discovery di VS via
  `vswhere.exe`.
- Auto-install lato estensione pi: rileva Visual Studio con `vswhere` e
  installa il vsix (come oggi fa con `code --install-extension`), side-by-side
  con il companion VS Code. Niente marketplace necessario per il flusso
  interno (il vsix VS Code è già side-load).

## Struttura proposta

```
src/adapters/visualstudio/
  PiWebview.Vs.sln
  src/PiWebview.Vs/
    PiWebviewPackage.cs        # AsyncPackage, registrazione ToolWindow
    PiToolWindow.cs            # ToolWindowPane + WebView2 + host bridge
    Protocol/Dto.cs            # Frame, RpcCommand, IdeRequest/Response/Event
    Rpc/Jsonl.cs               # encoder/decoder (split solo \n)
    Rpc/PiProcess.cs           # spawn, backpressure, restart (1:1 pi-process.ts)
    Host/IdeBridge.cs          # routing IdeRequest → DTE / config / filesystem
    Editor/SelectionTracker.cs # MEF + DTE → selection_changed/cleared
    Editor/AtMention.cs
    Config/UserConfig.cs       # %APPDATA%\pi-webview\config.json
    Platform/BashDetector.cs
    Platform/ReloadSignal.cs   # concept 0004
  tests/                       # xunit: deserialize fixtures, JSONL, bash detection
```

## Sforzo stimato

| Pezzo                                   | Stima                                          |
| --------------------------------------- | ---------------------------------------------- |
| Trasporto `webview2` + environment (TS) | ~60 righe                                      |
| DTO C# + fixtures condivise             | ~400 righe                                     |
| `PiProcess` C#                          | ~300 righe                                     |
| ToolWindow + WebView2 + bridge host     | ~400 righe                                     |
| SelectionTracker + at_mention           | ~300 righe                                     |
| Config + reload signal + bash detection | ~250 righe                                     |
| Packaging VSIX + docs                   | ~200 righe                                     |
| **Totale**                              | **~1.900–2.200 righe C# + ~60 TS, 0 cambi UI** |

## Rischi

- **API selezione DTE limitate** → necessarie le API editor MEF (VS SDK);
  fallback: polling leggero del caret.
- **WebView2 runtime**: VS 2022 lo include e lo aggiorna (Evergreen) — nessuna
  azione, ma da verificare in VS 2026.
- **VS 2026 (18.x)**: API VS SDK compatibili; va solo aggiornato
  `InstallationTarget`. Il metapackage 17.x resta il minimo comune.
- **Drift protocollo TS↔C#**: mitigato con fixture condivise + test su
  entrambi i lati.
- **Distribuzione marketplace**: richiede publisher; il flusso primario è
  side-load + auto-install via `vswhere` (come già accade per il vsix VS Code).

## Prossimi passi

- [ ] Prototipo minimo: ToolWindow + WebView2 che carica `dist/web` con il
      trasporto `webview2` (senza pi)
- [ ] Trasporto `webview2` in `src/web/transport.ts` + rilevamento in
      `environment.ts`
- [ ] `PiProcess` C# con smoke test contro pi reale (stile `pnpm smoke`)
- [ ] `IdeBridge`: routing delle IdeRequest minime (workspaceInfo, config,
      clipboard, openFile)
- [ ] `SelectionTracker` MEF → `selection_changed`
- [ ] Reload signal + bash detection
- [ ] Packaging VSIX + auto-install lato estensione pi (vswhere/VSIXInstaller)
- [ ] Piano di implementazione dettagliato in `docs/plans/`
