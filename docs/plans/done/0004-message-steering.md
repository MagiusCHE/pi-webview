# Piano 0004 — Message steering (invio durante l'elaborazione)

> Stato: **IMPLEMENTATO e verificato** (2026-08-24) — vedi i mark ✅ nei passi e nel commit `0499e94`.
> Riferimenti: concept 0001/0002 (UI transport-agnostica, IDE bridge protocol),
> piano 0002 (adapter VS Code), piano 0003 (rimandato).

## Obiettivo

Oggi, se pi sta elaborando, il pulsante di invio diventa **STOP**: l'unico modo
per mandare un altro messaggio è interrompere il lavoro. Obiettivo: **stearing
a piena parità con pi.dev** — accodare messaggi durante l'elaborazione con la
STESSA semantica di consegna in tutti i rami previsti da pi.dev, più:

- pulsante di invio **sempre presente** (evidenza diversa durante
  l'elaborazione), stearing via **Invio nella textarea**;
- pulsante **STOP separato** (blocco pensiero), cliccabile indipendentemente;
- **nessuna modifica/elimina per singolo messaggio accodato** (scelta
  voluta): i messaggi in stearing NON si modificano singolarmente — il modo
  per riprenderli è il **dequeue**, come fa pi.dev (tornano nell'editor,
  si sistemano lì e si rinvia);
- toolbar invariata (resta un solo pulsante).

## Come funziona lo stearing in pi.dev (verificato in pi-agent-core)

### Invii e code

| Invio | Effetto |
|---|---|
| **Enter** durante elaborazione | accoda uno **stearing** |
| **Alt+Enter** durante elaborazione | accoda un **follow-up** |
| **Escape** | **dequeue** (tutto in coda → editor) + abort |
| **Alt+↑** (`app.message.dequeue`) | dequeue senza abort |

Due code separate: `steeringQueue` e `followUpQueue`
(`PendingMessageQueue` in `pi-agent-core/dist/agent.js`).

### Punti di consegna (agent-loop.js `runLoop`)

L'agente **sonda** la coda stearing in punti precisi:

1. **all'inizio del run** ("l'utente potrebbe aver digitato mentre aspettava");
2. **a ogni fine turno** — *dopo che il turno corrente ha eseguito i suoi
   tool call, prima della prossima chiamata LLM*: i messaggi accodati vengono
   emessi come messaggi utente (`message_start`/`message_end`) e iniettati nel
   contesto prima della risposta successiva — è il vero "stearing".

Il **follow-up** viene sondato solo quando l'agente **avrebbe finito** (nessun
tool call e nessuno stearing): in quel caso il loop ricomincia e lo processa.

### Modalità

- `steeringMode` / `followUpMode` (config pi, default `"one-at-a-time"`):
  - `"one-at-a-time"`: al punto di consegna viene preso **solo il primo**
    messaggio; i successivi aspettano i punti successivi;
  - `"all"`: al prossimo punto di consegna vengono presi **tutti**.
- La coda viene "drenata" al momento della consegna; il messaggio consegnato
  viene rimosso dalla coda di pi (il `message_start` lo toglie anche dalla
  lista `_steeringMessages` della sessione, con `queue_update`).

### Altri rami di pi.dev

- **Abort (STOP)**: `agent.abort()` ferma il run ma **NON svuota le code**
  (solo `reset()` le svuota, e lancia errore se attivo). Il dequeue esplicito
  (Escape/Alt+↑) è l'unico a svuotare.
- **Durante la compattazione**: il TUI accoda i messaggi in una coda separata
  (`compactionQueuedMessages`) e li ripropone a compattazione finita.
- **Evento `queue_update`**: `{ steering: string[], followUp: string[] }` a
  ogni cambiamento di coda (doc rpc.md `queue_update`).

## Vincolo (verificato) e scelta architetturale

