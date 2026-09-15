# Piano 0010 — Companion browser Chrome e Firefox con contesto pagina e tool

> Stato: **CHROME IMPLEMENTATO — PUBBLICAZIONE WEB STORE IN CORSO**.
> Firefox è rinviato per decisione dell’utente e non fa parte di questa
> implementazione.
> Dipendenze: bridge standalone/multi-sessione, protocollo IDE condiviso,
> package pi e installazione companion centralizzata già esistenti.

## Esito dell’implementazione Chrome

L’implementazione Chrome comprende Manifest V3, Side Panel con Web UI condivisa,
URL completo configurabile separato dall’intento di sessione, dialog esplicativo
prima delle impostazioni su errore, contesto pagina, handoff atomico, tool
DOM/screenshot con consenso per origine, build ZIP,
packaging nel package pi e flusso di installazione guidato. L’ID Web Store
assegnato è `hcdjfkcgojomhpmcfgipginghhlncamn`.

La validazione automatica copre unit test, typecheck, bridge smoke, struttura e
packaging Chrome. La validazione interattiva è stata completata caricando la
build unpacked in un profilo Chrome; la build locale di Chrome continua invece
a bloccare l’avvio di estensioni da riga di comando, quindi lo smoke automatico
si limita alla validazione del pacchetto.

## Obiettivo

Aggiungere a pi-webview un companion per browser che ospiti la stessa Web UI in
un pannello laterale persistente mentre l'utente naviga.

La prima implementazione usa Chrome Manifest V3 e `chrome.sidePanel`; la seconda
porta le funzionalità condivise su Firefox tramite la relativa API sidebar.

Il companion:

- presuppone che `piw` sia già attivo: non avvia e non arresta il bridge;
- si collega all'URL completo configurato dall'utente;
- usa per default `http://127.0.0.1:7361`;
- accetta sia HTTP/WS sia HTTPS/WSS, compresi indirizzi Tailscale senza
  certificato TLS applicativo;
- se la connessione iniziale fallisce, mostra immediatamente le impostazioni di
  connessione nel pannello;
- riceve dalla scheda attiva URL, titolo, favicon e selezione testuale;
- rende URL e titolo contesto permanente del prompt, anche senza selezione;
- mette a disposizione dell'agente tool espliciti per leggere il DOM e catturare
  la pagina;
- può ricevere una sessione già aperta nella UI standalone e trasferirla nel
  pannello senza avviare un secondo processo pi sulla stessa sessione.

## Decisioni già fissate

1. **`piw` è già attivo.** Nessun Native Messaging e nessun lifecycle del
   servizio dentro il companion.
2. **Un solo campo di connessione:** `serverUrl`, contenente l'URL completo
   fornito dall'utente, inclusi eventuali parametri di autenticazione generati
   da `piw-public`.
3. **Default:** `http://127.0.0.1:7361`.
4. **HTTP remoto consentito.** Una destinazione Tailscale come
   `http://100.x.y.z:7361/?token=…` è valida. L'interfaccia può avvertire che
   HTTP va usato su una rete fidata, ma non deve bloccarlo.
5. **UI inclusa nell'estensione, non iframe.** La Web UI compilata vive nel
   companion e apre direttamente il WebSocket del bridge.
6. **Niente duplicazione della Web UI.** Tema, chat, sessioni, renderer e
   impostazioni pi restano quelli condivisi in `src/web`.
7. **Chrome prima, Firefox dopo.** Firefox parte soltanto dopo il completamento
   dei criteri di accettazione Chrome.
8. **Il contesto pagina è visibile.** La UI non allega mai URL o testo selezionato
   in modo invisibile all'utente.
9. **DOM e screenshot sono acquisiti solo quando l'agente chiama il relativo
   tool.** Il caricamento della pagina non invia automaticamente DOM o pixel al
   modello.

## Vincoli reali dei browser

### Installazione

Il termine “installazione automatica” non può avere esattamente la stessa
semantica dei VSIX:

- Chrome non permette a un normale programma locale di installare
  silenziosamente un CRX arbitrario su Windows e macOS. Il canale di produzione
  corretto è Chrome Web Store; l'utente deve confermare l'installazione o
  l'abilitazione. Linux ammette anche meccanismi external-extension, ma non sono
  una base uniforme multipiattaforma.
