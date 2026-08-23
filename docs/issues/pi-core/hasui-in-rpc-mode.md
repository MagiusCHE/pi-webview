# hasUI = true in RPC mode ma ui.custom non funziona → falsi negativi

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/extensions/runner.js`)
- **Scoperto**: 2026-08-24 (comando `/sessions` in webview)
- **Stato**: aperto — da proporre upstream a @earendil-works

## Problema

In RPC mode `ctx.hasUI` è **true** (il uiContext RPC non è il no-op:

```js
hasUI() { return this.uiContext !== noOpUIContext; }
```

`extensions/runner.js` riga 274), ma `ui.custom()` **non funziona** (ritorna
`undefined`, vedi `ui-custom-rpc-not-supported.md`).

Le estensioni usano `ctx.hasUI` per scegliere il ramo UI vs. il ramo
"console/plain": con `hasUI === true` prendono il ramo UI → `ui.custom` →
`undefined` → comportamento rotto o **falso negativo**.

## Esempio concreto: `/sessions`

`pi-agent-extensions/extensions/sessions/index.ts` `listSessions(ctx)`:

```ts
if (!ctx.hasUI) {
    const sessions = await SessionManager.list(ctx.cwd);  // ramo CORRETTO
    return sortSessions(sessions);
}
const sessions = await ctx.ui.custom<SessionInfoLike[] | null>(...); // → undefined
```

Poi `runSessionsCommand`: `if (!sessions || sessions.length === 0)` → **VERO**
→ notifica `"No sessions found for this project."` — anche se le sessioni
esistono. Il messaggio è un **falso negativo**: non è che non ci sono
sessioni, è che il ramo UI non può funzionare.

## Fix suggerito (upstream)

`hasUI` in RPC mode dovrebbe riflettere solo i metodi **realmente
supportati** (select/confirm/input/editor/notify/setStatus/setWidget), NON
`ui.custom`. Così le estensioni cadrebbero sul ramo non-UI
(`SessionManager.list` + output testo) e i comandi funzionerebbero anche in
webview, con la resa "povera" ma corretta.

Alternativa: implementare `ui.custom` su RPC (vedi
`ui-custom-rpc-not-supported.md`) e tenere `hasUI = true`.

## Workaround lato pi-webview

Nessuno lato client: la decisione è nell'estensione, in base a `hasUI`.
Per i comandi che ci servono: UI nativa webview (`docs/commands-todo.md`).