**Nessuna RPC permette di mutare la coda di pi** (niente rimozione/modifica di
un singolo elemento; `clearQueue()` esiste solo nel TUI e non è esposta né in
RPC né nell'API estensioni). Con la scelta "niente edit per singolo
messaggio" il vincolo si allenta: **la consegna usa la coda nativa di pi**
(piena fedeltà pi.dev), mentre serve solo una **coda "ombra"** per sapere cosa
è ancora da consegnare, per il **dequeue** e per la persistenza al reload.

### Coda ombra + consegna nativa

- **Stato locale** (webview): `steerShadow` (testo + immagini in memoria),
  persistito (testo) in workspaceState → alimenta il dequeue e il drain dopo
  reload. Nessuna operazione per singolo item.
- **Consegna stearing**:
  - pi **idle** → `prompt` normale (parte subito);
  - pi **in streaming** → `prompt(message, { streamingBehavior: "steer" })`:
    pi accoda nativamente e inietta al prossimo punto di consegna (fine turno
    con tool call → prima della prossima LLM call; oppure a inizio run
    successivo) — **stessa semantica del TUI di pi.dev**.
- **Consegna follow-up**: ad `agent_settled` (pi ha finito) → `prompt` normale.
- **Modalità**: `steeringMode`/`followUpMode` lette da `get_state`:
  `"one-at-a-time"` → 1 messaggio per punto di consegna; `"all"` → tutti.
- **Pannello a due gruppi**: *"da inviare"* (coda ombra, righe read-only) e
  *"inviato a pi"* (coda nativa, read-only, sparisce all'iniezione — via
  `queue_update`/`message_start`). Trasparenza su cosa è ancora recuperabile
  col dequeue.
- **Race nota**: tra il nostro `turn_end` (evento) e il poll della coda da
  parte del loop può mancare il giro → il messaggio viene iniettato al punto
  di consegna successivo (fine turno dopo, o inizio del prossimo run). Stesso
  comportamento del TUI con un utente che digita piano; semantica invariata.

## UI (placement confermato)

### 1. Pulsante di invio (toolbar invariata: UN pulsante)

- `#btn-send` resta sempre **Invia** (mai più STOP).
- Durante `working`: classe `.working` (accento + bordo/pulse), tooltip
  "Elaborazione in corso: Invio accoda (stearing)".
- Lo stearing avviene solo con **Invio** nella textarea (o click su Invia).

### 2. Placeholder della textarea

- Idle: testo attuale.
- `working`: "Elaborazione in corso: Invio accoda il messaggio (stearing)…"
  (i18n `steerPlaceholder`).

### 3. STOP separato

- **Nel blocco pensiero del messaggio in elaborazione** (`.thinking-head`,
  accanto a label/timer): icona stop, hover `--err`, tooltip "Interrompi".
- Semantica: `rpc.abort()` — il run si ferma, **la coda resta** (parità pi.dev:
  STOP non svuota la coda); il drain riparte all'`agent_settled` successivo.

### 4. Pannello coda (`#steer-panel`) tra thread e composer

- Visibile solo quando la coda (ombra + nativa) non è vuota.
- Perché qui e non in cronologia (come pi.dev): i messaggi accodati non sono
  ancora parte della conversazione (non scritti nel file finché non partono);
  sidebar stretta → niente ambiguità col rendering ottimistico.

```
┌───────────────────────────────────────────┐
│ ⏳ 2 in coda (stearing)         [riporta nell'editor] │
│ ┌───────────────────────────────────────┐ │
│ │ • "Riepiloga i risultati"              │ │  ← da inviare (read-only)
│ │ • "Prova anche l'altro caso"           │ │
│ │ ─ inviato a pi:                        │ │
│ │ • "Aggiorna i test"           [⏳]     │ │  ← in coda nativa (read-only)
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

- Righe **read-only** (niente ✎/🗑 per singolo messaggio): testo ellipsis.
- Unica azione: **dequeue** ("riporta nell'editor", parità Alt+↑ di pi.dev) —
  sposta tutti gli item "da inviare" nella textarea (uniti con `\n\n`, come il
  TUI) e svuota la coda ombra. Lì l'utente può sistemare i testi liberamente e
  rinviiare. (Gli item già "inviato a pi" non sono recuperabili: limite noto,
  vedi Futuro.)

## Flusso implementativo

### Stato (main.ts)

```ts
interface QueuedMessage { id: string; text: string; images?: ImageContent[] }
let steerShadow: QueuedMessage[] = [];   // da consegnare (dequeue/persistenza)
let steerPending: QueuedMessage[] = [];  // consegnato a pi, in attesa di iniezione
```

Persistenza: testo di `steerShadow` in workspaceState
(`pi-webview.steerQueue`, via `ideRequest store/get`); immagini solo in
memoria.

### 1. Enqueue (Invio mentre `working`)

- `sendOrStop()`: se `working` e non `compacting` → push in `steerShadow`,
  `renderSteerPanel()`, `setSteerPlaceholder()`, niente invio a pi.
- Guardia Invio attuale (`!working && !compacting`) → diventa
  `!compacting` (stearing ammesso durante working).
- Se `!working` → invio normale (flusso attuale).

### 2. Consegna (punti di pi.dev)

- **`turn_end`** (evento, nuovo handler): se `steerShadow` non vuota e pi
  ancora in streaming → consegna secondo `steeringMode`:
  - `"one-at-a-time"` (default): il primo item → `prompt(streamingBehavior:
    "steer")`, spostalo in `steerPending`;
  - `"all"`: tutti gli item → un `prompt` ciascuno, tutti in `steerPending`.
- **`agent_settled`**: se `steerShadow`/`steerPending` non vuote → consegna i
  follow-up (o i residui) con `prompt` normale; poi la coda si svuota e il
  pannello sparisce.
- **`message_start`** (ruolo user, testo = item in `steerPending`): rimosso
  da `steerPending` → ora è in chat come messaggio utente reale.
- **`queue_update`**: mostra la coda nativa di pi (read-only) in
  `steerPending` per riconciliazione (es. stearing arrivato da estensioni).

### 3. Dequeue (parità Alt+↑ / Escape)

- Pulsante "riporta nell'editor": `steerShadow` → textarea (uniti con
  `\n\n`) + svuota `steerShadow` + persist + re-render pannello.
- (Escape con abort resta fuori: lo STOP è già separato; il dequeue non
  aborta, come Alt+↑ di pi.dev.)

### 4. STOP

- `els.stopBtn` nel `.thinking-head` → `rpc.abort()`. La coda resta.
- `working` si resetta all'`agent_settled` → drain riparte.

### 5. Compaction

- Durante `compacting`: l'Invio **accoda comunque** in `steerShadow` (parità
  TUI con `compactionQueuedMessages`); a `compaction_end` riparte la consegna.

### 6. Reload

- Al boot: `steerShadow` riletta dallo state; se non vuota e pi idle → si
  consegna subito (drain). `steerPending` si perde (la coda nativa è in
  memoria): parità pi.dev (la coda di pi non sopravvive al reload).

### 7. Allineamento impostazioni

- `steeringMode`/`followUpMode` da `get_state` (già nel payload) a ogni boot
  e dopo eventuali cambi (RPC `set_steering_mode` se in futuro esponiamo le
  impostazioni).

## File toccati

- `src/web/main.ts` — stato coda, enqueue, consegna su `turn_end`/
  `agent_settled`, pannello read-only, dequeue, STOP nel pensiero,
  placeholder, guardia Invio, handler `queue_update`.
- `src/web/index.html` — `#steer-panel` sopra `.input-box`.
- `src/web/style.css` — `.steer-panel`, righe, dequeue, `.working` del
  pulsante invio, `#stop-btn`.
- `src/web/locale/{it,en}.json` — `steerPlaceholder`, `steerPanelTitle`,
  `steerSent`, `steerDequeue`, `stopWorking`, ecc. (tutte via `t()`).
- `src/ide/protocol.ts` — `storeSteerQueue`/`getSteerQueue` (persistenza);
  nessuna nuova RPC verso pi.
- `src/adapters/vscode/host.ts` + `src/bridge/index.ts` — store/get coda
  (workspaceState VS Code, file standalone).

## Passi (ordine suggerito)

1. ✅ **Stato coda + enqueue**: `steerShadow`, guardia Invio, placeholder, invio
   locale quando `working`.
2. ✅ **Pannello coda**: markup, render read-only, dequeue.
3. ✅ **Consegna pi.dev**: handler `turn_end` + `agent_settled`,
   modalità one-at-a-time/all, `steerPending`.
4. ✅ **STOP separato** a fianco del pulsante di invio + Esc (dequeue + abort).
5. ✅ **Compaction queue** (dequeue prima della compact, consegna dopo
   `compaction_end`) + persistenza reload + i18n + test manuali.

## Test manuali

- Invio durante elaborazione → item in coda (read-only), placeholder
  aggiornato, pulsante con evidenza stearing, NIENTE invio immediato.
- A fine turno (dopo i tool call) → il primo item viene iniettato PRIMA della
  risposta successiva (verificare nel file di sessione che il messaggio user
  compare prima dell'assistant successivo).
- `steeringMode: "all"` → più item iniettati allo stesso punto.
- STOP dal blocco pensiero → turno fermato, coda intatta, drain riparte.
- **Dequeue** → tutti gli item "da inviare" tornano nella textarea (uniti),
  la coda si svuota, niente invio automatico; si possono sistemare e rinviiare.
- NESSUN controllo di modifica/elimina per singolo item (non presenti).
- Invio durante compattazione → accodato e consegnato dopo `compaction_end`.
- Reload con coda → coda ripristinata, drain al boot.
- Follow-up (Alt+Enter) consegnato solo a lavoro finito.

## Futuro (opzionale, NON in questo piano)

- Enhancement del core di pi: RPC `remove_queue_item`/`clear_queue` →
  consentirebbe, se mai servisse, gestione per singolo item della coda nativa
  (oggi volutamente assente: dequeue-only come pi.dev).
- Parità completa di Escape (abort + dequeue) in un comando unico.
