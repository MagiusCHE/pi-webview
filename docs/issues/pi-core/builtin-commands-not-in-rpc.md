# Built-in slash commands assenti da get_commands e non eseguibili via prompt

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/agent-session.js`)
- **Scoperto**: 2026-08-24 (piano 0003 — command palette)
- **Verificato**: 2026-09-05 su pi 0.85.1 (23 built-in; leak confermato via composer
  e via steering)
- **Stato**: aperto — da valutare se è un bug o un limite voluto

## Problema 1 — `get_commands` non include i built-in

`get_commands` (rpc-mode) restituisce solo:

- comandi **estensione** (`extensionRunner.getRegisteredCommands()`),
- **template** prompt,
- **skill** (`skill:<name>`).

I **comandi built-in** (`/compact`, `/new`, `/model`, `/export`, `/fork`… —
`BUILTIN_SLASH_COMMANDS` in `core/slash-commands.js`, 23 voci: settings, model,
tree, thinking, scoped-models, export, import, share, copy, name, session,
changelog, hotkeys, fork, clone, trust, login, logout, new, compact, resume,
reload, quit) **non compaiono**: esistono solo nel TUI
(`interactive-mode.js` `createBaseAutocompleteProvider`). Un client RPC non ha
modo di conoscere la lista dei built-in se non copiandola a mano.

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
  `set_model`, `export_html`, `fork`, `clone`, `get_tree`…).
- Inviare un built-in come testo non fa nulla di utile: il testo arriva al
  modello LLM come prompt (leak). Vale anche per il **steering**: un built-in
  accodato durante un turn viene consegnato a `prompt()` e finisce nello stesso
  modo.

## Mitigazione lato pi-webview (2026-09-05)

La webview intercetta i built-in digitati nel composer PRIMA dell'invio
(`sendOrStop`): `/compact`, `/new`, `/name` ripetono l'azione GUI omonima; i
comandi senza equivalente webview (`/reload`, `/login`, `/logout`, `/import`,
`/share`, `/scoped-models`, `/changelog`, `/hotkeys`, `/quit`, `/model`,
`/thinking`) non vengono mai inviati a pi (né prompt né steering) e mostrano
solo un messaggio in chat. `/reload` è coperto dal pulsante reload
(IdeRequest `restartPi`: riavvio del processo pi + reload della pagina).
Vedi `docs/commands-todo.md` → "Decisione attuale".

## Nota

Alcuni built-in hanno già RPC native equivalenti (vedi sopra): in questi casi
il client può mapparli. Per quelli senza RPC (`/import`, `/share`, `/login`,
`/logout`, `/changelog`, `/hotkeys`, `/scoped-models`) non c'è percorso via
RPC. Attenzione: **non esiste** la RPC `reload` (verificato in pi 0.85.1:
`rpc-mode.js` elenca tutti i casi gestiti; `/reload` del TUI non ha
controparte RPC).

## Fix suggerito (upstream)

1. Includere i built-in in `get_commands` (con `source: "builtin"` e
   `argumentHint`);
2. valutare un comando RPC `slash <builtin> <args>` che replichi il
   dispatcher del TUI (o documentare esplicitamente che i built-in in RPC
   mode vanno invocati solo via le RPC native).