- Firefox Release/Beta richiede un XPI firmato da Mozilla; anche qui
  l'installazione ordinaria richiede consenso dell'utente. Un addon caricato da
  `about:debugging` è temporaneo e scompare al riavvio.

Di conseguenza `piw` può:

- includere e versionare gli artefatti browser;
- rilevare i browser installati;
- avviare il flusso guidato di installazione e riferire lo stato;
- integrare install/update/uninstall nei comandi `/piw`;

ma non deve dichiarare un'installazione silenziosa dove Chrome o Firefox la
vietano. Prima della release Chrome va scelto il canale definitivo fra:

1. **Chrome Web Store** — raccomandato, ID stabile e aggiornamenti gestiti dal
   browser;
2. build unpacked/ZIP — solo sviluppo o installazione manuale;
3. CRX external-extension — opzionale e limitato agli ambienti che lo
   supportano.

Per Firefox servirà un XPI firmato AMO, listed oppure unlisted, e una strategia
di aggiornamento coerente.

### Accesso alle pagine

Per mostrare automaticamente contesto e selezione della scheda attiva e per
eseguire DOM/screenshot su siti arbitrari, il companion necessita di permessi
ampi e dichiarati chiaramente:

- `tabs`;
- `scripting`;
- accesso host `<all_urls>`: Chrome lo richiede per `captureVisibleTab` quando
  il tool screenshot viene eseguito asincronicamente dopo il gesto utente;
  il codice continua comunque a limitare contesto e tool a HTTP/HTTPS;
- `sidePanel` su Chrome;
- `storage` per configurazione e handoff.

`chrome://`, Chrome Web Store e altre pagine protette non consentono la normale
iniezione. In tali casi il pannello deve mostrare URL/titolo quando disponibili,
nessuna selezione e un errore esplicito se un tool pagina viene chiamato.

L'accesso a tutte le pagine è il principale costo privacy e di review del Web
Store. Deve essere motivato nella documentazione e non usato per telemetria,
profilazione o acquisizione preventiva del contenuto.

## Architettura target

```text
Scheda attiva
  └─ content script: titolo/selezione + operazioni DOM
             ⇅ runtime messaging
Service worker browser
  ├─ lifecycle side panel
  ├─ tab/window tracking
  ├─ favicon e screenshot
  └─ handoff dalla pagina standalone
             ⇅ runtime messaging
Side Panel — stessa UI src/web
             ⇅ WebSocket + IDE bridge protocol
piw bridge
  ├─ canale/sessione pi
  ├─ handoff atomico del canale
  └─ broker privato per browser tool
             ⇅ JSONL stdio + controllo privato loopback
pi --mode rpc + estensione @magiusche/pi-webview
  └─ tool browser registrati dall'estensione pi
```

### Struttura sorgente proposta

```text
src/adapters/browser/
  api.ts                    # astrazione minima Chrome/Firefox
  connection.ts             # parsing URL, discovery e redazione errori
  context.ts                # modello pagina/selezione condiviso
  handoff.ts                # messaggi standalone ↔ content script ↔ panel
  tool-protocol.ts          # richieste DOM/screenshot e risposte
  ui/
    sidepanel.html
    sidepanel-bootstrap.ts
    connection-settings.ts
  chrome/
    manifest.json
    service-worker.ts
    content-script.ts
  firefox/                  # seconda implementazione
    manifest.json
    background.ts
    content-script.ts

src/bridge/
  browser-control.ts        # capability privata child pi ↔ bridge
  browser-handoff.ts        # adozione atomica di un canale esistente

packages/pi-webview/
  companion/
    pi-webview-chrome.zip
    pi-webview-firefox.xpi  # soltanto nella fase Firefox firmata
```

I nomi definitivi possono cambiare, ma la logica condivisa non deve essere
copiata tra Chrome e Firefox.

## Contratto dell'URL di connessione

`serverUrl` è un URL HTTP(S) completo, per esempio:

```text
http://127.0.0.1:7361
http://100.90.80.70:7361/?token=<credenziale>
http://computer.tailnet-name.ts.net:7361/?token=<credenziale>
https://piw.example.test/?token=<credenziale>
```

Regole:

- accettare soltanto `http:` e `https:`;
- normalizzare slash e path senza eliminare query string o token;
- costruire `bridge-config.json` sull'origin configurato, copiando i parametri
  di autenticazione necessari;
