# AGENTS.md

## Cos'è

`pi-webview` — extension VS Code che sostituisce il terminale integrato usato
da "Pi x IDE" con un **WebView**, per interazione mouse/tastiera, selezione e
rendering ricco. Il core di pi gira in **headless** (`pi --mode rpc`), la
webview è la UI.

## Stack

- Extension host: TypeScript, VS Code Extension API
- Frontend webview: HTML/CSS/JS (TypeScript compilato), nessun framework
  deciso — da definire
- Package manager: **pnpm**
- Runtime: Node.js (extension host)

## Comandi

- `pnpm dev` — avvio dev completo: bridge (`--debug`) + vite (HMR) + browser
- `pnpm dev:bridge` — solo bridge in watch (`--debug`)
- `pnpm dev:web` — solo vite (HMR)
- `pnpm build` — build UI → `dist/web` (vite)
- `pnpm start` — uso standalone: build + bridge con `--serve dist/web --open`
- `pnpm test` — test unitari (`node --test`, TS nativo, niente tsx)
- `pnpm test:watch` — test in watch
- `pnpm smoke` — smoke test del bridge contro pi reale (no LLM)
- `pnpm compile` — build UI + adapter VS Code (per F5)
- `pnpm package:ide` — vsix del companion VS Code (→ `dist/pi-webview-ide.vsix`)
- `pnpm package:vs` — build UI + vsix del companion Visual Studio (→ `dist/pi-webview-visualstudio.vsix`; su Linux richiede `node tools/setup-vs-wine.mjs` una tantum: prefix wine dedicato nel progetto + patch al VSSDK nel nuget cache)
- `pnpm package:addon` — assembly del package pi (vsix VS Code + vsix VS + estensione pi-webview lato pi)
- `pnpm release -- --version 0.1.1 [--publish] [--tag <dist-tag>]` — prepara (bump versioni in entrambi i package.json, rebuild vsix+bundle+UI, `npm pack` di verifica); con `--publish` esegue anche `npm publish --access public` e crea in automatico il tag git `v<version>` + la GitHub release (idempotente: skip se già esistenti). Senza `--publish` non pubblica mai.
- `pnpm format` / `pnpm format:check` — prettier
- `pnpm typecheck` — `tsc --noEmit`
- Install: solo pnpm (bloccato da `preinstall` → `tools/check-package-manager.mjs`)
- pnpm 11: le impostazioni vivono in `pnpm-workspace.yaml`
  (il campo `pnpm` di package.json non è più letto)

## Architettura prevista (concept 0001 + 0002)

- Layering: UI web pura ↔ IDE bridge protocol ↔ host adapter ↔ pi core
- `pi --mode rpc` spawnato dall'host (JSONL su stdin/stdout, split solo su
  `\n`, mai `readline` di Node)
- Bridge Node stdio↔WebSocket per l'uso standalone (D5, decisione presa)
- Adapter VS Code = primo di tanti deploy (D3)
- Webview completa, no emulazione terminale (D1); UI lazy header/footer (D4)
- **Selezione/contesto editor: via API dell'IDE direttamente nell'adapter**
  (VS Code: `activeTextEditor` + `onDidChange*`, inviati con `selection_changed` /
  `selection_cleared` sul bridge protocol). Nessun WS né lock file di "Pi x IDE":
  pi-webview NON deve collidere con pi-x-ide in alcun punto (niente
  `~/.pi/pi-x-ide/`, niente porte/file condivisi). Il riuso dei lock file citato
  nel concept 0001 è stato superato dal piano 0002 (webview in-process).
- Riferimenti: `docs/concept/0001-webview-al-posto-del-terminale.md`,
  `docs/concept/0002-architettura-standalone-multi-ide-lazy-ui.md`,
  `docs/concept/0003-extension-ui-in-webview.md` (come i plugin "interfacciati"
  raggiungono la UI: gruppi A/B/C)

## Struttura directory

- `docs/concept/` — documenti di concept (numerati)
- `docs/plans/` + `docs/plans/done/` — piani (in corso / implementati)
- `src/` — codice sorgente (committato): `ide/` (IDE bridge protocol),
  `bridge/` (standalone, con `pi-process.ts` condiviso), `web/` (UI),
  `adapters/vscode/` (companion VS Code), `adapters/visualstudio/`
  (companion Visual Studio, C# — build su Linux via wine,
  `tools/setup-vs-wine.mjs`)
- `packages/pi-webview/` — **package pi** distribuito via `pi install`:
  estensione pi-webview lato pi (auto-install/auto-update dei companion
  VS Code + Visual Studio, confronto di versione coi vsix inclusi) + vsix
  companion inclusi + **standalone**
  (UI buildata `dist/web`, bridge `dist/bridge.js` e bin npm `piw` per aprire la
  UI nel browser da shell — `src/bridge/piw.ts`)
- `tests/` — test unitari (`pnpm test`, `node --test tests/`)
- `tools/` — script di sviluppo (es. `check-package-manager.mjs`)
- `dist/` — output build, **gitignored**, specchia `src/`

## Convenzioni

