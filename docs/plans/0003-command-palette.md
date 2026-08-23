# Piano 0003 — Comandi slash dalla GUI: autocomplete inline (come pi.dev) + palette

> Stato: **BOZZA aggiornata** — da implementare (analisi autocomplete completata).
> Riferimenti: concept 0001/0002, piano 0004 (stearing: l'Invio accoda durante
> l'elaborazione — l'autocomplete deve integrarsi con quello).

## Obiettivo

Dare alla webview i **suggerimenti dei comandi slash e l'autocomplete** come fa
pi.dev: digitando `/` nella composer appare la lista dei comandi (filtrata in
tempo reale), con **sottocomandi/argomenti** quando il comando li prevede
(es. `/vision-handoff` → `select`, `model`, `status`, `enable`, `disable`,
con contatore `(n/N)`). In più una **command palette** (Ctrl+K) per esplorare
tutti i comandi.

## Come fa pi.dev (verificato nel codice)

### Sorgente dei suggerimenti (TUI, interactive-mode.js)

`createBaseAutocompleteProvider()` costruisce la lista unendo:
1. **Comandi built-in** — `BUILTIN_SLASH_COMMANDS` (`core/slash-commands.js`,
   22 comandi, ognuno con name + description; solo `model` e `login` hanno
   `argumentHint`);
2. **Prompt templates** (name, description, argumentHint);
3. **Comandi estensione** — da `extensionRunner.getRegisteredCommands()`
   (name = invocationName, description) + **`getArgumentCompletions`**;
4. **Skill** — `skill:<name>`.

### Da dove arrivano i SOTTOCOMANDI (il punto chiave)

I sottocomandi di `/vision-handoff` NON sono in `get_commands`: arrivano da
**`getArgumentCompletions(argumentPrefix)`**, una funzione JavaScript che vive
**dentro il processo di pi** (registrata dall'estensione o dal comando
built-in, `RegisteredCommand.getArgumentCompletions` in `types.d.ts` riga 856).
Il TUI la chiama in-process. Al filtering fa `createFuzzyAutocompleteItems`.

### Esecuzione (verificata)

Via `prompt` (rpc-mode):
- **comandi estensione** (es. `/vision-handoff …`) → eseguiti SUBITO, anche
  durante lo streaming (`_tryExecuteExtensionCommand`);
- **skill** (`/skill:name`) e **template** → espansi da pi prima dell'invio;
- **built-in** (`/compact`, `/new`, `/model`, …) → **NON intercettati** in RPC
  mode: finirebbero come testo al modello. → vanno mappati su RPC native.

### Vincolo RPC (verificato)

- `get_commands` restituisce SOLO `{name, description, source, sourceInfo}`
  per estensione/template/skill — **niente sottocomandi**;
- le estensioni vedono solo `session.getCommands()` (stesso sottoinsieme) —
  **impossibile** raggiungere `getArgumentCompletions` di un'ALTRA estensione
  né via RPC né via API estensioni;
- `get_available_models` esiste come RPC (per `/model`).

## Architettura proposta

### V1 — palette/autocomplete client-side (nessuna modifica a pi)

**Dati (fonte unica, no hardcode estesi):**
- SOLO comandi estensione da `get_commands` (source `extension`), fetch a
  boot e su `/reload`-equivalente (pulsante ricarica estensioni, quando
  esisterà); filtro client-side (prefisso + fuzzy).
- I built-in/skill/template NON sono in palette: vedi `docs/commands-todo.md`.

**Autocomplete argomenti calcolabile lato webview:**
- `/model <prefix>` → `get_available_models` RPC → filtraggio fuzzy client-side
  (vero autocomplete live, come il TUI);
- `/login <prefix>` → provider derivati dai modelli (approssimazione);
- altri → si mostra `argumentHint` come descrizione.

**Selezione dei comandi — decisione: SOLO comandi delle estensioni:**
- La palette mostra ESCLUSIVAMENTE i comandi con sorgente `extension` di
  `get_commands` (es. `/vision-handoff …`, `/pi-x-ide …`): sono gli unici
  senza equivalente UI e gli unici che pi esegue via `prompt` anche durante
  lo streaming.