- usare il `wsUrl` restituito dal bridge, senza dedurre manualmente protocollo,
  host o porta;
- mantenere separati, dopo il parsing, i parametri persistenti di connessione e
  gli intenti effimeri `s`, `new` e `launch`;
- conservare la configurazione solo in `storage.local`, mai in storage sync;
- trattare l'intero URL come potenzialmente sensibile: campo mascherabile,
  nessun log, nessuna telemetria, errori e test snapshot redatti;
- una rotazione del token remoto richiede un nuovo link/handoff; in loopback il
  bridge può continuare a fornire il token tramite il discovery locale già
  esistente.

## Esperienza di connessione

### Avvio normale del pannello

1. Leggere `serverUrl`, oppure usare il default.
2. Richiedere il permesso host per l'origin quando necessario.
3. Chiamare `bridge-config.json` con timeout breve e `cache: no-store`.
4. Aprire il WebSocket restituito.
5. Registrare il client come `browser-companion`, includendo versione e
   capability supportate.
6. Caricare sessione e cronologia con il normale bootstrap pi-webview.

Se uno dei passaggi fallisce prima della prima connessione:

- non mostrare indefinitamente il loader generale;
- aprire la vista **Connessione** dentro il pannello;
- mostrare URL, errore redatto, **Verifica connessione**, **Salva e collega** e
  **Ripristina default**;
- distinguere server irraggiungibile, permesso host negato, 401/token non valido,
  risposta non-piw e WebSocket rifiutato;
- dopo il salvataggio riuscito tornare alla chat senza ricaricare manualmente
  l'estensione.

Dopo una connessione già riuscita si riusa il reconnect esistente. Superata una
soglia di tentativi falliti, il pannello offre il ritorno alle impostazioni ma
non modifica automaticamente l'URL salvato.

## Rilevamento companion e trasferimento dalla UI standalone

### Rilevamento

`externally_connectable` non può autorizzare genericamente qualsiasi host o IP
configurabile. Per supportare localhost, LAN e Tailscale senza conoscere prima
il dominio, il rilevamento usa il content script del companion:

1. la UI standalone emette un `window.postMessage` di discovery con protocol
   version e nonce;
2. il content script risponde soltanto se il companion è installato e abilitato;
3. la UI valida nonce, versione e capability;
4. appare un dialogo localizzato che chiede se aprire la vista nel pannello.

Qualsiasi pagina potrebbe imitare il messaggio di discovery. Per questo il
companion non importa credenziali né cambia server senza:

- gesto e conferma esplicita dell'utente;
- verifica che l'endpoint indicato risponda come un bridge pi-webview;
- controllo del protocollo e della versione supportata.

### Handoff senza doppio processo pi

Non è corretto aprire nel pannello lo stesso file sessione mentre la pagina
standalone mantiene il proprio canale: il bridge creerebbe due processi pi sulla
stessa sessione.

Va implementato un handoff atomico. Il discovery e la conferma precedono il
caricamento completo di config, lista sessioni e history nella standalone: se
l'utente accetta, quel primo loading viene saltato e avviene soltanto nel
pannello adottato.

1. la pagina standalone chiede al bridge un ticket monouso associato al proprio
   `Channel` e al processo pi già attivo;
2. il ticket ha scadenza breve, non è persistito e non viene registrato nei log;
3. dopo il consenso, pagina e content script consegnano al service worker URL
   completo e ticket;
4. il service worker apre il Side Panel nel contesto dello stesso browser/window;
5. il pannello si collega usando il ticket;
6. il bridge riassocia il nuovo WebSocket al `Channel` esistente, senza spawnare
   un secondo pi;
7. appena riceve `browser_handoff_adopted`, il pannello invia
   `handoff_adopted` al service worker, prima di config/history;
8. dopo questo ack di adozione — senza attendere la fine del loader — il
   companion crea nella stessa finestra una nuova scheda senza URL, ottenendo
   la pagina Nuova scheda predefinita, e chiude la scheda standalone originale.

Se apertura o adozione falliscono, la scheda originale resta aperta e continua
a usare il vecchio canale. Il ticket non può essere riusato.
Non tentare di navigare direttamente una pagina web verso `chrome://newtab`.

