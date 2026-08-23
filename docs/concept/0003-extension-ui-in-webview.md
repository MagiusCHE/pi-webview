# Concept 0003 — Extension UI in webview: come i plugin "interfacciati" raggiungono la UI

> Stato: analisi registrata (nessuna modifica al codice). Verifiche su pi v0.84.2.

## Flusso

I plugin di pi (extension in `~/.pi/agent/extensions`) girano **dentro il processo
pi**, mai nel browser. Per toccare l'interfaccia usano `ctx.ui.*`; in RPC mode pi li
converte in frame JSON `extension_ui_request` sullo stesso canale degli eventi di
messaggio (stdout di pi → bridge → webview, channel `rpc`).

```
plugin (dentro pi) → ctx.ui.select()/setStatus()/…
  → pi --mode rpc serializza come extension_ui_request su stdout
  → bridge inoltra (channel rpc)
  → la webview decide come renderizzare ogni richiesta
```

Conseguenza: i plugin non "modificano" la UI, la **guidano** — è la webview che
decide il rendering. Nessun accesso diretto al DOM (confine di sicurezza).

## Tre gruppi

### A — Funzionano via protocollo: manca solo la mappatura in UI (piano 0002)

- `select` / `confirm` / `input` / `editor` (dialoghi): richiedono la **nostra
  risposta** (`extension_ui_response`); senza risposta il plugin **resta bloccato**
  (finché non scade l'eventuale timeout)
- `notify` → notifica/toast
- `setStatus` → righe di stato (strip per chiave)
- `setWidget` → widget sopra/sotto l'editor
- `setTitle` → titolo pagina
- `set_editor_text` → contenuto dell'input box (banale)

Stato attuale: la UI **ignora tutti questi eventi** (mapping eventi: default →
`none`). I dialoghi non risposti causano **hang dell'agente**. È il lavoro del
piano 0002.

### B — Servono una patch al core di pi (no-op silenziosi oggi)

Verificato in `dist/modes/rpc/rpc-mode.js` (pi 0.84.2): `setFooter`, `setHeader`,
`setWorkingMessage`, `setWorkingIndicator`, `setEditorComponent`,
`setToolsExpanded`, `getAllThemes`, `setTheme`, `getEditorText` sono no-op
silenziosi: pi li inghiotte **senza emettere nulla**. Per farli arrivare alla
webview va modificato pi perché li emetta come `extension_ui_request` (stesso
pattern di `setWidget`). → corrisponde alla decisione **D4** (lazy header/footer).

### C — Non funzioneranno mai via RPC

- `custom()` (componenti React custom della TUI): in RPC ritorna `undefined`.
  Plugin difensivi non crashano ma non renderizzano nulla. Replicabili solo
  estendendo il protocollo (descrittori dichiarativi/HTML serializzato) — future
  work.

## Note

- `ctx.mode === "rpc"` e `ctx.hasUI === true`: i plugin ben educati possono
  verificare `ctx.mode === "tui"` e degradare elegantemente; quelli che assumono
  un terminale non mostrano nulla (senza errori se difensivi).
- Esempio reale osservato: il plugin pi-x-ide emette `setWidget`/`setStatus`
  all'avvio (es. "MCP: 13 servers enabled") — oggi ignorati dalla UI.
- I plugin che non usano `ctx.ui.*` (soli tool/extension) sono **non impattati**.

## Riferimenti

- Concept 0002 D4 (lazy header/footer) e D3 (IDE bridge protocol)
- Piano 0002, step 6 (mapping Extension UI Protocol)
- `docs/rpc.md` di pi (sezione "Extension UI Protocol")
