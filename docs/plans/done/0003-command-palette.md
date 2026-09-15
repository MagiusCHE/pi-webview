# Piano 0003 — Comandi slash dalla GUI: autocomplete inline (come pi.dev) + palette

> Stato: **parzialmente IMPLEMENTATO (2026-08-28)** — V1-bis completata:
> `/settings` intercetta e apre il pannello, la sezione pi.dev è popolata dal
> facade `get_settings`/`set_setting` (contratto in protocol.ts, tabella in
> `src/bridge/pi-settings.ts`, handler in host VS Code + bridge standalone,
> rendering dinamico nella webview, write RPC per le chiavi session e write
> su file con riavvio per le chiavi `pi-settings-file` — propagazione scelta:
> riavvio con warning). ANCORA da implementare: V1 autocomplete/palette dei
> comandi estensione (vedi sezioni V1/V2).
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

**`/settings` è il caso più estremo** (verificato nel core 2026-08-28): nel
TUI è un case speciale hardcoded nel submit handler
(`if (text === "/settings") { this.showSettingsSelector(); … }`) che apre un
**form interattivo a schermo pieno** (`SettingsSelectorComponent`, ~30
impostazioni, ognuna con callback sul `settingsManager`). **Nessuna RPC
`get_settings`/`set_settings` esiste nel protocollo di pi** (il sottoinsieme
RPC reale è solo model/thinking/steering/followUp/autoCompaction); in RPC
mode `/settings` non è intercettato (solo i comandi estensione lo sono, via
`_tryExecuteExtensionCommand`) → finirebbe al modello come testo.
→ in webview `/settings` NON va MAI inviato a pi: va intercettato nella
composer e mappato sul pannello settings (stesso pattern del case speciale
del TUI). La sezione "pi.dev" del pannello è alimentata dal facade descritto
sotto.

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
- `/settings` rientra in questa categoria ma con meccanismo dedicato: vedi
  la sezione `V1-bis` sotto (facade `get_settings`/`set_setting`).
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

### V1-bis — Sezione "pi.dev" del pannello settings: facade get_settings/set_setting

**Decisione (2026-08-28):** `/settings` è separato da TUTTI gli altri comandi:

- NIENTE palette, NIENTE invio al modello: digitare `/settings` nella composer
  intercetta e apre il pannello settings (case speciale come il TUI).
- La sezione "pi.dev" del pannello (oggi placeholder con nota "usa il
  terminale pi") viene popolata dinamicamente da un **facade simulato**:
  pi.dev non implementa `get_settings`/`set_settings` → host/bridge li
  simulano con una tabella di definizioni che estendiamo di volta in volta.
  Se in futuro pi.dev li implementerà davvero, il facade diventa un
  **pass-through** e la webview non cambia di una riga (il contratto è nostro).

**Contratto (protocollo IDE, `src/ide/protocol.ts`):**

- `get_settings { key?: string }` →
  `{ settings: PiSetting[], workspace?: string, workspaceTrusted?: boolean }`
  (tutti o il singolo richiesto). PiSetting = definizione + valore attuale:
  ```ts
  interface PiSetting {
    key: string; // "thinking.hideBlock" | "steering.mode" | …
    label: string; // chiave i18n (it/en)
    description?: string; // chiave i18n
    type: "boolean" | "number" | "enum" | "string";
    options?: { value: string; label: string }[]; // per enum
    min?: number;
    max?: number;
    step?: number; // per number
    value: unknown; // valore attuale (merge global+project)
    writable: boolean; // false → UI disabilitata (stub/sola lettura)
    source: "pi-rpc" | "pi-settings-file" | "stub";
    scope: "global" | "project" | "both" | "session"; // dove può essere scritto
  }
  ```
- `set_setting { key: string; value: unknown; scope?: "global" | "project" }`
  → per ora **STUB**: risposta ok + warning "non ancora implementato" (chiave
  i18n già esistente: `cmdNotImplemented`). Il contratto prevede già
  `writable`/`source`/`scope` così l'implementazione per singola chiave non
  cambia il protocollo.

### Scope di scrittura (verificato nel core di pi.dev)

Modello di pi.dev (`SettingsManager`, `settings-manager.js`): due file,
`~/.pi/agent/settings.json` (global) e `<cwd>/.pi/settings.json` (project);
il **valore effettivo è il merge** (`deepMergeSettings(global, project)`, il
project vince); le scritture sono **scoped per-setting** con lockfile e merge
dei soli campi modificati; i **progetti non trusted non hanno override di
progetto** (`loadFromStorage("project")` → `{}`); alcuni setting scrivono su
global ma in lettura considerano anche l'override di progetto (es.
`setHideThinkingBlock` → global). Il nostro facade replica lo stesso modello,
dichiarato per chiave:

- `scope: "global"` — scrive solo su `~/.pi/agent/settings.json`.
- `scope: "project"` — scrive solo su `<workspace>/.pi/settings.json`
  (richiede workspace **trusted**; se non trusted → rifiuto con motivo,
  come pi.dev).