Va verificato con uno spike che il gesto sul dialogo della pagina sia preservato
attraverso content script/service worker per `sidePanel.open()`. L'esempio
ufficiale Chrome adotta questo schema, ma il flusso completo va provato su una
versione minima dichiarata di Chrome.

## Contesto della pagina nel composer

### Modello protocollo

Estendere il protocollo condiviso con un contesto browser distinto dalla
selezione editor:

```text
browser_context_changed
  tab/window identity interna
  url
  title
  favicon data URL opzionale
  selection ranges opzionali
  document/version identity

browser_context_cleared
  reason
```

Gli ID interni di tab e finestra non devono essere inviati al modello né
persistiti nella sessione.

Il service worker osserva cambio tab, navigazione, titolo e favicon. Il content
script osserva `selectionchange` con debounce e comunica il testo esatto delle
range correnti. Una selezione browser non ha coordinate riga/colonna affidabili:
si conservano testo e, se utile ai tool, descrittori DOM interni; non si fingono
coordinate da editor.

### Presentazione

Rendere il pannello di contesto come variante tipizzata:

- in VS Code/Visual Studio resta il nome file con numero di range;
- nel companion browser mostra favicon, titolo pagina e numero di range;
- hover/focus accessibile mostra l'URL completo;
- senza range il chip resta visibile con favicon e titolo/URL;
- su pagina protetta o senza titolo usare hostname/URL come fallback;
- il click può mettere a fuoco la scheda associata, senza navigarla.

### Contesto inviato al modello

Generalizzare `selection-context.ts` introducendo un blocco di trasporto
browser separato, per esempio `pi-webview-browser-context`:

- URL e titolo sono sempre allegati quando il companion ha una pagina attiva;
- il testo delle range è aggiunto solo quando esiste una selezione non vuota;
- favicon e ID del browser non sono inviati al modello;
- il blocco è rimosso dalla resa chat e dalla coda come avviene oggi per il
  contesto editor;
- i comandi extension continuano a essere inviati con testo esatto e senza
  contesto implicito, secondo il contratto già esistente.

Il contesto pagina è uno snapshot visibile al momento dell'invio. Un cambio tab
successivo non riscrive messaggi già accodati.

## Tool browser per l'agente

### Tool iniziali obbligatori

Registrare nell'estensione pi del package, con schema TypeBox e nomi espliciti:

1. `browser_page_dom`
   - acquisisce `document.documentElement.outerHTML` della scheda associata al
     pannello;
   - default: documento top-level corrente;
   - parametri opzionali futuri possono includere `selector` e frame;
   - restituisce URL, titolo, timestamp e contenuto;
   - non promette contenuto di closed shadow roots o frame cross-origin.

2. `browser_page_screenshot`
   - cattura almeno il viewport visibile della scheda tramite API browser;
   - restituisce un blocco immagine tipizzato e metadati URL/titolo;
   - un eventuale `fullPage` con scroll/stitching è una fase successiva, non va
     dichiarato finché non è realmente affidabile.

### Trasporto tool: bridge privato

I tool vivono nel processo `pi --mode rpc`, mentre DOM e screenshot esistono nel
browser. Non devono comunicare stampando record custom su stdout JSONL.

Il bridge crea per ogni `Channel`:

- endpoint di controllo raggiungibile solo dal loopback reale;
- capability casuale distinta dal token pubblico piw;
- mapping capability → channel;
- timeout, abort e correlation ID per richieste concorrenti.

`PiProcess` riceve URL e capability esclusivamente tramite variabili ambiente
interne. Il tool invia una richiesta al broker; il bridge inoltra un evento IDE
al companion browser; side panel/service worker esegue l'operazione e risponde;
il bridge riconsegna il risultato al tool.

Requisiti di sicurezza:

- rifiutare il control endpoint da interfacce non-loopback anche se il bridge è
  esposto su Tailscale;
- non accettare `X-Forwarded-For` sul percorso interno;
- non stampare capability, token o contenuto pagina;
- associare ogni richiesta al solo channel che la ha originata;
- annullare su abort del tool, chiusura channel, cambio sessione o timeout;
- errore chiaro se il client collegato non dichiara capability browser;
- impedire che due finestre rispondano alla stessa richiesta.

### Dimensioni del DOM

