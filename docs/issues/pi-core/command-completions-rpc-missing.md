# getArgumentCompletions non esposto via RPC (sottocomandi)

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/extensions/types.d.ts`)
- **Scoperto**: 2026-08-24 (piano 0003 — autocomplete command palette)
- **Stato**: aperto — da proporre upstream a @earendil-works

## Problema

I comandi estensione (e i built-in) possono registrare
`getArgumentCompletions(argumentPrefix)` (`RegisteredCommand`,
`extensions/types.d.ts` riga 856) — la funzione che produce i **sottocomandi**
dell'autocomplete del TUI (es. `/vision-handoff` → `select`, `model`,
`status`, `enable`, `disable`).

La RPC `get_commands` restituisce però SOLO `{ name, description, source,
sourceInfo }` — **niente sottocomandi**:

```js
// rpc-mode.js, case "get_commands":
commands.push({ name, description, source: "extension", sourceInfo });
```

Né l'API estensioni espone le completion di ALTRE estensioni
(`session.getCommands()` → stessi `SlashCommandInfo`, senza
`getArgumentCompletions`).

## Impatto

Un client RPC (webview) non può mostrare l'autocomplete dei sottocomandi
come fa il TUI: vede solo il comando top-level e la descrizione. Gli
argomenti si completano a mano (poi pi esegue il comando comunque).

## Cosa è verificabile già oggi via RPC

- `/model <prefix>` → `get_available_models` (modelli live);
- gli altri argomenti → solo `argumentHint` statico (presente su pochi
  built-in: `model`, `login`).

## Fix suggerito (upstream)

Nuova RPC `get_command_completions { command, argumentPrefix }` che chiami
in-process il `getArgumentCompletions` del comando registrato e ritorni gli
item; oppure estendere `get_commands` con le completion. Dà alla webview
l'autocomplete esatto del TUI (vision-handoff compreso).