- `scope: "both"` — scrivibile su entrambi. Target di default del
  `set_setting`: **project se il workspace è trusted** (override, coerenza
  col merge in lettura), altrimenti global. Il parametro opzionale `scope`
  del `set_setting` forza il target (es. "salva come default globale").
- `scope: "session"` — i `pi-rpc` (model/thinkingLevel/steeringMode/
  followUpMode/autoCompaction): **non su file** — il write è live via RPC
  (il default per le sessioni future è una chiave a sé, es. `defaultModel`
  del selector di pi.dev).

Regole di scrittura comuni (le stesse di pi.dev, da replicare nel facade):

- **lock + scrittura atomica** del file JSON (pattern `withLock`: lockfile,
  merge dei soli campi modificati; per chiavi nested preservare il resto del
  parent, es. `compaction.*`).
- `set_setting` con `scope: "project"` su workspace non trusted → **rifiuta**
  (stesso motivo di pi.dev: un progetto non trusted non può avere override).
- `workspace`/`workspaceTrusted` nel payload di `get_settings` → la webview
  sa se l'override di progetto è possibile e può mostrarlo (es. badge
  "default globale" vs "override di progetto").

### Set via file: problemi e strategia di propagazione (verificato nel core)

Per le chiavi `pi-settings-file` il file è OGGI l'unico canale di scrittura
(verificato: nessuna RPC settings nel protocollo, zero "settings" nei tipi
API estensioni, TUI solo interattivo). Problemi concreti:

- **Cache in memoria**: `SettingsManager` tiene il merge `global+project` in
  RAM; la sessione/TUI leggono da lì, non dal file. Scrivere il file non
  cambia nulla finché non si ricarica o riavvia.
- **Validazione**: a load pi.dev valida/migra (`migrateSettings`,
  `settings-diagnostics`, `recordError`); un valore invalido scritto da
  fuori è visto solo al reload, senza feedback immediato → il facade deve
  validare da sé (type/enum/min-max dallo schema `PiSetting`).
- **Lock/merge**: pi.dev persiste con lockfile e merge dei soli campi
  modificati (`persistScopedSettings`); il facade deve replicarlo
  (lock + read-modify-write preservando i campi sconosciuti) per evitare
  lost-update con la TUI e distruzioni di file.
- **Scope**: se il project ha un override, scrivere su global non ha effetto
  visibile (project vince) — serve la regola scope/trusted già definita.
- **Path**: `~/.pi/agent/settings.json` rispetta `PI_AGENT_DIR`; il project
  file è `<cwd>/.pi/settings.json` con la cwd della SESSIONE pi (che può
  differire dal workspace IDE).

Propagazione dopo la scrittura (3 opzioni, da scegliere per chiave):

1. **Riavvia pi** — con warning se c'è elaborazione in corso (pattern già
   esistente dei CLI flags "Applica"). Semplice e sicuro.
2. **Reload in-process** — `settingsManager.reload()` rilegge entrambi i
   file (project solo se trusted) ed è chiamato da `ctx.reload()`; in RPC
   mode `/reload` non è intercettato, ma la nostra estensione pi (dentro
   pi.dev) può esporre un comando interno che chiama `ctx.reload()`.
   Costo: reload pesante (session_shutdown/session_start, ricarica
   estensioni/skill/risorse) — non esiste reload-solo-settings esposto.
3. **Nessuna propagazione** — il default vale dalla prossima sessione
   (accettabile per chiavi "default" es. hideThinkingBlock).

→ Scelta presa (2026-08-28): propagazione **(1) riavvio con warning** (pattern
"Applica" dei CLI flags). Il `set_setting` per chiavi `pi-settings-file` è
QUINDI scrivibile (`writable: true`): la webview conferma, poi il host scrive
il file e riavvia pi (connection_closed reason restart + pi_restarted →
re-init senza reload). Lo stub con warning resta solo per chiavi future
senza propagazione.

**Tabella delle definizioni (sorgente unica):** `src/bridge/pi-settings.ts`
(nuovo, stesso ruolo di `companions.ts`): definizioni + get/set per chiave.
Condiviso da `src/adapters/vscode/host.ts` e `src/bridge/index.ts` (niente
logica duplicata); mirror C# per Visual Studio (riusa `PiThinkingSettingsReader`
già esistente) da pianificare con la prossima build VS.

**Valori: 3 sorgenti, dichiarate nella tabella per chiave:**

- `pi-rpc` — chiavi già raggiungibili con le RPC reali di pi: model,
  thinkingLevel, steeringMode, followUpMode, autoCompaction (via `get_state`;
  write via `set_model`/`set_thinking_level`/`set_steering_mode`/
  `set_follow_up_mode`/`set_auto_compaction` — esistono già). → GET subito e
  (in futuro) SET reali a costo quasi zero.
- `pi-settings-file` — chiavi lette da `~/.pi/agent/settings.json` (+ progetto
  `<cwd>/.pi/settings.json`) come già fa `readThinkingSettings` per
  `hideThinkingBlock` (scope dichiarato per chiave: es. hideThinkingBlock è
  `both` — legge il merge global+project, scrive su global). GET via file;
  SET via file RISCHIOSO (cache del `settingsManager` di pi +
  validazione/diagnostics + serve `/reload`) → resta `writable: false`
  finché non si propone la RPC upstream.