Il DOM può superare ampiamente il limite raccomandato dei tool pi
(50 KB/2000 righe). Il comportamento deve essere deterministico:

1. trasferire il DOM a chunk con un limite massimo configurato e protetto;
2. salvare l'acquisizione completa in un file temporaneo sulla macchina di
   `piw`, con permessi restrittivi;
3. restituire al modello un estratto troncato, statistiche e il path del file;
4. permettere al modello di continuare con il normale tool `read` e offset;
5. eliminare i file temporanei a scadenza e durante shutdown dove possibile;
6. segnalare esplicitamente DOM oltre il limite massimo invece di troncarlo in
   silenzio.

### Risorse pagina: decisione posticipata

Non aggiungere subito un generico tool “scarica qualsiasi risorsa”. DOM e
screenshot coprono la prima necessità, mentre un fetch nel contesto della pagina
potrebbe usare cookie e credenziali dell'utente.

Dopo la validazione Chrome valutare un eventuale `browser_page_resource` con:

- URL esplicito;
- same-origin per default;
- limiti MIME e dimensione;
- nessun accesso automatico a cookie/header sensibili;
- risultato testuale, file temporaneo o media tipizzato;
- conferma/policy distinta per richieste autenticate.

Il tool va implementato solo se emerge un caso d'uso non coperto dai primi due.

## Sicurezza e privacy

- Il token può essere contenuto nell'URL completo: trattare quindi l'intero
  valore come una credenziale.
- Non usare `storage.sync` per URL/token.
- Redigere query e fragment da log, errori, notifiche e analytics.
- Validare il server tramite endpoint/version marker prima di importare un
  handoff.
- Estendere il controllo `Origin` WebSocket per ammettere l'origin fisso del
  companion e gli origin standalone serviti dal bridge, senza rompere reverse
  proxy e Tailscale.
- Aggiungere CORS mirato per gli origin fissi Chrome/Firefox, se necessario per
  `bridge-config.json`; non usare `Access-Control-Allow-Origin: *` insieme a
  credenziali.
- Verificare CSP Manifest V3 per `http`, `https`, `ws` e `wss` configurabili.
- Nessuna acquisizione DOM/screenshot in background o a fini diagnostici.
- Mostrare chiaramente la pagina associata prima e durante una chiamata tool.
- Definire se il primo uso dei tool richiede consenso per origine/sessione. La
  scelta va chiusa nello spike di sicurezza prima dell'implementazione dei tool.
- Un cambio della scheda attiva durante una richiesta non deve produrre un
  risultato attribuito alla pagina sbagliata: usare document identity e
  verificare URL/versione alla risposta.

## Packaging e installazione companion

### Artefatti

Aggiungere:

- `pnpm package:chrome` → ZIP/artefatto Chrome versionato;
- `pnpm package:firefox` → ZIP di sviluppo e, in release, XPI firmato;
- inclusione degli artefatti in `packages/pi-webview/companion/`;
- build Chrome obbligatoria nelle release dopo il completamento della fase
  Chrome;
- build Firefox obbligatoria solo dopo il completamento della fase Firefox;
- bump versione unico tramite `pnpm release`, mai manuale.

### `ensureCompanions`

Generalizzare `src/bridge/companions.ts` senza duplicare la logica negli entry
point:

- target aggiuntivi `chrome` e poi `firefox`;
- rilevamento browser multipiattaforma;
- versione bundle e heartbeat/versione dichiarata dal companion;
- note localizzate installato/aggiornato/azione richiesta/errore;
- progress steps coerenti con VS Code e Visual Studio;
- `/piw install`, `reinstall`, `uninstall` estesi ai browser;
- rispetto della scelta dell'utente che ha rifiutato o rimosso il companion;
- nessuna apertura ripetuta del Web Store ad ogni startup.

Poiché un processo locale non può leggere in modo affidabile tutte le estensioni
installate in tutti i profili Chrome, il bridge mantiene soltanto un heartbeat
del companion realmente connesso e uno stato locale “installazione proposta”.
Il browser resta la fonte autoritativa per installazione e aggiornamento.

## Fasi di implementazione

### Fase 0 — Spike e decisioni bloccanti

- provare Side Panel con UI locale e WebSocket verso
  `http://127.0.0.1:7361`;
