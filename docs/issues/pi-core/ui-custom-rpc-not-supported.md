# ui.custom non supportato in RPC mode

- **Componente**: pi-core (`modes/rpc/rpc-mode.js`)
- **Scoperto**: 2026-08-24 (piano 0003 / palette comandi)
- **Stato**: aperto — da proporre upstream a @earendil-works

## Problema

`ctx.ui.custom<T>(factory, options)` (ExtensionUIContext, `extensions/types.d.ts`
riga 117) permette alle estensioni di mostrare componenti TUI arbitrari con
focus e tastiera (SelectList, loader, anteprime…). In **RPC mode** è
implementato come:

```js
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
}
```

→ l'estensione che chiama `ui.custom` riceve `undefined` come risultato.

## Impatto

Molte estensioni di `pi-agent-extensions` usano `ui.custom` per i loro comandi
interattivi: `sessions` (picker sessioni con ricerca+anteprima), `files`,
`answer`, `btw`, `context`, `review`, `handoff`… In webview questi comandi
**terminano in silenzio** (o, peggio, producono falsi negativi — vedi
`hasui-in-rpc-mode.md`).

## Dettagli verificati

- `dist/modes/rpc/rpc-mode.js` — `async custom() { return undefined; }`
- Esempi d'uso: `pi-agent-extensions/extensions/{sessions,files,answer,btw,context}/index.ts`
  (tutti con `ctx.ui.custom(...)`).

## Cosa servirebbe (se implementato upstream)

1. Renderer "shim" in rpc-mode: eseguire la factory con un `tui`/`theme`/`kb`
   finti e **serializzare le righe renderizzate** (layout, ANSI, scroll) —
   pi già lo fa in piccolo per `setWidget` (che accetta solo array di stringhe).
2. Protocollo di aggiornamento: a ogni `tui.requestRender()` → push del nuovo
   render via `extension_ui_request`.
3. Inoltro tastiera: eventi dal client → componente → re-render.
4. Risoluzione `done(result)` → `extension_ui_response`.
5. Lifecycle: overlay/posizionamento, dispose, abort su cambio sessione.

Stima: feature sostanziosa (un mini-protocollo di rendering terminale), non
patchabile dall'esterno.

## Workaround lato pi-webview

Nessuno per i comandi di terze parti. Per i casi concreti che ci servono
(es. picker sessioni) si implementa la funzionalità come **UI nativa della
webview** (vedi `docs/commands-todo.md`).

## Fattibilità (spike 2026-08-24) — SI, si può fare, ed è più semplice del previsto

Spike eseguito con componenti pi-tui reali (Container + Text + Spacer +
SelectList, stessi usati dalle estensioni):

- `Component` è minimale: `render(width): string[]` + `handleInput(data)`
  (`pi-tui/dist/tui.d.ts`). Niente mappatura dei tipi nodo: **basta chiamare
  `render(width)` sull'albero e mandare le righe** (ANSI) al client.
- Output reale dello spike: `[" Sessioni del progetto: ", "", "→ session-1", "  session-2"]`
  — layout, testo e selezione ("→") serializzati in una sola chiamata.
- `SelectList.handleInput` esiste (filtro/ricerca da tastiera); il tema è
  un semplice oggetto di funzioni (il shim lo fornisce).

### Protocollo minimo (se implementato upstream)

1. rpc-mode esegue la factory con `tui` finto (aggancia `requestRender`),
   `theme` finto, `kb` finto, `done`; `render(width)` → righe → via
   `extension_ui_request` (stessa meccanica di `setWidget` con string[]).
2. Eventi tastiera dal client → componente (`handleInput`/kb) → re-render → push.
3. `done(result)` → `extension_ui_response`.
4. Client: dialog con le righe (ANSI → colori), inoltro tastiera, larghezza
   reale riportata a pi per il render corretto.

### Stima rivista

v1 "dialogo" (render a righe + tastiera + done): **~1-2 giorni** (pi-core
shim ~1g + client ~0,5g + test sulle 12 estensioni). Parità piena
(overlay, focus, componenti custom): settimane. Il 70% del lavoro resta in
pi-core → va proposto upstream (o fork da mantenere).

## Proposta upstream (bozza completa, da aprire su pi-agent)

### Obiettivo

Supportare `ctx.ui.custom()` in RPC mode con un protocollo minimo di
render a righe, trasparente per il TUI.

### Trasparenza verso il TUI

- La modifica è confinata a `modes/rpc/rpc-mode.js` (il uiContext RPC);
  `interactive-mode` e `pi-tui` non vengono toccati.
- Lo shim usa SOLO la superficie pubblica di `Component`
  (`render(width)` / `handleInput`) — nessuna modifica a pi-tui.
- Le estensioni non cambiano: in TUI il custom gira nativamente, in RPC
  gira tramite il protocollo. `hasUI` resta com'è (true in entrambi).
- Unica duplicazione: un mini dispatch tastiera nel shim (segue l'API
  keybinding di pi-tui) — costo di manutenzione solo lato rpc.

### Protocollo

**1. Apertura** — rpc-mode esegue la factory con shim e, al primo render,
emette:

```json
{ "type": "extension_ui_request", "id": "…", "method": "custom_open",
  "title": "<opzionale>", "lines": ["…", "→ session-1"], "width": 60 }
```

**2. Aggiornamenti** — a ogni `tui.requestRender()` (e dopo ogni input):

```json
{ "type": "extension_ui_request", "id": "…", "method": "custom_render",
  "lines": ["…"], "width": 60 }
```

**3. Input dal client** (tastiera / click su riga):

```json
{ "type": "extension_ui_response", "id": "…", "key": "down" }
{ "type": "extension_ui_response", "id": "…", "key": "enter" }
{ "type": "extension_ui_response", "id": "…", "clickIndex": 2 }
```

rpc-mode li inoltra al componente (`handleInput` / keybinding manager) →
re-render → `custom_render`.

**4. Chiusura** — `done(result)`:

```json
{ "type": "extension_ui_response", "id": "…", "done": true, "result": "<serializzato>" }
```

**5. Cancellazione** (Esc da client o switch sessione):

```json
{ "type": "extension_ui_response", "id": "…", "cancelled": true }
```

### Shim richiesto in rpc-mode

- `tui` finto: `requestRender()` → segna dirty; `getSize()`/larghezza
  fornita dal client (`width` nel custom_render successivo);
- `theme` finto: wrapper identity o ANSI (il client rende con colori);
- `keybindings` finto: registra gli shortcut e li dispaccia dai `key`
  ricevuti (mini-dispatch, segue l'API di pi-tui);
- `done(result)` → risposta con risultato serializzato
  (JSON.stringify con fallback a String);
- la factory può tornare `Promise<Component>` → attesa;
- `options.overlay`/`overlayOptions` ignorati in v1 (full-screen box).

### Client (webview pi-webview)

- Dialog modale che mostra `lines` (ANSI → colori tema, già disponibile),
  report `width` reale alla richiesta del render, inoltro tastiera
  (↑/↓/Invio/Esc/backspace per la ricerca), click su riga → `clickIndex`.
- Stima client: ~0,5-1 giorno (riuso renderAnsiToHtml + modali esistenti).

### Stima complessiva

v1 (Container/Text/Spacer/DynamicBorder/SelectList + tastiera + done):
**~1-2 giorni** (shim pi-core ~1g + client ~0,5g + test sulle 12 estensioni
di pi-agent-extensions che usano custom). Parità piena (overlay, focus,
componenti custom tipo QnA/ContextView): settimane — v1 degrada i custom
sconosciuti al loro testo renderizzato, senza crash.