- `stub` — chiavi del `SettingsSelectorComponent` di pi.dev non ancora
  implementate. Scelta: si parte con le chiavi reali implementate e la lista
  si estende per incrementi (aggiungere un setting = una riga nella tabella,
  zero HTML).

**NON va fuso** `get_settings` con la user-config del companion
(`getConfig`/`setConfig`: locale, tema webview, storico, notifiche, stats
bar): sono due strati diversi (settings di pi.dev vs config dell'addon). La
sezione "Webview" del pannello resta alimentata da `getConfig`;
`get_settings` alimenta SOLO la sezione "pi.dev".

**Rendering webview:** generalizzazione del pattern già esistente
`getCliFlags`/`renderCliFlags` (righe costruite dinamicamente da
`CliFlagInfo`): renderer schema-driven che per ogni `PiSetting` mostra il
controllo giusto (toggle per boolean, select per enum, number/input per il
resto), disabilitato quando `writable: false` con tooltip "gestito da
pi.dev / non ancora implementato".

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

**Per il facade settings (V1-bis):**

- `src/bridge/pi-settings.ts` (nuovo) — tabella definizioni + get/set per
  chiave (facade; pass-through quando pi.dev implementerà).
- `src/ide/protocol.ts` — `get_settings`/`set_setting` + tipo `PiSetting`.
- `src/adapters/vscode/host.ts`, `src/bridge/index.ts` — handler (usano il
  modulo condiviso); mirror C# per VS (riusa `PiThinkingSettingsReader`).
- `src/web/main.ts` + `index.html` + `style.css` + `locale` — renderer
  schema-driven della sezione pi.dev + intercept `/settings` nella composer.

## Passi (ordine suggerito)

1. **Dati**: fetch `get_commands`, filtro source `extension`.
2. **Dropdown inline**: trigger `/`, render righe, ↑/↓, Enter/Tab/Esc,
   contatore; integrazione con Enter-stearing ed Esc-STOP.
3. **Esecuzione**: selezione → fill composer + Invio (pi esegue il comando
   estensione, anche durante lo streaming). Niente mappa RPC.
4. **Palette Ctrl+K** + i18n + test manuali.

**Passi settings (fase separata, V1-bis):** 5. **Contratto + tabella**: `get_settings`/`set_setting` + `PiSetting` in
`protocol.ts` (con `scope` e `workspace`/`workspaceTrusted`);
`pi-settings.ts` con le prime chiavi reali (thinking.hideBlock da
settings.json, scope `both`; steering/followUp/thinkingLevel/model/
autoCompaction da `get_state`, scope `session`); handler in host.ts e
index.ts. 6. **Rendering dinamico**: renderer schema-driven della sezione pi.dev
(pattern `renderCliFlags` generalizzato), controlli per tipo, disabled
su `!writable`, i18n. 7. **Intercept `/settings`** nella composer → apre il pannello (mai inviato
a pi). `set_setting`: stub con warning (decisione presa). 8. **Mirror C#** (VS) + test + build VSIX VS Code.

## Test manuali

- `/` → lista dei SOLI comandi estensione; digitando filtra (prefisso e fuzzy).
- `/vision-handoff` → compare il comando (descrizione); completando a mano
  i sottocomandi e inviando, pi lo esegue (anche durante streaming).
- Enter con dropdown aperto NON invia/accoda; Esc chiude e NON fa stop.
- I built-in (export/fork/clone/…) NON compaiono nella palette (vedi
  `docs/commands-todo.md`).
- Palette Ctrl+K: filtra e riempie la composer.
- `/settings` nella composer → apre il pannello settings, NON invia nulla a pi.
- Sezione pi.dev: righe generate dalle definizioni (toggle/select/input),
  `writable: false` disabilitate con tooltip.
- `set_setting` → warning "non ancora implementato" (nessun crash).
- `get_settings` senza key → tutti i settings; con key → il singolo.
- Scope visibile: badge "default globale" vs "override di progetto" quando
  `workspaceTrusted`; `set_setting` su project non trusted → rifiuto.

## Futuro

- RPC `get_command_completions` (proposta upstream) → sottocomandi estensione
  e `/login` a piena parità col TUI.
- Quando pi.dev implementerà `get_settings`/`set_settings`: il facade in
  `pi-settings.ts` inoltra a pi (pass-through) — contratto invariato, webview
  invariata. Proposta upstream: stessa categoria di `get_command_completions`
  e `ui.custom` (vedi `docs/issues/pi-core/`).
- SET via file per le chiavi `pi-settings-file`: oggi file = unico canale;
  propagazione con riavvio (1) o reload via comando estensione interno
  `ctx.reload()` (2) — vedi sezione "Set via file". La RPC upstream
  `get_settings`/`set_settings` resta la soluzione definitiva (da proporre
  insieme a `get_command_completions` e `ui.custom`).