- provare HTTP/WS verso un IP Tailscale;
- verificare host permissions, CSP, CORS e Private Network Access;
- verificare apertura Side Panel da click nella pagina tramite content script;
- verificare sequenza crea Nuova scheda → chiude scheda sorgente mantenendo il
  pannello;
- scegliere canale Chrome Web Store e ottenere un ID stabile;
- definire policy di consenso per DOM/screenshot;
- fissare versione minima Chrome.

**Uscita:** breve ADR/concept con risultati verificati. Non procedere se manca un
ID stabile o un canale di installazione realistico.

### Fase 1 — Core browser condiviso e build Chrome

- creare astrazione browser minima;
- aggiungere runtime `browser-extension` in `environment.ts`;
- riusare `dist/web` nel Side Panel;
- aggiungere manifest MV3, service worker e content script Chrome;
- aggiungere build/package ZIP riproducibile;
- garantire assenza di codice remoto, conforme a Manifest V3.

### Fase 2 — Connessione e impostazioni

- implementare `serverUrl` completo con default;
- storage locale e redazione;
- richiesta permessi per origin;
- discovery `bridge-config.json` cross-origin;
- schermata impostazioni automatica su errore iniziale;
- test connessione, salvataggio e reconnect.

### Fase 3 — Discovery e handoff standalone

- handshake pagina/content script;
- dialogo localizzato nella UI standalone;
- ticket monouso e adozione atomica del channel;
- apertura Side Panel sulla stessa sessione;
- ack dopo re-init;
- nuova scheda predefinita e chiusura sicura della scheda originale;
- fallback senza perdita in ogni errore.

### Fase 4 — Contesto pagina

- tracking scheda/finestra/documento;
- titolo, URL, favicon e selection range;
- variante browser del context chip;
- contesto browser allegato a prompt/steering secondo le regole correnti;
- nessun contesto aggiunto ai comandi extension;
- pagine protette e cambi tab gestiti esplicitamente.

### Fase 5 — Tool DOM e screenshot

- broker privato child pi ↔ bridge ↔ browser;
- registrazione `browser_page_dom` e `browser_page_screenshot`;
- chunking, limiti, file temporanei e cleanup;
- abort/timeout/concorrenza;
- risultati tipizzati compatibili con la promozione finale dei tool result;
- policy di consenso definita nella Fase 0.

### Fase 6 — Installazione, release e documentazione Chrome

- artefatto incluso nel package pi;
- `ensureCompanions` e comandi `/piw` estesi;
- flusso Web Store/user confirmation;
- matrix companion aggiornata nei due README;
- privacy disclosure e permessi documentati;
- build Chrome inserita in `package:pi` e `release`;
- smoke test reale su Linux, Windows e macOS disponibili.

### Fase 7 — Firefox, seconda implementazione

Solo dopo Chrome completo:

- manifest Firefox con ID stabile;
- port della sidebar tramite `sidebar_action`/API supportata;
- adapter delle differenze service worker/background, storage, permessi e API
  tab;
- stesso protocollo di connessione, handoff, contesto e tool;
- XPI firmato AMO e installazione con consenso;
- packaging/release/uninstall;
- test di parità e documentazione.

## Test minimi

### Unitari

- parsing e normalizzazione URL completo;
- preservazione token e separazione degli intenti sessione;
- redazione URL in errori/log;
- rifiuto di schemi diversi da HTTP(S);
- default `http://127.0.0.1:7361`;
- mapping eventi browser → context chip/prompt context;
- URL sempre presente senza selezione;
- comandi extension senza contesto pagina;
- ticket handoff monouso, scadenza e rollback;
- capability broker confinata al channel;
- DOM chunking/troncamento/file temporaneo;
- screenshot come blocco immagine.

### Integrazione bridge

- side panel apre e riprende una sessione;
- handoff non crea un secondo `PiProcess`;
- fallimento handoff lascia vivo il client originale;
- tool request raggiunge soltanto il browser associato;
- due sessioni/browser non incrociano contesto o risultati;
- abort e disconnect terminano le richieste pendenti;
- endpoint interno rifiutato da IP non-loopback;
- token e capability assenti dai log.

### Browser reali

- Chrome: installazione/abilitazione, apertura pannello, navigazione tra tab,
  nuova scheda, reconnect locale e Tailscale;
