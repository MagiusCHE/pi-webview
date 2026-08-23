# Concept 0002 — Architettura: webview completa, standalone, multi-IDE, UI lazy

> Stato: D1–D4 e trasporto (a) validati (2025-08-20). Verifiche su pi v0.84.2.

## Decisioni

### D1 — Webview completa, non parziale

UI 100% DOM. Nessuna emulazione terminale (xterm.js fuori). Nessun rendering
ANSI: i messaggi arrivano come eventi strutturati (RPC mode).

### D2 — Deve funzionare anche fuori da VS Code

La webview UI è una web app pura, sviluppabile e testabile in un browser
senza VS Code. Non chiama mai API di VS Code direttamente.

### D3 — Multi-IDE: VS Code è un deploy tra tanti

Layering con adapter per IDE. Il pacchetto VS Code (vsix) è il primo dei tanti.

### D4 — Header/footer lazy

Le API extension UI oggi no-op in RPC mode devono diventare `extension_ui_request`
(patch al core di pi). La webview implementa slot lazy: visibili solo quando
un'estensione li popola.

### D5 — Trasporto standalone: bridge nostro (a)

Niente patch al core di pi. Un piccolo processo Node (bridge) spawna
`pi --mode rpc` e lo espone su WebSocket locale (loopback + token).
Sostituibile in futuro da un eventuale mode WS nativo di pi senza toccare la UI.

### D6 — Deploy cross-platform (Linux / macOS / Windows)

Sviluppo fasantato su **Linux**, ma con occhio costante a portabilità;
**il deploy deve funzionare sui 3 sistemi**. Verificato su pi v0.84.2:

- pi si installa via npm (`npm install -g --ignore-scripts …`) → cross-platform
- protocollo RPC identico su tutti i sistemi (stdio JSONL)
- **Windows**: pi richiede una bash shell (Git Bash / Cygwin / MSYS2 / WSL,
  vedi `docs/windows.md` di pi) — il bridge/adapter deve rilevarla e dare
  errore chiaro se assente
- accortezze nel codice: risoluzione del binario `pi` (shim `pi.cmd` su
  Windows), segnali (`child.kill()` cross-platform), percorsi via
  `os.tmpdir()`/`path.join`, mai hard-coded unix

### D7 — Tema e config utente

- **Chi passa il tema**: in webview VS Code il tema lo passa l'IDE — la
  webview riceve le variabili CSS `--vscode-*`, l'attributo
  `data-vscode-theme-kind` sul body e il messaggio `vscode-theme-changed`.
  Il plugin si adatta, non ha uno stile proprio. Standalone si usa la
  preferenza utente: `light` / `dark` / `system` (default `system`).
- **Config utente** in cartella dedicata per SO (modulo `src/bridge/config.ts`):
  - Linux: `$XDG_CONFIG_HOME/pi-webview` (default `~/.config/pi-webview`)
  - macOS: `~/Library/Application Support/pi-webview`
  - Windows: `%APPDATA%\pi-webview`
    File `config.json`, accesso via IDE bridge protocol (`getConfig`/`setConfig`),
    gestito dal bridge (standalone) e dall'extension host (VS Code, futuro).

## Architettura a strati

```
┌─ UI (web app pura, framework-agnostic) ─────────────────┐
│ render messaggi, input, streaming, widget, header/footer │
│ parla solo il "IDE bridge protocol"                      │
└──────────────┬───────────────────────────────────────────┘
               │ postMessage (webview) / WebSocket (browser)
┌──────────────▼───────────────────────────────────────────┐
│ Host adapter (uno per IDE)                               │
│ vscode · standalone · (futuro) jetbrains, neovim, ...    │
└──────────────┬───────────────────────────────────────────┘
               │ JSONL stdio
┌──────────────▼───────────────────────────────────────────┐
│ pi core --mode rpc (headless)                            │
└──────────────────────────────────────────────────────────┘
```

