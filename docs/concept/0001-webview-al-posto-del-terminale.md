# Concept 0001 — Pi x IDE: webview al posto del terminale

> Data: avvio sessione — stato: bozza, prime considerazioni
> Obiettivo: consentire una gestione migliore dell'interazione mouse/tastiera,
> selezione del testo, e rendering ricco, sostituendo il terminale integrato
> con un WebView di VS Code.
> **Decisioni architetturali successive: vedi concept 0002.**

---

## 1. Architettura attuale (extension `balaenis.pi-x-ide`)

L'extension oggi fa tre cose:

1. **WebSocket server locale** — `127.0.0.1`, porta casuale, token di auth,
   protocollo JSON-RPC. Porta + token scritti in un lock file.
2. **Broadcast della selezione** — eventi `selection_changed` /
   `selection_cleared` / `at_mentioned` inviati ai client connessi, derivati
   dall'editor attivo (file, workspace, range selezionati).
3. **Terminale integrato** — `createTerminal` + `sendText("pi")` (opzionale
   `tmux`, setting `piXIde.useTmux`). La TUI di pi è il vero "client":
   si collega al WebSocket e riceve il contesto.

La TUI gira dentro xterm: griglia di celle, ANSI, niente markdown ricco,
selezione "da terminale", mouse limitato. Da qui i limiti che vogliamo
superare.

## 2. Cosa pi mette già a disposizione: RPC mode

`pi --mode rpc` — headless, JSON su stdin/stdout. Documentato in
`docs/rpc.md` di pi: _"useful for embedding the agent in other applications,
IDEs, or custom UIs"_.

- **Comandi** (JSONL su stdin): `prompt`, `steer`, `follow_up`, `abort`,
  `new_session`, `get_state`, `get_messages`, `get_entries` (cursore `since`),
  `get_tree`, `get_commands`, `set_model`, `set_thinking_level`, `compact`,
  `bash`, `export_html`, ecc.
- **Eventi** (JSONL su stdout): `message_start` / `message_update` (delta con
  `contentIndex`) / `message_end`, `tool_execution_start/update/end`,
  `agent_start/end/settled`, `turn_start/end`, `queue_update`,
  `compaction_*`, `auto_retry_*`, `extension_ui_request`/`response`.
- **Extension UI Protocol**: `select`, `confirm`, `input`, `editor`
  (dialog, con request/response e timeout), `notify`, `setStatus`,
  `setWidget`, `setTitle`, `set_editor_text` (fire-and-forget).

→ Niente parsing di escape ANSI: l'extension host fa
`spawn("pi", ["--mode", "rpc", ...])`.

## 3. Cosa servirebbe

### 3.1 Processo headless (già pronto lato pi)

`spawn` del processo RPC dall'extension host, con gestione del ciclo di vita:
restart su crash, kill alla chiusura del webview, backpressure sullo stdin.

### 3.2 Bridge webview ↔ processo (lavoro medio, ~300-500 righe)

- `WebviewViewProvider` (sidebar) o `createWebviewPanel` (tab), con
  `enableScripts`, CSP stretta, `localResourceRoots`.
- Canale `postMessage` bidirezionale: webview → extension host → stdin di pi;
  stdout di pi → extension host → webview.
- Parsing JSONL rigoroso: split **solo** su `\n` (niente `readline` di Node,
  spezza su U+2028/U+2029 — avvertenza esplicita in `docs/rpc.md`).
- Il WebSocket/lock file esistenti si **riusano così come sono**: il webview
  si collega come client WS e continua a ricevere selezione e `at_mentioned`.

### 3.3 WebView UI (lavoro grosso, ~2-5k righe)

È il 70–80% dello sforzo: una web app DOM che oggi non esiste.

- Lista messaggi (user / assistant / toolResult) con markdown renderizzato,
  syntax highlighting, code block con bottone copy, thinking collassabile,
  tool call come card expandibili.
- Streaming delta assemblato via `contentIndex`; `message_end` come
  snapshot autorevole.
- Input multi-linea (textarea): IME/composition, Enter=invio /
  Shift+Enter=a capo, autocomplete comandi (`get_commands`), drag&drop
  immagini (`prompt` con `images` base64 è supportato).
- Mapping Extension UI Protocol: dialog → modali DOM o
  `showQuickPick`/`showInputBox` nativi; `notify` → toast; `setStatus` /
  `setWidget` / `set_editor_text` → footer / widget / input.
- Selettore modello e thinking level (`set_model`, `set_thinking_level`),
  bottone abort, persistenza con `getState/setState` + `get_entries` con
  cursore `since` per il resume.

## 4. Cose che si perdono / da compensare

- In RPC mode alcune API TUI-only delle extension sono **no-op**:
  `custom()`, `setWorkingMessage()`, `setWorkingIndicator()`, `setFooter()`,
  `setHeader()`, `setEditorComponent()`, `setToolsExpanded()`,
  `getEditorText()`, temi. Le extension che le usano degradano.
- Comandi TUI built-in (`/settings`, `/hotkeys`) non passano da RPC:
  gli schermi vanno reimplementati in HTML.
- Il setting `useTmux` diventa irrilevante.

## 5. Quadro sintetico

| Pezzo                            | Sforzo                                  |
| -------------------------------- | --------------------------------------- |
| Modalità headless di pi          | già pronto (`--mode rpc`)               |
| Selezione/contesto VS Code       | già pronto (WebSocket server esistente) |
| Processo + bridge extension host | ~300–500 righe                          |
| WebView UI                       | ~2–5k righe (il grosso)                 |

**Via intermedia (non scelta, ma nota)**: webview + xterm.js per restare
"terminal-like" migliorando mouse/selezione (il terminale integrato di VS Code
è già un webview con xterm). Ma per selezione vera, markdown, immagini, bottoni
e interazione ricca serve la strada piena: DOM + RPC mode.

## 6. Conclusione

Il 40% è già fatto (protocollo headless + contesto editor). Manca il bridge
e soprattutto una UI web che oggi non esiste.

## 7. Prossimi passi (candidati)

- [ ] Prototipo del bridge extension host (spawn RPC + postMessage)
- [ ] Bozza struttura della webview (layout, componenti, flusso eventi)
- [ ] POC streaming markdown da `message_update`/`message_end`
- [ ] Mapping completo Extension UI Protocol
- [ ] Decisione: sidebar (WebviewView) vs tab (WebviewPanel)
