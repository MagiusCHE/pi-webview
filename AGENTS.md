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
- `pnpm package:vscode` — vsix del companion VS Code (→ `dist/pi-webview-ide.vsix`)
- `pnpm package:visualstudio` — build UI + vsix del companion Visual Studio (→ `dist/pi-webview-visualstudio.vsix`; su Linux richiede `node tools/setup-vs-wine.mjs` una tantum: prefix wine dedicato nel progetto + patch al VSSDK nel nuget cache)
- `pnpm package:pi` — assembly del package pi (vsix VS Code + vsix Visual Studio + estensione pi-webview lato pi)
- `pnpm release -- --version 0.1.1 [--publish] [--tag <dist-tag>]` — prepara (bump versioni in entrambi i package.json, rebuild vsix+bundle+UI, `npm pack` di verifica); con `--publish` esegue anche `npm publish --access public` e crea in automatico il tag git `v<version>` + la GitHub release (idempotente: skip se già esistenti). Senza `--publish` non pubblica mai.
- **Release — build completa obbligatoria**: quando l'utente chiede una nuova release, compilare sempre tutti gli artefatti sulla macchina corrente, incluso il VSIX Visual Studio tramite Wine quando si opera su Linux. Non riutilizzare artefatti preesistenti o obsoleti e non chiedere se si debba compilare tutto: la richiesta di release autorizza e richiede la build completa.
- **Version bump — mai manuale**: cambiare la versione esclusivamente tramite `pnpm release -- --version <version> [--publish]`; non modificare mai a mano i campi `version` nei `package.json`.
- `pnpm format` / `pnpm format:check` — prettier
- `pnpm typecheck` — `tsc --noEmit`
- Install: solo pnpm (bloccato da `preinstall` → `tools/check-package-manager.mjs`)
- pnpm 11: le impostazioni vivono in `pnpm-workspace.yaml`
  (il campo `pnpm` di package.json non è più letto)

## Aggiornamento degli artefatti locali solo su richiesta

Al termine dello sviluppo ordinario **NON** compilare o reinstallare
automaticamente i companion VS Code/Visual Studio, non aggiornare il package
locale `piw` e non arrestare o riavviare il bridge. Eseguire la procedura
seguente solo quando l'utente lo richiede esplicitamente dicendo di
**aggiornare gli artefatti**. La richiesta di una release costituisce invece
autorizzazione separata e, in quel caso, prevale la regola di build completa
indicata sopra, incluso il VSIX Visual Studio compilato tramite Wine su Linux.

- **Riavvio del bridge attivo — tutte le piattaforme**: quando si aggiornano gli
  artefatti, se un bridge `piw` è attivo leggere e conservare dal lock porta,
  bind e token senza mai stampare il token; preservare anche tutte le opzioni
  runtime attive, in particolare `--no-idle`. Eseguire `piw -k` e riavviare in
  background sulla stessa porta/bind passando il token precedente al nuovo
  launcher esclusivamente tramite la variabile interna `PIW_RESTART_TOKEN`. Il
  vecchio URL autenticato deve continuare a funzionare. Verificare dopo il
  riavvio che configurazione e token siano rimasti invariati. Se nessun bridge
  era attivo, non inventare una porta e non avviarne uno implicitamente:
  segnalarlo chiaramente nel riepilogo finale.
- **Aggiornamento artefatti su Linux**: compilare il companion VS Code,
  reinstallarlo forzatamente e aggiornare anche il package locale `piw` (bundle
  launcher, bridge e UI servita dal browser). A fine lavoro comunicare
  all'utente che può eseguire il reload di VS Code e, se inizialmente attivo,
  che `piw` è stato riavviato in background, indicando la porta.