- **UI**: render messaggi (markdown, thinking collassabile, tool call),
  streaming delta (`contentIndex`), input multi-linea, slot lazy
  (header/footer/status/widget/editor component), dialoghi, notifiche,
  select model/thinking, abort, persistenza (`getState/setState`,
  `get_entries` con cursore `since`).
- **IDE bridge protocol**: contratto host↔UI. Messaggi minimi iniziali:
  `attachSelection` / `selectionChanged` (riusa WebSocket/lock file di
  Pi x IDE), `openFile`, `showQuickPick`, `showInputBox`, `showMessage`,
  `clipboard`, `workspaceInfo`, lifecycle del processo.
- **Adapter vscode**: spawna `pi --mode rpc`, crea la webview, implementa il
  bridge con API reali VS Code.
- **Adapter standalone**: processo Node (bridge stdio↔WebSocket) + pagina
  browser. Bonus: dev loop della UI in browser senza VS Code.

## Trasporto standalone (decisione presa: a)

Verificato pi v0.84.2: RPC solo su stdio, **nessun mode WebSocket**.

- **(a) bridge nostro — SCELTO**: processo Node che fa solo smistamento byte:
  ```
  Browser (UI)  ⇄  WebSocket (127.0.0.1 + token)  ⇄  [bridge Node]  ⇄  stdio JSONL  ⇄  pi --mode rpc
  ```
  - Spawn di `pi --mode rpc`, parsing JSONL (split solo `\n`, mai `readline`),
    forward bidirezionale trasparente (non conosce la semantica dei messaggi)
  - Lifecycle: restart di pi su crash, kill alla chiusura, backpressure stdin
  - Sicurezza: loopback + token (pattern del lock file di Pi x IDE)
  - Stima ~150–250 righe; riusabile per tutti gli IDE che
    "aprono il browser" (es. JetBrains → apri pagina + inietta selezione via WS)
  - Bonus chiave: **dev loop della UI in browser senza VS Code**
- (b) patch a pi core per un mode WS nativo — esclusa (dipendenza esterna);
  se un giorno pi la avrà, si sostituisce il bridge con un flag, la UI non cambia.

## Estensioni UI: stato in RPC mode (verificato pi v0.84.2)

Già emettono `extension_ui_request`:

- `select`, `confirm`, `input`, `editor` (dialog con request/response, timeout)
- `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text` (fire-and-forget)

**No-op silenziosi** (nessun evento → la webview non può reagire):

- `setFooter`, `setHeader`, `setWorkingMessage`, `setWorkingIndicator`,
  `setEditorComponent`, `setToolsExpanded`, `getEditorText` (ritorna `""`),
  `getAllThemes` (`[]`), `setTheme` (errore), `custom()` (`undefined`)

### Lavoro richiesto

1. **Patch al core di pi** (repo `@earendil-works/pi-coding-agent`, file
   `src/modes/rpc/rpc-mode.ts`): i no-op sopra devono emettere
   `extension_ui_request` con lo stesso pattern di `setWidget`
   (`method`, chiave, contenuto). `getEditorText` → request/response con il
   testo dell'input box.
2. **Webview**: slot lazy — `#header`, `#footer`, status strip per chiave,
   widget sopra/sotto editor, working indicator, editor component.
   Tutti `display:none` finché non popolati; clear quando l'estensione
   svuota.

### Limite noto

- `custom()`: factory React della TUI non serializzabili. In RPC resta
  `undefined`. Future work: descrittori dichiarativi/HTML serializzato nel
  protocollo.

## Prossimi passi

- [x] Validare D2/D3 e la scelta del trasporto → **(a) bridge nostro**
- [ ] Prototipo bridge Node stdio↔WS (adapter standalone)
- [ ] Definire il **IDE bridge protocol** (prima bozza di messaggi)
- [ ] Prototipo webview in browser con bridge reale (dev loop senza VS Code)
- [ ] Adapter vscode (spawn + webview + bridge)
- [ ] Valutare patch pi core per setFooter/setHeader lazy
