# Comandi slash di pi — da valutare come funzioni UI

> Scopo: elenco dei comandi built-in di pi (e skill/template) che **non** vanno
> nella command palette come semplici comandi: andrebbero implementati come
> funzionalità UI dedicate (come già fatto per compact, new, model, resume,
> trust, name, settings). Li valutiamo uno per uno e li spostiamo qui sotto
> man mano che vengono implementati.
> Fonte: `BUILTIN_SLASH_COMMANDS` di pi (`dist/core/slash-commands.js`).

## Già implementati in UI (riferimento, NON in questa lista)

`/settings` (ingranaggio), `/model` (chip), `/new` (pulsante), `/compact`
(gauger), `/resume` (dropdown), `/trust` (chip), `/name` (✎ rinomina).

## Da valutare (uno per uno)

| Comando          | Descrizione (da pi)                                              | Stato RPC                      | Proposta UI                                                                          | Deciso |
| ---------------- | ---------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ | ------ |
| `/session`       | Show session info and stats                                      | `get_state`                    | Pannello/status con info sessione (file, id, messaggi, costo)                        | ⏳     |
| `/export`        | Export session (HTML default, o path .html/.jsonl)               | `export_html`                  | Pulsante "esporta" (menu sessione) con scelta formato                                | ⏳     |
| `/fork`          | Create a new fork from a previous user message                   | `fork`                         | Azione "fork" su un messaggio (menu contestuale)                                     | ⏳     |
| `/clone`         | Duplicate the current session                                    | `clone`                        | Pulsante "duplica sessione" (dropdown sessioni)                                      | ⏳     |
| `/tree`          | Navigate session tree (switch branches)                          | `get_tree`                     | Vista rami/derivazioni della sessione                                                | ⏳     |
| `/copy`          | Copy last agent message to clipboard                             | `get_last_assistant_text`      | Pulsante copia sull'ultimo messaggio (già esistente per i blocchi codice; estendere) | ⏳     |
| `/reload`        | Reload keybindings, extensions, skills, prompts, themes, context | `reload`                       | Pulsante "ricarica estensioni" (impostazioni)                                        | ⏳     |
| `/login`         | Configure provider authentication                                | — (no RPC)                     | Maschera provider nella maschera impostazioni                                        | ⏳     |
| `/logout`        | Remove provider authentication                                   | —                              | Idem, con revoca                                                                     | ⏳     |
| `/import`        | Import and resume a session from JSONL                           | — (no RPC)                     | Apri file .jsonl → fork/resume                                                       | ⏳     |
| `/share`         | Share session as secret gist                                     | — (no RPC)                     | Pulsante condividi (menu sessione)                                                   | ⏳     |
| `/scoped-models` | Enable/disable models for cycling                                | —                              | Selettore modelli nel popover modelli                                                | ⏳     |
| `/changelog`     | Show changelog entries                                           | —                              | Voce "changelog" in impostazioni                                                     | ⏳     |
| `/hotkeys`       | Show all keyboard shortcuts                                      | —                              | Pannello scorciatoie (impostazioni)                                                  | ⏳     |
| `skill:<name>`   | Skill di pi (espansione prompt)                                  | get_commands (sorgente skill)  | Picker skill (es. menu in composer, come allegati)                                   | ⏳     |
| Template prompt  | Template utente (espansione prompt)                              | get_commands (sorgente prompt) | Picker template (menu in composer)                                                   | ⏳     |

## Decisione attuale

Per la **command palette (piano 0003)** implementiamo **SOLO i comandi delle
estensioni** (sorgente `extension` di `get_commands`). Tutto il resto di questa
tabella è escluso dall'implementazione finché non lo valutiamo e decidiamo
una UI dedicata. → si aggiorna la tabella spostando la riga in una sezione
"implementati" quando deciso.