- **Aggiornamento artefatti su Windows**: compilare i companion VS Code e Visual
  Studio, reinstallare forzatamente entrambi e aggiornare anche il package
  locale `piw` (bundle launcher, bridge e UI servita dal browser). A fine lavoro
  comunicare all'utente che può eseguire il reload di VS Code e/o Visual Studio
  e, se inizialmente attivo, che `piw` è stato riavviato in background, indicando
  la porta.

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
  Il companion VS Code conserva l'ultima selezione in `workspaceState` e la
  ripubblica su richiesta della Webview dopo che il transport è pronto, così
  un Reload Window non la perde anche se il broadcast iniziale arriva troppo
  presto o il focus viene ripristinato direttamente sulla sidebar
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
  (UI buildata `dist/web`, bridge `dist/bridge.cjs` e bin npm `piw` per aprire la
  UI nel browser da shell — `src/bridge/piw.ts`); `scripts/` contiene utility
  CLI multipiattaforma aggiuntive, incluso `piw-public.mjs`, bundle e bin
  `piw-public` distribuito nello stesso package
- `tests/` — test unitari (`pnpm test`, `node --test tests/`)
- `tools/` — script di sviluppo (es. `check-package-manager.mjs`)
- `dist/` — output build, **gitignored**, specchia `src/`
- `.vscode-example/` — template impostazioni workspace (`.vscode/` è gitignored):
  `settings.json` disabilita il follow dei symlink ed esclude `**/.wine/**` da
  search/files/watcher. Su Linux il prefix wine (`src/adapters/visualstudio/.wine/`)
  espone `z:` → `/`: senza queste regole VS Code scansiona tutto il filesystem.
  L'utente lo usa copiando/rinominando la cartella in `.vscode/` quando serve

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
  (install, `piw`, install scripts/npm 12, uninstall, companion IDE) vive
  SOLO in `packages/pi-webview/README.md` (la pagina npmjs la mostra). Il
  `README.md` root è il landing per sviluppatori (cos'è, stato, quick start
  dev, struttura, architettura) e NON ripete la doc utente: al massimo un link
  alla npm page (`https://www.npmjs.com/package/@magiusche/pi-webview`).
  Quando serve aggiornare una sezione utente, aggiornare SOLO il README del
  pacchetto; cambi di design del packaging vanno riflessi in entrambi i punti
  dove necessario ma senza duplicare contenuto
- **README: matrice companion sempre aggiornata**. `README.md` (GitHub) e
  `packages/pi-webview/README.md` (npmjs) devono indicare chiaramente e in una
  lista dedicata tutti i companion IDE effettivamente implementati. Aggiornare
  entrambe le liste ogni volta che un companion viene aggiunto, rimosso o
  cambia supporto; non presentare come implementati adapter solo pianificati.
- Nessun secret/dato personale committato: `.env*`, file locali gitignored
- Nome progetto: `pi-webview`
- Package manager: **solo pnpm** (bloccato via `preinstall` →
  `tools/check-package-manager.mjs`)
- Script pnpm standard: `dev`/`dev:*`, `build`, `start`, `test`, `format`,
  `typecheck` (vedi piani in `docs/plans/`)
- Sorgente in `src/`, build in `dist/` (mai il contrario)
- **Deploy cross-platform** (Linux/macOS/Windows, D6): niente path o
  comandi unix hard-coded; `os.tmpdir()`/`path.join`; risoluzione binario
  `pi` (shim `.cmd` su Windows). La risoluzione della shell e gli eventuali
  errori del tool `bash` restano responsabilità del core di pi
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
- **Agentic thinking**: raggruppa attività interne consecutive senza creare
  wrapper assistant vuoti. Testo visibile, `ask_user`, compaction e messaggi
  utente iniettati via steering chiudono sia il blocco Agentic sia l'eventuale
  thought normale; l'attività interna successiva apre sempre un nuovo blocco.
  Prima di attività reale, dopo 1 secondo dall'avvio dell'elaborazione, il live
  shell mostra `Waiting for response`; diventa `Agentic thinking` solo al primo
  thought/tool. Durante una compaction automatica l'outer agent run resta
  attivo fino ad `agent_settled`: al `compaction_end` e al successivo
  `turn_start` composer, steering e STOP devono quindi restare attivi