- selezione aggiornata senza perdere URL;
- pagina protetta produce fallback comprensibile;
- DOM su pagina statica e SPA;
- screenshot del viewport corretto;
- pannello chiuso/riaperto riprende URL e sessione;
- Firefox: stessa suite di parità nella Fase 7.

## Criteri di accettazione Chrome

- [x] Il companion installabile usa un ID stabile.
- [x] Il pannello si apre accanto a qualsiasi pagina supportata.
- [x] Con bridge locale sulla porta 7361 si collega senza configurazione.
- [x] Un URL Tailscale HTTP completo con token si collega senza TLS.
- [x] Su connessione iniziale fallita compare un avviso e poi le impostazioni.
- [x] La pagina standalone rileva il companion e chiede il trasferimento.
- [x] Accettando, lo stesso processo/sessione passa al pannello senza duplicarsi.
- [x] Dopo l'ack la scheda standalone è sostituita da una Nuova scheda del
      browser.
- [x] Il chip mostra favicon + titolo, hover URL e range eventuali.
- [x] Senza selezione, URL e titolo restano contesto del prompt.
- [x] `browser_page_dom` restituisce il DOM con limiti e fallback file.
- [x] `browser_page_screenshot` restituisce un'immagine del viewport.
- [x] Nessun token, ticket, URL autenticato, DOM o screenshot compare nei log.
- [x] Build, typecheck, format, test unitari e smoke Chrome sono verdi.
- [x] Package pi e README elencano il companion Chrome realmente disponibile.

## Criteri di accettazione Firefox

- [ ] XPI firmato installabile su Firefox Release/Beta.
- [ ] Sidebar, connessione, handoff, contesto e tool hanno parità funzionale con
      Chrome, salvo differenze documentate dell'API browser.
- [ ] Il flusso di installazione richiede soltanto il consenso imposto da
      Firefox e non dipende da `about:debugging`.
- [ ] Build e test Firefox entrano nella release completa.
- [ ] Le matrici companion dei README vengono aggiornate soltanto quando
      Firefox è effettivamente distribuito.

## Decisioni aperte da chiudere nella Fase 0

1. Chrome Web Store pubblico oppure unlisted e relativo ID definitivo.
2. Meccanismo con cui `/piw install` apre/propone il listing senza ripeterlo a
   ogni avvio.
3. AMO listed/unlisted e hosting aggiornamenti Firefox.
4. Consenso DOM/screenshot: una volta per origine, per sessione oppure affidato
   ai permessi browser già concessi.
5. Limite massimo del DOM trasferibile e durata dei file temporanei.
6. Comportamento con iframe e shadow DOM nella prima versione.
7. Versioni minime supportate di Chrome e Firefox.
8. Se il companion debba supportare più profili/server in futuro; la V1 assume
   un solo `serverUrl` attivo.
9. Se aggiungere davvero `browser_page_resource` dopo la validazione dei primi
   due tool.

## Stima preliminare

| Fase | Contenuto                                       | Stima indicativa |
| ---- | ----------------------------------------------- | ---------------- |
| 0    | spike API, sicurezza e distribuzione Chrome     | 1–2 giorni       |
| 1–2  | shell Chrome, build, connessione e impostazioni | 2–4 giorni       |
| 3    | handoff atomico standalone → Side Panel         | 2–4 giorni       |
| 4    | contesto pagina e selezioni                     | 2–3 giorni       |
| 5    | broker e tool DOM/screenshot                    | 3–5 giorni       |
| 6    | installazione, release, documentazione e smoke  | 2–4 giorni       |
| 7    | port e distribuzione Firefox                    | 4–7 giorni       |

Totale orientativo: **circa 3–5 settimane**, dominato da distribuzione browser,
permessi, handoff senza doppia sessione e tool browser sicuri, non dal riuso
della Web UI.

## Fonti tecniche di riferimento

- Chrome Side Panel API:
  https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome alternative extension installation:
  https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions
- Chrome cross-origin network requests:
  https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Chrome external messaging:
  https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Firefox sidebar API:
  https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction
- Firefox addon signing:
  https://support.mozilla.org/kb/add-on-signing-in-firefox
- pi extension tools e limiti output:
  documentazione locale `docs/extensions.md`
- pi RPC ed Extension UI Protocol:
  documentazione locale `docs/rpc.md`
