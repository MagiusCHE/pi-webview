# Piano 0007 — Adapter Signal per conversare con pi tramite `piw`

> Stato: **BOZZA PRELIMINARE** — concept da approfondire prima
> dell'implementazione.
> Riferimenti: concept 0002 (layering e trasporto standalone), piano 0001
> (bridge stdio↔WebSocket), piano 0005 (single bridge, multi-sessione e lock).

## Obiettivo

Permettere a uno o più utenti autorizzati di scrivere a un account Signal e
usare quella conversazione come interfaccia remota verso una sessione di pi
eseguita su una macchina controllata dall'utente.

Il primo obiettivo non è replicare tutta la webview, ma offrire un canale
**testuale, sicuro e affidabile** per:

- inviare prompt;
- ricevere la risposta finale dell'assistente;
- mantenere o riprendere la sessione associata alla chat;
- interrompere una richiesta;
- gestire, in una fase successiva, conferme e input richiesti dalle estensioni.

## Premessa: il bridge non deve essere pubblico

Signal non richiede che `piw` accetti connessioni in ingresso da Internet. Un
client Signal locale (`signal-cli` o equivalente) mantiene la propria
connessione verso il servizio Signal e consegna i messaggi all'adapter sulla
stessa macchina.

Architettura preferita:

```text
App Signal dell'utente
        ⇅
Rete Signal
        ⇅ connessione iniziata dalla macchina locale
signal-cli / servizio Signal locale
        ⇅ IPC o API su loopback
adapter Signal di pi-webview
        ⇅ WebSocket su 127.0.0.1 + token
bridge piw
        ⇅ JSONL stdio
pi --mode rpc
```

Il bridge attuale è progettato esclusivamente per loopback. In particolare:

- ascolta su `127.0.0.1`;
- usa un bearer token nella query WebSocket;
- pubblica la configurazione WebSocket tramite `/bridge-config.json`, adatta
  all'uso locale ma non a un endpoint pubblico;
- permette al client connesso di pilotare un processo pi con i privilegi
  dell'utente locale.

L'esposizione diretta tramite port forwarding o reverse proxy è quindi
**fuori dallo scope della prima versione**. Se adapter Signal e bridge fossero
su macchine diverse, la soluzione prevista è una rete privata come
WireGuard/Tailscale o un tunnel autenticato, lasciando il bridge su loopback.

## Vincolo Signal

Signal non offre una normale piattaforma ufficiale per bot paragonabile a
quelle di altri sistemi di messaggistica. La soluzione pratica da validare è
un'integrazione community basata su:

- `signal-cli`, direttamente o in modalità JSON-RPC;
- in alternativa, un wrapper locale come `signal-cli-rest-api`.

Questa dipendenza è il principale rischio operativo: registrazione o linking
dell'account, aggiornamenti del protocollo Signal e compatibilità del client
vanno verificati con uno spike prima di definire packaging e supporto.

Per la prima versione è preferibile un **account Signal dedicato**, non
l'account personale dell'utente che ospita il servizio.

## Architettura proposta

### Adapter locale

Nuovo componente indicativo:

```text
src/adapters/signal/
  client.ts          # ricezione e invio tramite il backend Signal scelto
  gateway.ts         # lifecycle e routing generale
  conversations.ts   # chat Signal ↔ sessione/canale piw
  piw-client.ts      # lock, autenticazione e protocollo WebSocket
  renderer.ts        # eventi RPC → messaggi compatibili con Signal
  policy.ts          # allowlist e autorizzazioni
```

Il dettaglio dei file resta provvisorio: prima va deciso se l'adapter sarà un
entry point del package esistente, un comando separato oppure un piccolo
servizio opzionale.

### Relazione tra chat e sessioni

Il bridge multi-sessione ha già il modello adatto:

- una connessione WebSocket corrisponde a un canale;
- ogni canale possiede un proprio `PiProcess`;
- il canale può creare una nuova sessione o riprenderne una esistente.