- TUTTI i built-in (inclusi `/export`, `/fork`, `/clone`, `/tree`, `/copy`,
  `/reload`, `/session`) e le skill/template sono **esclusi**: andranno
  implementati come funzioni UI dedicate, valutati uno per uno in
  `docs/commands-todo.md`. Vedi quel file per lo stato.
- L'esecuzione quindi è banale: selezione → si riempie la composer col testo;
  Invio invia e pi esegue il comando estensione (anche a turno attivo).
  Nessuna mappa RPC per i built-in (non servono più).

**UI (come lo screenshot):**
- trigger: il testo inizia con `/` → dropdown sotto la textarea (o sopra,
  come i popover esistenti, con clamp anti-overflow);
- righe: nome (mono) + descrizione (dim) + tag sorgente; selezione evidenziata;
  footer `(n/N)`; max ~8 visibili con scroll;
- tastiera: ↑/↓ naviga, **Enter/Tab** accetta (completa il comando; con
  argomenti → aggiunge spazio), **Esc** chiude (intercettato PRIMA dello
  STOP-Esc del piano 0004), click seleziona;
- **integrazione con lo stearing**: quando il dropdown è aperto, Enter accetta
  il suggerimento (NON invia/accoda); chiuso, Enter si comporta come sempre;
- funziona anche DURANTE l'elaborazione (`get_commands` è una RPC leggera che
  non disturba lo streaming);
- **comandi che richiedono dialoghi** (`select`/`confirm`/`input` via
  `extension_ui_request`): in VS Code li gestisce il companion con UI nativa;
  in **standalone (piw) li gestisce la webview** con i propri modali
  (✅ implementato: `handleExtensionUiRequest` + `showSelect`, risposta
  `extension_ui_response` — mai lasciare l'estensione in attesa).

**Palette (Ctrl+K):** modale che elenca tutti i comandi (stessa lista) con
filtro, per esplorazione; selezionando un comando si riempie la composer.

### V2 — parità totale dei sottocomandi (es. `/vision-handoff`)

I sottocomandi richiedono una feature del **core di pi** (non patchabile da
qui): estendere `get_commands` con le completion, o nuova RPC
`get_command_completions { command, argumentPrefix }` che chiami in-process
`getArgumentCompletions` del comando registrato → la webview otterrebbe
ESATTAMENTE l'autocomplete del TUI. Da proporre upstream (pi-agent).
Alternativa parziale senza core: la nostra estensione pi-webview registra i
propri comandi con `getArgumentCompletions` (copre solo i suoi).

## File toccati

- `src/web/slash-commands.ts` (nuovo) — tipo comando + fetch `get_commands`
  e filtro source `extension`.
- `src/web/autocomplete.ts` (nuovo) — filtraggio (prefisso+fuzzy), stati
  tastiera, `(n/N)`.
- `src/web/main.ts` — trigger su input, dropdown DOM, integrazione Enter/Esc
  con stearing, esecuzione (fill composer + invio), palette Ctrl+K.
- `src/web/index.html` + `style.css` — `.cmd-dropdown`, righe, footer contatore.
- `src/web/locale/{it,en}.json` — stringhe.

## Passi (ordine suggerito)

1. **Dati**: fetch `get_commands`, filtro source `extension`.
2. **Dropdown inline**: trigger `/`, render righe, ↑/↓, Enter/Tab/Esc,
   contatore; integrazione con Enter-stearing ed Esc-STOP.
3. **Esecuzione**: selezione → fill composer + Invio (pi esegue il comando
   estensione, anche durante lo streaming). Niente mappa RPC.
4. **Palette Ctrl+K** + i18n + test manuali.

## Test manuali

- `/` → lista dei SOLI comandi estensione; digitando filtra (prefisso e fuzzy).
- `/vision-handoff` → compare il comando (descrizione); completando a mano
  i sottocomandi e inviando, pi lo esegue (anche durante streaming).
- Enter con dropdown aperto NON invia/accoda; Esc chiude e NON fa stop.
- I built-in (export/fork/clone/…) NON compaiono nella palette (vedi
  `docs/commands-todo.md`).
- Palette Ctrl+K: filtra e riempie la composer.

## Futuro

- RPC `get_command_completions` (proposta upstream) → sottocomandi estensione
  e `/login` a piena parità col TUI.
