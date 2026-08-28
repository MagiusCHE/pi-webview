# Built-in slash commands assenti da get_commands e non eseguibili via prompt

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/agent-session.js`)
- **Scoperto**: 2026-08-24 (piano 0003 — command palette)
- **Stato**: aperto — da valutare se è un bug o un limite voluto

## Problema 1 — `get_commands` non include i built-in

`get_commands` (rpc-mode) restituisce solo:

- comandi **estensione** (`extensionRunner.getRegisteredCommands()`),
- **template** prompt,
- **skill** (`skill:<name>`).

I **comandi built-in** (`/compact`, `/new`, `/model`, `/export`, `/fork`… —
`BUILTIN_SLASH_COMMANDS` in `core/slash-commands.js`, 22 voci) **non
compaiono**: esistono solo nel TUI (`interactive-mode.js`
`createBaseAutocompleteProvider`). Un client RPC non ha modo di conoscere la
lista dei built-in se non copiandola a mano.

## Problema 2 — i built-in non vengono eseguiti via `prompt`

In RPC mode, `session.prompt()` intercetta solo:

- **comandi estensione** (`_tryExecuteExtensionCommand`),
- **skill/template** (espansione).

I built-in (es. inviare `/compact` come prompt) **non sono gestiti**: finirebbero
come testo al modello LLM. Il TUI li intercetta PRIMA di inviare; in RPC mode
non c'è quel passaggio.

## Impatto

- La palette non può elencare i built-in (devono essere una lista statica nel
  client, oppure mappati su RPC native dove esistono: `compact`, `new_session`,
  `set_model`, `export_html`, `fork`, `clone`, `get_tree`, `reload`…).
- Inviare un built-in come testo non fa nulla di utile.

## Nota

Alcuni built-in hanno già RPC native equivalenti (vedi sopra): in questi casi
il client può mapparli. Per quelli senza RPC (`/import`, `/share`, `/login`,
`/logout`, `/changelog`, `/hotkeys`, `/scoped-models`) non c'è percorso via
RPC.

## Fix suggerito (upstream)

1. Includere i built-in in `get_commands` (con `source: "builtin"` e
   `argumentHint`);
2. valutare un comando RPC `slash <builtin> <args>` che replichi il
   dispatcher del TUI (o documentare esplicitamente che i built-in in RPC
   mode vanno invocati solo via le RPC native).