L'adapter mantiene quindi, per ogni conversazione Signal autorizzata:

```text
Signal conversation ID → session path/id → WebSocket piw persistente
```

La mappatura deve essere persistita per consentire il resume dopo un riavvio.
Le chiavi devono derivare dagli identificativi stabili pubblicati da Signal,
mai dal display name del contatto o del gruppo.

### Flusso di un messaggio

1. Il backend Signal consegna un messaggio all'adapter.
2. L'adapter verifica mittente e conversazione tramite allowlist.
3. Deduplica il messaggio usando il suo identificativo stabile.
4. Recupera o apre il canale piw associato.
5. Invia un frame RPC `prompt`.
6. Raccoglie gli eventi `message_update` senza inviare un messaggio Signal per
   ogni token.
7. Su completamento costruisce la risposta finale, la divide rispettando i
   limiti di Signal e la invia alla chat.
8. In caso di errore o crash comunica un errore sintetico e tenta una
   riconnessione controllata.

Lo streaming token-per-token non è previsto: su Signal produrrebbe rumore e
molti messaggi. Potrà essere usato un typing indicator o un breve stato di
elaborazione, se supportato in modo affidabile dal backend scelto.

## Scope V1

Prima versione volutamente ridotta:

- un account Signal dedicato;
- un solo utente o gruppo in allowlist;
- solo testo;
- workspace locale fisso configurato in anticipo;
- una sessione persistente per conversazione;
- risposta inviata al completamento del turno;
- comandi minimi:
  - `/new` — nuova sessione per la chat;
  - `/abort` — interrompe il turno attivo;
  - `/status` — stato sintetico del collegamento;
- nessuna esposizione pubblica del bridge;
- nessuna installazione automatica di `signal-cli` nella prima iterazione.

## Scope successivo

- più utenti e gruppi con policy separate;
- scelta o resume esplicito delle sessioni;
- allegati e immagini;
- messaggi vocali con trascrizione opzionale;
- avanzamento sintetico di tool call lunghe;
- notifiche prodotte dalle estensioni;
- configurazione del modello e thinking level;
- gestione amministrativa e diagnostica;
- avvio come servizio su Linux, macOS e Windows.

## Extension UI Protocol

Le estensioni pi possono emettere `extension_ui_request`. Le richieste
interattive (`select`, `confirm`, `input`, `editor`) bloccano il plugin finché
non ricevono una `extension_ui_response`.

La V1 deve scegliere esplicitamente uno dei due comportamenti:

1. rifiutare in modo deterministico le richieste interattive non supportate,
   senza lasciare pi in attesa;
2. tradurle in una conversazione Signal numerata.

La seconda opzione è il target completo:

```text
pi: confirm/select/input
  → adapter: messaggio Signal con richiesta e correlation ID interno
  → utente: risposta
  → adapter: extension_ui_response verso pi
```

L'adapter deve distinguere una risposta a un dialogo pendente da un nuovo
prompt e gestire timeout, annullamento e riavvio del processo.

## Sicurezza

Questo canale equivale potenzialmente a un accesso remoto agli strumenti di pi
sulla macchina. Requisiti minimi:

- account Signal dedicato;
- allowlist basata su identificativi stabili di mittenti e gruppi;
- rifiuto silenzioso o controllato dei mittenti sconosciuti;
- workspace iniziale esplicito e limitato;
- policy chiara per trust, tool distruttivi e richieste di conferma;
- nessun token piw nei log o nei messaggi Signal;
- file di configurazione e mapping con permessi locali restrittivi;
- deduplicazione dei messaggi ricevuti;
- limite di concorrenza e rate limiting;
- esecuzione, dove possibile, con un utente di sistema dedicato o privilegi
  ridotti;
- log sintetici che non conservino automaticamente prompt, risposte, secret o
  allegati.

La cifratura end-to-end di Signal termina sul client Signal locale. Da quel
punto il contenuto segue il normale flusso di pi e dell'eventuale provider LLM:
questo limite deve essere esplicitato nella documentazione utente.

