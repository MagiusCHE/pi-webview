# Nessuna RPC per abortire la compattazione (abort_compaction)

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/agent-session.js`)
- **Scoperto**: 2026-08-24 (webview pi-webview, compact durante elaborazione)
- **Stato**: aperto — da proporre upstream a @earendil-works

## Problema

`AgentSession.abortCompaction()` (agent-session.js riga 1488: abort del
`_compactionAbortController` e `_autoCompactionAbortController`) esiste ma è
chiamato **solo in-process**:

- dal TUI (`interactive-mode.js` riga 2703: `this.session.abortCompaction()`);
- da `dispose()` (riga 559) — che uccide l'intera sessione.

**Non è esposto né come RPC** (nessun comando `abort_compaction` in
rpc-mode) **né nell'API estensioni** (verificato in `extensions/types.d.ts`:
c'è `session.compact()` ma nessun `abortCompaction`).

`session.abort()` (RPC `abort`) NON ferma la compattazione: abortisce solo
l'agent run, e durante la compact non c'è un run attivo.

## Impatto

Un client RPC (webview) non può fermare una compattazione in corso: cliccare
il trigger della compact durante `compacting` deve mostrare un esito onesto
("non disponibile") finché il core non espone il comando.

## Fix suggerito (upstream)

RPC `abort_compaction`:

```json
{ "type": "abort_compaction" }
```

→ `session.abortCompaction()`; la compact in corso termina con
`compaction_end` + `errorMessage` ("Compaction cancelled"), stesso flusso
della cancellazione via dispose. (Eventualmente esporre anche
`abortCompaction` nell'API estensioni per coerenza con `compact()`.)

## Workaround lato pi-webview

Dialog alla conferma: "Compattazione in corso. Vuoi fermarla?" → alla
conferma, blocco informativo "Fermare la compattazione richiede una modifica
del core di pi.dev" (pattern dei comandi non implementati). Nessun finto
abort.
