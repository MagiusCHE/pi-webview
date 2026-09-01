# Status crediti non mostrato in RPC mode (pi-spark)

- **Componente**: pi-spark (`src/features/credits/index.ts`)
- **Scoperto**: 2026-08-28 (webview pi-webview in `--mode rpc`)
- **Stato**: aperto — fix applicato nel fork `MagiusCHE/pi-spark`
- **Repo in analisi**: fork `https://github.com/MagiusCHE/pi-spark.git`
  (clone locale in `~/Sources/External/pi-spark`)

## Problema

pi-spark mostra il saldo/rate-limit del provider attivo nella **status line**.
In TUI funziona (l'utente vede "Codex 5h…"), ma nell'estensione **pi-webview**
(che esegue `pi --mode rpc`) la status line **non compare mai**.

La webview è già un renderer **passivo** di `ctx.ui.setStatus`: in RPC il core
inoltra ogni chiamata come `extension_ui_request` → la webview mostra uno slot
per chiave nel footer (`statusSlots`). Quindi il meccanismo di trasporto c'è.
Il blocco sta **a monte**, dentro pi-spark.

## Causa radice

In `src/features/credits/index.ts`, `registerCredits` ha un gate sulla modalità:

```ts
pi.on("session_start", (_event, ctx) => {
  const config = loadConfig(ctx).credits;
  if (ctx.mode !== "tui" || !config) return;
  ...
});
```

`ctx.mode` in pi-webview è `"rpc"`, quindi la feature viene **saltata** prima
ancora di caricare i provider e chiamare `ctx.ui.setStatus`.

Le altre feature di pi-spark (editor, footer, recap, title) sono **intrinsecamente
TUI** (renderizzano componenti/righe con TUI) e vanno lasciate gated. I crediti,
invece, sono **data-driven**: recuperano il saldo e chiamano `ctx.ui.setStatus`,
che **esiste anche in RPC** e viene consumato da pi-webview.

## Soluzione scelta (modo convenzionale, zero hardcode su pi-webview)

Estendere il _gate_ a includere `rpc`, lasciando il resto del flusso invariato.
Niente hardcoding nel client: la webview già mostra gli slot status in modo
convenzionale. Il criterio è un **allowlist esplicita** delle modalità che
hanno un consumer di `setStatus` (`tui`, `rpc`), non una negazione della TUI.

### Patch

`src/features/credits/index.ts` (unica riga):

```diff
-    if (ctx.mode !== "tui" || !config) return;
+    if ((ctx.mode !== "tui" && ctx.mode !== "rpc") || !config) return;
```

### Perché è sufficiente

- Gli eventi `session_start`, `model_select`, `turn_end`, `session_compact`,
  `session_tree`, `session_shutdown` sono emessi dal core (`agent-session.js` /
  `agent-session-runtime.js`) **indipendentemente dalla modalità**: RPC li
  riceve come TUI.
- `CreditsManager.refresh` usa solo `ctx.ui.setStatus`, `ctx.ui.theme`,
  `ctx.modelRegistry`, `ctx.model` — tutti disponibili in RPC.
  Il tema RPC è il **vero** tema (`rpc-mode.js` importa
  `interactive/theme/theme.js`), quindi `renderCredits` produce output corretto.
- `ctx.ui.setStatus` in RPC emette `extension_ui_request` con chiave
  `"credits"` (STATUS_KEY); pi-webview la rende nel footer senza modifiche.

## Effetti collaterali noti (accettati, fuori scope)

- Il comando **`/codex-resets`** (provider Codex) usa `ctx.ui.custom`, che in
  RPC è un no-op (`async custom() { return undefined; }`). In webview il
  comando verrebbe registrato ma **non renderizzerebbe** il pannello. Non è un
  crash (il handler ritorna `undefined`), e prima d'ora il comando nella
  webview non esisteva affatto (feature gated su TUI): nessuna regressione.
  Il fix per `ui.custom` in RPC è un problema pi-core separato
  (`docs/issues/pi-core/ui-custom-rpc-not-supported.md`).

## Verifica

- In pi-spark: `pnpm typecheck` (script npm del fork).
- In pi-webview (dev): installare la build del fork in modalità dev e avviare
  con `pi --mode rpc`; verificare che la status line mostri il saldo del
  provider attivo (es. "Codex 5h…") nel footer della webview.
- Confermare che con una modalità senza consumer di setStatus (es. `sdk`) la
  feature resti disabilitata (nessun cambiamento per le altre modalità).
