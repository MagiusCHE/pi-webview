# Piano 0005 — Single-bridge multi-sessione + comando shell `piw`

> Stato: **IMPLEMENTATO** — spostato in done (commit b53e293).
> Riferimenti: concept 0002 (architettura standalone multi-IDE, lazy UI),
> piano 0001 (bridge standalone + web UI), piano 0002 (adapter VS Code),
> lavoro recente: package `@magiusche/pi-webview` (estensione pi ufficiale,
> keyword `pi-package`, bin npm `piw`, auto-update companion).

## Obiettivo

Nel pacchetto standalone (`piw`) far funzionare **sessioni multiple parallele**
con **un solo bridge in ascolto sul sistema**, in modo che:

1. **Single-instance**: chiamare `piw` mentre un bridge è già attivo NON crea
   un secondo bridge: apre una nuova scheda del browser con una **nuova
   sessione pronta**.
2. **"Nuova chat" dal browser**: il pulsante "nuova chat in un altro pannello"
   in standalone apre una **nuova tab del browser con una nuova sessione**
   (in IDE resta invariato: nuova webview).
3. **Sessioni multiple**: il bridge accetta sempre più sessioni in parallelo e
   le smista correttamente (niente broadcast tra client).
4. **Resume**: `piw --session <id>` apre il browser su quella sessione
   (in futuro; il meccanismo viene progettato da subito).

## Come funziona pi.dev oggi (verificato in pi-agent-core)

- `pi --session <path|id>` avvia pi riprendendo una sessione.
- Le sessioni vivono in `~/.pi/agent/sessions/--<workspace>--/*.jsonl` con
  `header.cwd` (workspace della sessione).
- **switch_session / resume cambia la cwd del runtime**: in
  `agent-session-runtime.js`:
  ```js
  const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
  assertSessionCwdExists(sessionManager, this.cwd);   // check cartella esistente
  this.apply(await this.createRuntime({ cwd: sessionManager.getCwd(), ... }));
  ```
  → il bridge/`piw` NON deve spostare la cwd: pi la imposta da solo dalla
  sessione (con check di esistenza).
- In VS Code il modello è già "**un processo `pi --mode rpc` per webview**"
  (adapter: `PiWebviewHost` + `PiProcess`, `src/adapters/vscode/host.ts`) —
  il bridge standalone adotta lo stesso modello per tab.

## Stato attuale del bridge standalone (src/bridge/index.ts)

- 1 server HTTP + 1 WebSocketServer su una porta; **1 solo processo pi**;
  **broadcast** di tutti gli eventi a tutti i client.
- Funziona con una sessione sola (switch via RPC `switch_session` globale).
- `PiProcess` (`src/bridge/pi-process.ts`, condiviso con l'adapter IDE) ha già:
  spawn, parsing JSONL, backpressure stdin, restart con backoff — ma il bridge
  oggi NON lo usa (ha un `startPi` duplicato).

## Fasi

### Fase 1 — Lock file e single-instance

- Lock condiviso: `~/.pi/pi-webview/bridge.json` → `{ pid, port, token, startedAt }`.
- Boot di `piw`:
  1. lock presente e valido (pid vivo **e** `GET /health?token=<token>` risponde
     OK con timeout breve) → **riusa**: apri browser, esci;
  2. altrimenti (nessun lock / pid morto / health KO) → spawna il bridge,
     registra il lock, apri browser.
- Bridge: endpoint `GET /health?token=<token>` (200 solo con token corretto);
  pulizia del lock in uscita pulita (SIGINT/SIGTERM/exit).

### Fase 2 — Bridge multi-canale

- **Ogni connessione WebSocket = un canale = un `PiProcess` dedicato**
  (refactor del `startPi` custom verso `PiProcess`, riuso totale).
- Intento dichiarato dal client all'atto della connessione (query param del WS):
  - `?new=1` → nuovo pi (sessione nuova);
  - `?session=<path>` → pi con `--session <path>` (resume; cwd gestita da pi);
  - niente → canale 0 (default).
- Routing per canale: i frame vanno SOLO al pi del proprio canale e gli eventi
  del pi SOLO al proprio client (niente broadcast globale).
- `ConfigStore` resta condiviso (config utente).
- Ciclo di vita: canale chiuso (tab chiusa) → kill del pi; ultimo canale chiuso
  → il bridge resta in ascolto (lock attivo) finché Ctrl+C non lo ferma.

### Fase 3 — UI: "nuova chat" in standalone

- In `main.ts`, handler del pulsante "nuova chat": se `runtime === standalone`
  → `window.open(location.origin + "/?new=1")` (nuova tab → nuovo canale →
  nuova sessione); in IDE resta `ideRequest({ type: "openNewChat" })`.

### Fase 4 — `piw --session <id>`

- `piw --session <id>`: risolve l'id (parziale o path, come pi) → apre il
  browser su `/?session=<path>`.
- Senza `--session` (default): apre su `/?new=1` (nuova sessione pronta).
- Il bridge spawna pi con `--session <path>`; pi imposta da solo la cwd.

## Crash e lock "appeso"

Il lock non viene mai forzato: viene **validato a ogni avvio** (il file può
restare appeso senza danno).

| Caso | Rilevamento | Azione |
|---|---|---|
| Ctrl+C / SIGTERM | pulizia pulita nel signal handler | lock rimosso |
| Bridge crashato (pid morto) | `process.kill(pid, 0)` → ESRCH | lock ignorato e sovrascritto |
| Crash + pid riusato da altro processo | pid vivo ma `/health?token=<token>` non risponde col token giusto | lock scartato |
| Porta occupata da servizio estraneo | health check fallito | lock scartato, nuovo bridge |

La coppia **pid + health check con token segreto** copre il caso del pid riusato
(niente falsi positivi).

## Impatto su VS Code

- `PiProcess` è condiviso: il bridge multi-canale lo *usa*, non lo cambia →
  zero impatto sul comportamento IDE.
- UI: un `if` su `runtime` per il pulsante "nuova chat" → l'IDE resta identico.
- `protocol.ts`: l'intento canale è solo nel connettore WS (standalone);
  l'IDE usa postMessage, nessuna rottura.
- Costo: N processi pi (uno per tab) — stesso modello già usato da VS Code;
  i processi pi locali sono leggeri (il modello gira sul provider remoto).

## Verifica

- `piw` due volte: un solo bridge, seconda chiamata apre solo una tab.
- Due tab con sessioni diverse: messaggi/eventi non si mescolano.
- "Nuova chat" in standalone: nuova tab con nuova sessione.
- Crash simulato (kill -9 del bridge): `piw` riparte pulito.
- `piw --session <id>`: apre la sessione giusta, cwd corretta.

## Aggiunte in corso d'opera (implementate dopo la stesura)

- **Idle shutdown**: il bridge si spegne da solo dopo 1 minuto senza alcuna
  connessione (la WS aperta è il segnale di attività); `--no-idle` lo
  disabilita, `--idle-timeout <s>` lo regola (pass-through da `piw`).
- **Avvio in background**: `piw -b`/`--background` rilancia il processo
  detached (cross-platform) e apre il browser; attende il lock valido prima
  di tornare (niente race con un `piw` successivo); `--no-open` stampa solo
  il link in console.
- **Stop in background**: `piw -k`/`--kill` ferma il bridge (pid dal lock).
- **Filtro del separatore `--`** negli argomenti di `piw` (es. `piw -- -b`).
- **README pacchetto**: documentati background, single-instance, idle,
  stop (`piw -k`).