- **Commenti nel codice: SOLO in inglese** (mai commenti in italiano). Vale per tutto il sorgente: TS, CSS, HTML, script `tools/`, test.
- **Stringhe visibili all'utente: MAI hardcoded in una sola lingua** — passano SEMPRE dalla localizzazione: webview → `t()`/`tpl()` (JSON in `src/web/locale/`), companion VS Code → `hostT(locale, it, en)` con la locale letta dal config (`config.get().locale`). Notifiche desktop incluse. Nuove stringhe: aggiungere la chiave in `it.json` E `en.json`.
- Commit message in **inglese** (da ora in poi). Niente push automatico.
- **Firma dei commit**: aggiungere SEMPRE in coda il trailer
  `Co-authored-by: pi.dev <agent@pi.dev> (DeepSeek V4 Flash)` — con il nome
  del modello corrente della sessione al posto di "DeepSeek V4 Flash" (nome
  leggibile da provider+modello, es. da `PI_PROVIDER`/`PI_MODEL`). Deroga
  esplicita dell'utente alla regola globale che vieta le firme AI: vale solo
  per questo repo.
- **README: ruoli separati, mai duplicare**. La documentazione UTENTE
  (install, `piw`, install scripts/npm 12, uninstall, companion VS Code) vive
  SOLO in `packages/pi-webview/README.md` (la pagina npmjs la mostra). Il
  `README.md` root è il landing per sviluppatori (cos'è, stato, quick start
  dev, struttura, architettura) e NON ripete la doc utente: al massimo un link
  alla npm page (`https://www.npmjs.com/package/@magiusche/pi-webview`).
  Quando serve aggiornare una sezione utente, aggiornare SOLO il README del
  pacchetto; cambi di design del packaging vanno riflessi in entrambi i punti
  dove necessario ma senza duplicare contenuto
- Nessun secret/dato personale committato: `.env*`, file locali gitignored
- Nome progetto: `pi-webview`
- Package manager: **solo pnpm** (bloccato via `preinstall` →
  `tools/check-package-manager.mjs`)
- Script pnpm standard: `dev`/`dev:*`, `build`, `start`, `test`, `format`,
  `typecheck` (vedi piani in `docs/plans/`)
- Sorgente in `src/`, build in `dist/` (mai il contrario)
- **Deploy cross-platform** (Linux/macOS/Windows, D6): niente path o
  comandi unix hard-coded; `os.tmpdir()`/`path.join`; risoluzione binario
  `pi` (shim `.cmd` su Windows); check bash su Windows (requisito di pi)
- **Tema (D7)**: standalone → preferenza utente light/dark/system (default
  system), config in `src/bridge/config.ts` (cartella config utente per SO,
  accesso via `getConfig`/`setConfig`); in webview VS Code → tema dell'IDE
  (`data-vscode-theme-kind`, `--vscode-*`, `vscode-theme-changed`)
- **Grafica**: design system allineato a Codex (extension VS Code) — token
  derivati da `--vscode-*` con fallback standalone "Absolutely" (dark/light);
  thread centrato max 56rem, contenuti allineati a sinistra, niente bubble
  per l'assistente, accento terracotta `#cc7d5e` standalone, font base 16.5px.
  Loader spinner nel blocco pensiero durante l'elaborazione (niente status
  line ridondanti). Copia: un solo componente `.copy-btn` nei blocchi codice.
  Per verificare la grafica senza modello: `?demo=1` (+ `?theme=` `?lang=`)
- **i18n (locale)**: pattern radv-2/client — JSON per lingua in
  `src/web/locale/{it,en}.json`, `src/web/i18n.ts` (`t()`, fallback it),
  lingua di sistema dal browser, preferenza salvata in localStorage
  (`pi-webview-locale`) e nella config utente (campo `locale`,
  via `getConfig`/`setConfig`). Tutte le stringhe UI passano da `t()`
- **Markdown**: risposte renderizzate con `marked` + `DOMPurify`
  (`src/web/markdown.ts`), streaming con re-render a rAF; blocchi codice
  trasformati nel pattern `.code-block` con `Copia`. Il blocco pensiero è
  SEMPRE prima del testo (slot dedicato nel DOM), loader + timer secondi
  durante lo streaming, collassato per default (click per aprire)
- **Header**: niente brand/stato testuale — dropdown sessioni (lista da
  `src/bridge/sessions.ts`, `~/.pi/agent/sessions/`; switch via
  `switch_session` RPC + ricarica cronologia) + dot connessione + gear
  (settings: lingua e tema in pannello). `color-scheme` per tema sui form
  nativi (dropdown che rispettano il tema)
- **Runtime**: `src/web/environment.ts` rileva la modalità all'avvio
  (`standalone` | `vscode` | `ide`) per variare il comportamento in base
  all'ambiente (es. trasporto, tema, futuri comportamenti IDE)

## Integrazione IDE (distribuzione)

L'addon si installa con **`pi install ./packages/pi-webview`** (o da git/npm).
L'estensione pi-webview (lato pi) rileva l'IDE (VS Code) e **auto-installa il companion**
(`code --install-extension` sul vsix incluso) — modello pi-x-ide. Il companion
crea la webview della sidebar, spawna `pi --mode rpc` (env `PI_WEBVIEW_COMPANION=1`)
e parla l'IDE bridge protocol via postMessage. Sviluppo dell'adapter: F5 con
`launch.json` (Extension Development Host) dopo `pnpm compile`.

## Aggiornamento automatico

Aggiorna questo file solo quando introduci modifiche importanti, strutturali
e durevoli, come nuove librerie, cambi architetturali, nuove convenzioni,
comandi/tooling, contratti API o procedure di deploy. Non aggiornarlo per fix
ordinari, ritocchi UI, implementazioni banali, dettagli temporanei o
cronologia delle attività. Mantieni il file snello e utile alle sessioni
future.