- **Header**: niente brand/stato testuale — dropdown sessioni (lista da
  `src/bridge/sessions.ts`, `~/.pi/agent/sessions/`; switch via
  `switch_session` RPC + ricarica cronologia) + dot connessione + pulsante
  reload + gear (settings: lingua e tema in pannello). `color-scheme` per
  tema sui form nativi (dropdown che rispettano il tema). Ogni cambio,
  creazione, fork o cancellazione sessione attiva subito il loading overlay e
  blocca mouse, composer e shortcut fino al caricamento della nuova cronologia
- **Pulsante reload**: riavvia il processo pi (IdeRequest `restartPi`,
  gestito dai 3 host con la stessa meccanica dell'apply dei CLI flags:
  `connection_closed(reason restart)` + `pi_restarted` → re-init trasparente,
  sessione corrente ripresa) e poi ricarica la pagina (standalone:
  `location.reload`; IDE: `reloadWebview`, re-servita dall'host). Il prompt
  `/reload` non viene mai inviato a pi
- **CLI flags su sessioni vuote**: i flag restano per-sessione nel JSONL, ma
  durante `Applica` una sessione nuova e ancora vuota può perdere il proprio
  file mentre il vecchio processo pi termina. I 3 host devono quindi riavviare
  usando direttamente i valori appena applicati, mantenerli in memoria finché
  la sessione non espone il nuovo path e persisterli al successivo
  `storeSession`; non rileggerli soltanto dal file appena eliminato
- **Controllo aggiornamenti (scudo header)**: il check pi core + estensioni
  npm è **live, senza cache** (modulo `packages/pi-webview/lib/update-check.ts`):
  ogni avvio di pi lo esegue non bloccante a load dell'estensione e il
  risultato va nello startup-info per-pid con `updateCheckedAt` (timestamp
  dell'ultimo check completato). Lo scudo è SEMPRE visibile: azzurro = tutto
  all'ultima versione (click → check manuale ORA via `/piw update.check` +
  polling di `getStartupInfo` finché `updateCheckedAt` supera il momento del
  click; se emerge un aggiornamento → scudo giallo + dialog), giallo pulsante
  = aggiornamento disponibile (click → dialog di revisione →
  `/piw update.pi.core.exts`). I 3 host servono `getStartupInfo` dallo stesso
  file `~/.pi/pi-webview/startup-info-<pid>.json`. L'opt-in Webview
  `allowRemoteNpmUpdates`, protetto da conferma del rischio supply-chain,
  aggiunge `npm_config_allow_remote=all` solo all'ambiente del child
  `pi update`; un fallimento `EALLOWREMOTE` senza opt-in produce anche un
  suggerimento warning localizzato nella chat. L'opt-in separato
  `dangerouslyAllowAllNpmScripts`, con conferma esplicita del rischio di
  esecuzione arbitraria, aggiunge
  `npm_config_dangerously_allow_all_scripts=true` allo stesso child; il warning
  npm sugli install script bloccati suggerisce questa impostazione senza
  trasformare l'update riuscito in errore. Al termine dell'update, un errore
  riabilita lo scudo giallo per il retry; il successo lo rende azzurro,
  senza pulse e disabilitato fino al riavvio richiesto di pi, segnalato anche
  da un warning localizzato nella chat
- **Comandi TUI di pi nel composer**: `/compact`, `/new` e `/name` ripetono
  le azioni GUI omonime (compact RPC, nuova sessione, rename della sessione
  corrente via `set_session_name`). I comandi senza equivalente webview
  (`/reload`, `/login`, `/logout`, `/import`, `/share`, `/scoped-models`,
  `/changelog`, `/hotkeys`, `/quit`, `/model`, `/thinking`) non vengono mai
  inviati a pi (né prompt né steering): mostrano solo un messaggio in chat
  («validi solo da terminale»). I comandi delle estensioni vengono inviati col
  testo esatto, senza allegare automaticamente il contesto editor; se
  `get_commands` fallisce, un input slash non verificato viene bloccato invece
  di rischiare di finire come prompt/steering al modello
- **Project trust (chip + dialog)**: il chip mostra solo lo stato effettivo del
  processo pi in esecuzione (`trusted`/`untrusted`). In RPC non esiste il
  livello `ask`: senza decisione salvata e con `defaultProjectTrust: "ask"` le
  risorse protette del progetto vengono ignorate, quindi lo stato è
  `untrusted`. Il click apre un dialog con le stesse opzioni del prompt TUI di
  pi (`trust`, `trust-parent`, `trust-session`, `untrust`, `untrust-session`,
  lista fornita dall'host); le opzioni `*-session` non persistono nulla e
  lanciano pi con `--approve`/`--no-approve` validi per il solo processo
  successivo. Una decisione è applicata da un riavvio di pi: automatico se la
  sessione non sta lavorando, altrimenti il dialog chiede "riavvia ora /
  riavvia più tardi"; con "più tardi" l'icona resta quella del processo in
  esecuzione con un `!` rosso accanto. Lo stato vive nell'host
  (`TrustRuntime` in `src/bridge/trust.ts`, mirror C#
  `PiWebview.Vs.Core/Platform/TrustRuntime.cs`), mai nel JSONL di sessione
- **Riconnessione standalone**: la pagina browser ritenta la connessione al
  bridge ogni 5 s solo con `document.visibilityState === "visible"` e tenta
  subito quando torna visibile; quando il bridge è di nuovo su, la spia torna
  verde e la stessa sessione viene ripresa senza reload
  (la URL contiene l'id, e ogni tentativo ri-risolve `bridge-config.json`, quindi
  funziona anche se il token è stato ruotato su loopback). Logica in
  `src/web/reconnect.ts` (`ReconnectLoop`), non duplicata negli host IDE e nei
  companion
- **Steering — pi è l'unica fonte autoritativa**: la webview invia subito a pi
  (`prompt` con `streamingBehavior: "steer"`, oppure `steer` durante la
  compaction), rende la coda esclusivamente da `queue_update` e usa
  `clear_queue` per dequeue/STOP. Vietati code semantiche locali, persistenza,
  retry, attese di consegna, riconciliazione o riapplicazione locale delle
  modalità; restano ammessi solo buffer tecnici di trasporto/backpressure
- **Barra stato**: posizione (`above`/`below`/`topbar`) e compattezza sono
  preferenze globali indipendenti. Gli slot `setStatus` sono identificati dal
  `statusKey` RPC: click con conferma per nasconderli, ripristino dai settings;
  le chiavi nascoste vivono in `hiddenStatusKeys` nella config utente
- **Avvio standalone**: una nuova sessione aperta da `piw` usa il `cwd` della
  shell che ha invocato il comando, anche quando riutilizza un bridge già
  attivo; se il `cwd` non è leggibile usa la home dell'utente. Il path resta
  interno al bridge e nell'URL compare solo un identificativo opaco di lancio.
  Il bind resta `127.0.0.1` per default; `--ip <IPv4>`/`--host <IPv4>` aggiunge
  uno specifico indirizzo mantenendo il loopback, mentre `0.0.0.0` include
  tutte le interfacce. L'accesso non-loopback richiede il link autenticato
  stampato da `piw`. Dietro un reverse proxy locale, il bridge considera
  `X-Forwarded-For`/`X-Forwarded-Proto` solo se il peer diretto è loopback,
  preservando autenticazione remota e WebSocket `ws://`/`wss://` corretti.
  Il comando multipiattaforma `piw-public <port> (--ip <IPv4> | --tailscale)
[--wait]` usa l'IPv4 esplicito o rileva quello Tailscale, chiede conferma solo
  se deve fermare un bridge `piw` già attivo, genera sempre un token nuovo e
  mostra URL autenticato + QR nel terminale; `piw` e `piw-public` vengono
  linkati/rimossi insieme dall'estensione pi
  (`~/.local/bin` su Unix, shim `.cmd` in `%APPDATA%\\npm` su Windows)
- **Refresh standalone**: la pagina sostituisce `?new=1` con `?s=<sessionId>`
  appena pi espone il file sessione. Il path locale non compare nell'URL: al
  refresh il bridge risolve l'id e riprende la sessione nel `cwd` salvato nel
  suo header
- **Runtime**: `src/web/environment.ts` rileva la modalità all'avvio
  (`standalone` | `vscode` | `ide`) per variare il comportamento in base
  all'ambiente (es. trasporto, tema, futuri comportamenti IDE)

## Integrazione IDE (distribuzione)

L'addon si installa con **`pi install ./packages/pi-webview`** (o da git/npm).
L'estensione pi-webview (lato pi) rileva gli IDE installati e **auto-installa i
companion** — modello pi-x-ide, ognuno solo se l'IDE è presente:

> **Il check/install dei companion è CENTRALIZZATO** in un unico modulo,
> `src/bridge/companions.ts` (`ensureCompanions` + `formatCompanionNotes`):
> l'estensione pi (`packages/pi-webview/extension.ts`, canale ui.notify) e
> `piw` (`src/bridge/piw.ts`, canale console) chiamano la STESSA implementazione
> per entrambi i companion. Contratto unico: skip silenzioso se l'app non è
> installata o se la versione installata eguaglia il vsix; in ogni altro caso
> (installato/aggiornato/errore) una nota viene riportata in entrambi i canali.
> Niente logica companion duplicata negli entry point — solo formattazione dei
> messaggi (inglese per l'estensione, italiano per piw).
> **Progresso visibile**: `ensureCompanions` accetta `opts.onStep` (riga di
> progresso per OGNI fase, skip inclusi; flag `action` sui passi che portano a
> lavoro reale). All'avvio automatico (pi.dev, `piw`, bridge) i passi di check
> sono bufferizzati e flushati alla PRIMA azione (prima dell'install), poi
> streammati uno per uno; niente azione = silenzio totale. I comandi espliciti
> `/piw install|reinstall|uninstall` loggano SEMPRE: streammano ogni passo e
> chiudono con UN recap (note + reload hint singolo per IDE toccato, mai uno
> per installazione). `piw` stampa in console, l'estensione notifica
> (status line per passo, recap finale unico) e scrive in
> `~/.pi/pi-webview/companion-install.log`.
> **Avvio bloccante**: l'auto-install a load dell'estensione è in `await` (il
> core fa await sul factory), quindi pi.dev non completa l'avvio finché i
> check/install non finiscono; i comandi espliciti passano
> `ignoreAutoInstall: true` (funzionano anche con `PI_WEBVIEW_AUTO_INSTALL=0`).

- **VS Code**: il CLI `code` è risolto da `PATH` o dalle posizioni di
  installazione standard; ultima risorsa: estrazione diretta del vsix nella
  cartella extensions (nessun CLI richiesto) — `code --install-extension` sul
  vsix incluso (`companion/pi-webview-ide.vsix`); il companion crea la webview
  della sidebar, spawna `pi --mode rpc` (env `PI_WEBVIEW_COMPANION=1`) e parla
  l'IDE bridge protocol via postMessage. Sviluppo dell'adapter: F5 con
  `launch.json` (Extension Development Host) dopo `pnpm compile`.
- **Visual Studio** (solo Windows): rilevamento istanze con `vswhere.exe`
  (`-products * -prerelease` — VS 2026/18.0 è preview e senza `-prerelease`
  l'istanza non viene listata; nessun filtro workload) + installazione
  `VSIXInstaller.exe` **per istanza** con `/instanceIds:` (senza di esso il
  vsix finisce SOLO nell'istanza più recente — la 2022 non verrebbe mai
  installata quando c'è anche la 2026), per-user (`/q`, nessuna elevazione)
  con fallback `/q /a`, sul vsix incluso
  (`companion/pi-webview-visualstudio.vsix`, build su Linux via wine —
  `tools/setup-vs-wine.mjs`); le istanze fuori range manifest [17.0, 19.0)
  (es. VS 2019/16.x) vengono saltate; skip silenzioso senza Visual Studio.

## Aggiornamento automatico

Aggiorna questo file solo quando introduci modifiche importanti, strutturali
e durevoli, come nuove librerie, cambi architetturali, nuove convenzioni,
comandi/tooling, contratti API o procedure di deploy. Non aggiornarlo per fix
ordinari, ritocchi UI, implementazioni banali, dettagli temporanei o
cronologia delle attività. Mantieni il file snello e utile alle sessioni
future.