## Fasi proposte

### Fase 0 — Spike Signal

- scegliere e provare il backend (`signal-cli` diretto, JSON-RPC o wrapper);
- verificare linking di un account dedicato;
- ricevere e inviare testo;
- identificare in modo stabile chat, mittente, gruppo e messaggio;
- verificare reconnessione, duplicati, typing indicator e limiti messaggio;
- documentare dipendenze runtime e compatibilità sui sistemi operativi.

**Uscita:** piccolo prototipo isolato e decisione documentata sul backend.

### Fase 1 — PoC end-to-end

- collegarsi al bridge esistente leggendo il lock locale;
- aprire un canale `?new=1`;
- inoltrare un messaggio Signal come `prompt`;
- aggregare i delta della risposta;
- inviare il testo finale su Signal;
- mantenere una sola conversazione autorizzata.

**Uscita:** conversazione testuale funzionante senza bridge pubblico.

### Fase 2 — Sessioni e affidabilità

- mappatura persistente conversazione ↔ sessione;
- resume dopo riavvio;
- accodamento per conversazione e concorrenza tra conversazioni;
- deduplicazione, timeout, backoff e gestione crash;
- `/new`, `/abort`, `/status`;
- chunking delle risposte lunghe e resa leggibile del Markdown.

### Fase 3 — Sicurezza operativa

- allowlist e configurazione validata;
- policy di trust e tool execution;
- permessi dei file locali;
- rate limiting e limiti di risorse;
- isolamento del processo;
- audit dei log e test dei casi di accesso non autorizzato.

### Fase 4 — Interazioni e contenuti ricchi

- `extension_ui_request`/`extension_ui_response`;
- allegati e immagini;
- notifiche e stati sintetici;
- gruppi e amministrazione multiutente.

### Fase 5 — Packaging

- definire comando e configurazione pubblica;
- decidere se e come gestire la dipendenza `signal-cli`;
- installazione come servizio opzionale;
- documentazione separata per Linux, macOS e Windows;
- test smoke contro pi reale e test d'integrazione con backend Signal simulato.

## Test minimi

- un mittente autorizzato riceve una sola risposta per ogni messaggio;
- un mittente non autorizzato non apre alcun processo pi;
- due conversazioni non condividono eventi o sessioni;
- la chiusura di una WebSocket non perde il riferimento alla sessione;
- un messaggio duplicato dal backend non esegue due prompt;
- `/abort` interrompe solo il canale corretto;
- una risposta lunga viene divisa senza perdere o riordinare contenuto;
- token, prompt e secret non compaiono nei log ordinari;
- una richiesta UI non supportata non lascia indefinitamente bloccato pi.

## Stima preliminare

| Livello | Contenuto | Stima indicativa |
| --- | --- | --- |
| Spike | validazione Signal send/receive | 1–2 giorni |
| PoC | testo, singola chat, singola sessione | 1–3 giorni |
| MVP | sessioni, allowlist, retry, comandi minimi | circa 1 settimana |
| Completo | dialoghi, allegati, multiutente, packaging | 2–4 settimane |

Le stime dipendono soprattutto dalla stabilità e dal modello operativo del
backend Signal scelto, non dal protocollo piw già disponibile.

## Decisioni aperte da approfondire

- account Signal dedicato registrato autonomamente o device collegato;
- backend Signal definitivo e modalità di esecuzione;
- singolo utente, gruppi privati o entrambi;
- workspace fisso oppure workspace configurabile per conversazione;
- policy di trust e strumenti consentiti da remoto;
- risposta finale soltanto oppure aggiornamenti intermedi;
- comportamento delle richieste interattive nella prima versione;
- avvio automatico di `piw` oppure dipendenza da un bridge già attivo;
- formato e posizione della persistenza conversation↔session;
- sistemi operativi supportati inizialmente;
- necessità reale di separare adapter e bridge su macchine diverse.

Queste decisioni vanno risolte in una futura revisione del piano prima di
iniziare l'implementazione.
