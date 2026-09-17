# Piano 0012 — Dettatura speech-to-text dal microfono

> Stato: **IMPLEMENTATO NEL BRANCH `feat/speech-to-text-input`; validazione
> manuale dei runtime ancora necessaria**.
> Ambito: dettatura dal microfono nel composer della Web UI condivisa.
> Riferimenti: `src/web`, piano 0010 per il companion Chrome e protocollo
> `UserConfig` condiviso tra bridge e companion IDE.

## Stato dell'implementazione

L'implementazione condivisa include capability detection, configurazione
persistente e normalizzata, controller testabile, UI/localizzazione, push-to-talk,
toggle-to-talk, lifecycle sicuro e opt-in cloud. Sono state fissate le seguenti
decisioni iniziali, da convalidare con microfono reale prima di dichiarare un
runtime supportato:

- il segmento vocale viene inviato autonomamente; una bozza manuale viene
  ripristinata dopo l'invio per non essere trasmessa per errore;
- la pausa toggle iniziale è **1.500 ms**;
- le scorciatoie predefinite, limitate alla Web UI focalizzata, sono
  `Ctrl+Alt+Space` (push) e `Ctrl+Alt+M` (toggle), entrambe configurabili;
- blur, perdita di visibilità e `pagehide` fermano senza inviare;
- in assenza di un motore locale pronto, il microfono resta visibile ma
  disabilitato; il cloud richiede l'opt-in confermato;
- il catalogo iniziale comprende lingua di sistema e i tag verificabili dalla
  Web Speech API; rimozione modello resta visibile e disabilitata perché
  l'API non offre un uninstall verificato;
- la matrice manuale di Fase 0, inclusi VS Code e WebView2, resta il requisito
  per aggiornare README o promettere compatibilità pubblica;
- la Webview desktop di VS Code è stata verificata come non supportata al
  momento: pur esponendo parti della Web Speech API, il container non delega
  l'accesso al microfono. La UI rileva la Permissions Policy, nasconde il
  microfono e tutti i controlli della dettatura, lasciando una sola nota di
  indisponibilità senza tentare una cattura;
- il Side Panel Chrome non mostra in modo affidabile il prompt
  `getUserMedia`, quindi un gesto esplicito apre una piccola pagina
  dell'estensione; solo il pulsante localizzato di quella pagina chiede il
  consenso Chrome al microfono. Non viene dichiarato `audioCapture`: Chrome
  lo riserva alle packaged app, non alle estensioni. Il flusso non abilita
  cattura di tab, desktop, riunioni o file.

## Decisione di perimetro

Questo piano separa esplicitamente due funzioni diverse.

1. **Speech-to-text dal microfono di input**: è l’unica funzione descritta e
   potenzialmente implementata da questo piano. Deve essere disponibile nella
   Browser View di `piw`, nei companion IDE già previsti e nel Side Panel del
   companion Chrome, ma soltanto dove il runtime espone le API necessarie.
2. **Audio-to-text**: trascrizione dell’audio di una scheda, del desktop, di una
   riunione o di un file/audio stream. **Non è implementata e non fa parte di
   questo piano.**

Di conseguenza questa attività non aggiunge `tabCapture`, `getDisplayMedia`,
registrazione locale, invio di stream audio al bridge o tool per l’agente. Il
solo dato che può diventare un prompt è il testo dettato dall’utente dopo il
normale flusso di trascrizione della UI.

## Obiettivo

Aggiungere una modalità di dettatura locale e controllabile nel composer:

- usa il microfono predefinito del sistema per impostazione iniziale;
- mostra il pulsante microfono immediatamente prima dell’invio quando la
  funzionalità speech-to-text è presente nel runtime;
- permette di scegliere una periferica di input quando il runtime lo consente;
- supporta **push-to-talk** come modalità predefinita e **toggle-to-talk** come
  alternativa;
- trascrive progressivamente nella input box senza perdere il testo già
  digitato;
- invia secondo le regole specifiche delle due modalità;
- privilegia il riconoscimento locale e non abilita mai un servizio cloud senza
  opt-in esplicito;
- espone modelli/pacchetti linguistici realmente offerti dall’API, senza
  inventare capacità che il browser o l’IDE non forniscono.

Non è un sostituto della dettatura di sistema, di Chrome Live Caption o delle
funzioni di accessibilità dell’IDE. Quelle funzioni non offrono un’API stabile
per ottenere una trascrizione nell’estensione.

## Evidenze iniziali e vincolo di compatibilità

Lo spike locale del 17 settembre 2026, su Chrome 153, in una pagina
`http://127.0.0.1` ha verificato che:

- il contesto loopback è sicuro;
- `SpeechRecognition`, `available()`, `install()` e `processLocally` sono
  esposti;
- `it-IT` risulta scaricabile per il riconoscimento on-device in un profilo
  pulito;
- `SpeechRecognition.start(audioTrack)` accetta una `MediaStreamTrack` audio
  viva.

Questa evidenza non autorizza a dichiarare supportati VS Code Webview, WebView2
Visual Studio o ogni browser. Ogni runtime deve essere rilevato e provato
separatamente. Il pulsante non compare quando manca l’API base di
riconoscimento; se l’API esiste ma non c’è un motore consentito dalla policy,
il pulsante resta visibile ma disabilitato con una spiegazione e un collegamento
alle impostazioni pertinenti.

La Browser View loopback è un caso supportabile. Una Browser View esposta via
HTTP su un indirizzo remoto non può presumere l’accesso al microfono: richiede
un contesto sicuro HTTPS. Il Side Panel Chrome è invece una pagina
`chrome-extension://` sicura.

## Runtime inclusi

| Runtime UI                 | Obiettivo                                      | Regola di disponibilità                                                          |
| -------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Browser View `piw`         | Dettatura direttamente nella pagina standalone | Solo se Web Speech API e policy del browser consentono una modalità utilizzabile |
| Side Panel Chrome          | Stessa UI e stessa logica della Browser View   | Solo se le API sono disponibili nella pagina dell’estensione                     |
| VS Code                    | Dettatura nella Webview dell’addon             | Solo se la Webview/Electron espone le API richieste                              |
| Visual Studio              | Dettatura nella WebView2 dell’addon            | Solo se WebView2 espone le API richieste                                         |
| Altri browser o futuri IDE | Nessuna promessa implicita                     | Feature detection e matrice di supporto prima di mostrare il controllo           |

Il bridge, il processo pi e gli host IDE non devono catturare audio come
fallback. Forniscono soltanto configurazione globale e il normale trasporto del
messaggio finale.

## Modello delle capability

Un modulo Web puro centralizza il rilevamento, così la UI non contiene rami
specifici per Chrome, VS Code o Visual Studio. Il modello distingue almeno:

```ts
interface SpeechCapabilities {
  recognition: boolean;
  localRecognition: boolean;
  cloudRecognition: boolean;
  modelAvailability: boolean;
  modelInstall: boolean;
  modelRemoval: boolean;
  inputEnumeration: boolean;
  inputSelection: boolean;
  microphonePolicyAllowsCapture: boolean;
  microphonePermission: "prompt" | "granted" | "denied" | "unknown";
}
```

I nomi definitivi potranno cambiare, ma le regole sono queste:

- `recognition` richiede `SpeechRecognition` oppure l’alias compatibile
  `webkitSpeechRecognition`;
- `localRecognition` richiede un percorso verificato che imponga
  `processLocally: true` e un modello disponibile o scaricabile;
- `cloudRecognition` è utilizzabile solo quando l’utente abilita esplicitamente
  il relativo opt-in;
- `inputEnumeration` richiede `navigator.mediaDevices.enumerateDevices()`;
- `inputSelection` richiede sia `getUserMedia()` con `deviceId` sia l’uso
  verificato della traccia con `SpeechRecognition.start(audioTrack)`;
- `microphonePolicyAllowsCapture` legge la Permissions Policy del documento
  senza chiedere permessi: se il container non delega `microphone`, non esiste
  alcun percorso di dettatura, locale o cloud;
- il rilevamento non deve avviare il microfono né provocare un prompt di
  autorizzazione automaticamente.

La feature detection resta l’autorità. User agent, versione del browser o tipo
IDE possono servire solo per messaggi diagnostici e test, non per abilitare
forzatamente la funzione.

## Motore di riconoscimento e privacy

### Locale come comportamento predefinito

Il valore iniziale di `allowCloudTranscription` è `false`. Quando è falso:

1. la UI chiede all’API la disponibilità per la lingua selezionata con
   `processLocally: true`;
2. avvia il riconoscimento soltanto con elaborazione locale;
3. non degrada silenziosamente alla modalità cloud;
4. se il pacchetto è scaricabile, guida l’utente alle impostazioni per
   scaricarlo;
5. se il motore locale non è disponibile, non avvia l’ascolto e spiega il
   motivo.

L’audio non viene mandato al bridge, a pi, agli host IDE o al modello LLM. Il
messaggio testuale segue il normale invio solo dopo le regole descritte sotto.

### Opt-in cloud

Il toggle **Consenti trascrizione cloud** è inizialmente spento. Quando il
runtime offre soltanto questa alternativa o la usa come fallback, l’attivazione
richiede una conferma localizzata che spieghi che audio e/o trascrizione possono
essere elaborati da un servizio del browser o del suo provider.

L’opt-in non equivale a un consenso generico permanente al microfono: il
browser mantiene la propria autorizzazione per origine. La UI deve poter essere
fermata in ogni momento e non deve effettuare retry automatici verso il cloud.

### Modelli e pacchetti linguistici

Il termine nella UI deve essere **modello linguistico** o **pacchetto
linguistico di trascrizione**, per distinguerlo dal modello LLM di pi.

Le impostazioni mostrano:

- **Lingua di sistema** come scelta predefinita, risolta dal runtime con la
  lingua dell’interfaccia/browser e una catena di fallback BCP-47;
- le lingue esplicite che il runtime può interrogare e rendere disponibili;
- stato per lingua: disponibile, scaricabile, download in corso, non
  disponibile o errore;
- azione di download solo se `SpeechRecognition.install()` o un’API equivalente
  la espone;
- modello/preferenza linguistica selezionata per la successiva dettatura.

L’API Web Speech verificata espone `available()` e `install()`, ma non è stata
verificata un’API di rimozione dei modelli. La richiesta di rimuovere un modello
non deve essere simulata con un pulsante che non può agire:

- se il runtime espone una rimozione supportata, la UI la offre e la testa;
- altrimenti la riga **Rimuovi modello** resta visibile ma disabilitata, con
  una spiegazione e, se disponibile, l’indicazione della gestione del browser
  o del sistema operativo;
- lo spike deve chiudere questa limitazione prima di prometterla nella
  documentazione utente.

Non esiste necessariamente un elenco universale dei pacchetti installabili.
La UI interroga un catalogo ristretto di tag BCP-47 utili, comprendente la
lingua di sistema e quelle supportate dal runtime, anziché inventare un elenco
completo.

## Impostazioni

Aggiungere una sezione **Dettatura** nelle impostazioni Webview. È una
preferenza dell’utente, non della sessione o del progetto: non va nel JSONL
sessione e non viene inclusa in messaggi o prompt.

Le preferenze webview già applicabili live restano immediate, quindi questa
sezione non modifica la regola dell’unico pulsante **Applica** per impostazioni
pi.dev, flag CLI e URL Browser View.

### Campi previsti

| Campo                       | Default                     | Comportamento                                                                                                                         |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Stato disponibilità         | Solo lettura                | Indica API assente, motore locale pronto, modello da scaricare, autorizzazione negata o errore                                        |
| Periferica di input         | Predefinita di sistema      | Elenca il microfono default e i device rilevati; pulsante **Aggiorna periferiche** riesegue la discovery                              |
| Modalità ascolto            | Push-to-talk                | Scelta fra push-to-talk e toggle-to-talk                                                                                              |
| Combinazione tasti          | Da definire dopo audit      | Mostra la scorciatoia attiva per la modalità scelta e permette la configurazione solo dove può essere intercettata in modo affidabile |
| Modello linguistico         | Lingua di sistema           | Sceglie la lingua/pacchetto usato dal motore, con stato e azioni disponibili                                                          |
| Pausa per invio toggle      | Da validare, proposta 1,5 s | Durata di silenzio dopo cui viene inviato il segmento dettato in toggle-to-talk                                                       |
| Consenti trascrizione cloud | `false`                     | Toggle con conferma esplicita, disponibile solo se il runtime può usarlo                                                              |

All’apertura delle impostazioni la UI chiama `enumerateDevices()` senza
richiedere accesso al microfono. Se il browser nasconde nomi e ID finché manca
l’autorizzazione, la lista mostra almeno **Predefinito di sistema** e spiega il
vincolo. **Aggiorna periferiche**, eseguito da un gesto esplicito, può chiedere
l’autorizzazione quando necessaria e aggiorna l’elenco dopo l’esito.

Quando un companion non consente la selezione esplicita della periferica, il
campo resta visibile, selezionato su **Predefinita di sistema** e disabilitato
con il motivo. Lo stesso criterio vale per download, rimozione modello, cloud e
scorciatoie non supportati. Non nascondere un controllo richiesto per un limite
del runtime senza spiegare il limite.

### Persistenza e scope

Estendere `UserConfig` con una struttura indicativa:

```ts
interface SpeechToTextConfig {
  mode: "push-to-talk" | "toggle-to-talk";
  language: "system" | string;
  allowCloudTranscription: boolean;
  toggleSilenceMs: number;
  shortcuts: {
    pushToTalk: string;
    toggleToTalk: string;
  };
  inputByRuntime: Record<string, "default" | string>;
}
```

La scelta della periferica non può essere ingenuamente globale: i `deviceId`
sono opachi, possono cambiare dopo permessi/dispositivi e sono in genere
circoscritti all’origine o alla Webview. Perciò:

- modalità, lingua, soglia pausa e opt-in cloud sono preferenze condivise della
  UI sul computer;
- la scelta `default` è portabile e resta l’impostazione iniziale;
- un `deviceId` esplicito è memorizzato solo nel profilo del runtime/origine che
  lo ha ottenuto, senza label della periferica;
- l’ID non viene scritto in chat, sessioni, log diagnostici o notifiche;
- se l’ID non è più valido, la UI torna al default e avvisa senza registrare
  testo audio o dettagli superflui del dispositivo.

La struttura passa attraverso `src/ide/protocol.ts`, `src/bridge/config.ts`, il
config store del companion VS Code e il mirror C# di Visual Studio, così la
stessa preferenza non viene interpretata diversamente dai quattro host.

## Composer e stati di ascolto

### Pulsante e accessibilità

Il pulsante microfono compare nella toolbar immediatamente prima del pulsante
Invia. È assente solo se manca l’API di riconoscimento; è disabilitato quando
l’API esiste ma non vi è un motore autorizzato/pronto.

Stati visuali:

- inattivo: icona microfono e tooltip localizzato con modalità e scorciatoia;
- ascolto push-to-talk: evidenza immediata mentre il tasto o il pulsante è
  tenuto premuto;
- ascolto toggle: stato persistente fino allo stop esplicito;
- ascolto attivo: l’icona diventa una waveform animata e conserva un testo
  accessibile con stato, modalità e scorciatoia;
- errore: ritorno a microfono inattivo con messaggio localizzato, senza invio
  automatico.

La waveform non deve essere l’unico segnale. Servono `aria-pressed`, label
aggiornata, stato leggibile da screen reader e variante senza animazione per
`prefers-reduced-motion`.

### Inserimento progressivo

Il controller mantiene un segmento di dettatura distinto dal testo manuale:

- risultati interim aggiornano soltanto il segmento ancora provvisorio;
- risultati finali consolidano il segmento nella input box;
- testo digitato prima o durante l’ascolto non viene cancellato né sostituito;
- gli aggiornamenti rispettano selezione, focus e ridimensionamento già gestiti
  dal composer;
- un errore, cambio device, stop o perdita autorizzazione lascia il testo già
  consolidato modificabile e non lo invia da solo.

Il dettaglio da confermare è se un segmento vocale debba essere inviato come
messaggio autonomo, preservando un eventuale draft manuale, oppure se debba
fondersi nel draft e inviare tutto. La proposta prudente è inviare soltanto il
segmento detenuto dal controller, così una bozza scritta non parte per errore.

### Push-to-talk

È la modalità predefinita.

1. L’utente tiene premuto il pulsante microfono oppure la scorciatoia attiva.
2. Il controller chiede il microfono solo al gesto, apre il riconoscimento e
   rende risultati interim/finali nella input box.
3. Su `pointerup`, rilascio della scorciatoia, annullamento gesto, blur o errore,
   arresta l’ascolto e attende l’ultimo risultato finale disponibile.
4. Se il segmento contiene testo non vuoto, lo invia una sola volta.
5. Arresta le tracce audio, torna inattivo e non riavvia l’ascolto.

L’invio avviene solo dopo il rilascio. Una perdita del focus o una cancellazione
non deve trasformarsi in un invio involontario: in tali casi il testo resta nel
composer salvo la semantica esplicitamente scelta per la chiusura del gesto.

### Toggle-to-talk

1. Un click o la scorciatoia avvia l’ascolto persistente.
2. Il controller mostra la waveform e mantiene il microfono aperto.
3. Dopo un risultato finale e il periodo configurato di silenzio, invia il
   segmento non vuoto.
4. Rimane in ascolto, crea un nuovo segmento e ripete il ciclo senza chiedere
   nuovamente il permesso.
5. Un secondo click/scorciatoia, la perdita obbligatoria di capability, reload,
   unload o stop esplicito chiude microfono e riconoscimento.

Eventi `end` naturali del browser non devono creare duplicati: il controller li
tratta come parte della stessa sessione toggle e riavvia solo quando lo stato
richiede ancora ascolto. Timer, risultati e riconoscitori usano un identificativo
di run per ignorare callback obsolete.

### Scorciatoie

L’interfaccia deve indicare chiaramente la combinazione attiva per entrambe le
modalità. La prima versione garantisce la scorciatoia solo quando la Web UI ha
focus: una pagina browser o Webview non può promettere un hotkey globale del
sistema operativo.

Prima di fissare i default bisogna fare un audit dei conflitti in Chrome, VS
Code e Visual Studio. La scelta proposta è offrire una scorciatoia configurabile
per runtime, con fallback al solo pulsante se l’host intercetta o riserva la
combinazione. Un’eventuale registrazione a livello host IDE è una fase distinta
e viene inclusa soltanto se ogni host offre un’API affidabile e coerente.

## Architettura proposta

```text
Web UI condivisa
  ├─ speech-to-text.ts          rilevamento API e adapter browser/Webview
  ├─ speech-controller.ts       macchina a stati, gesture, timer e cleanup
  ├─ speech-settings.ts         catalogo lingue, device discovery e stato UI
  ├─ composer integration       segmento interim/finale e invio normale
  └─ i18n + CSS + icone         microfono, waveform, stati accessibili
             ⇅ getConfig/setConfig
Host corrente
  ├─ Browser View: bridge ConfigStore
  ├─ Chrome Side Panel: bridge ConfigStore tramite UI condivisa
  ├─ VS Code: ConfigStore dell’host
  └─ Visual Studio: UserConfigStore C#
```

File orientativi:

```text
src/web/
  speech-to-text.ts             # contratti browser, capability e adapter
  speech-controller.ts          # state machine indipendente dal DOM
  speech-settings.ts            # device/model status e preferenze UI
  main.ts                       # wiring del composer e settings
  icons.ts                      # microfono e waveform SVG
  index.html                    # pulsante e sezione impostazioni
  style.css                     # stati e reduced motion
  locale/{it,en}.json           # tutte le stringhe visibili

src/ide/protocol.ts             # SpeechToTextConfig in UserConfig
src/bridge/config.ts            # default, validazione e persistenza
src/adapters/visualstudio/...   # mirror C# della struttura UserConfig
tests/
  speech-to-text.test.ts
  speech-controller.test.ts
  speech-settings.test.ts
```

I file potranno essere adattati alla struttura reale, ma il riconoscimento non
deve essere incorporato in `main.ts` come logica non testabile e non deve essere
duplicato nei companion.

## Sicurezza, privacy e lifecycle

- Il consenso microfono è richiesto solo dopo un gesto esplicito dell’utente.
- La UI non registra né conserva audio; chiude tutte le `MediaStreamTrack` a
  stop, errore, reload, disconnect, chiusura pagina e cambio non sicuro di
  runtime.
- Il cloud è disabilitato di default e non esiste fallback implicito.
- Testo interim e finale resta locale nella UI fino alla normale azione di
  invio; nessun evento diagnostico lo deve stampare.
- Device ID, label e stato dei modelli non sono contenuto di prompt, sessione o
  telemetria.
- Se il device selezionato scompare, l’ascolto termina in modo visibile e non
  passa automaticamente a un altro microfono durante una dettatura attiva.
- Il cambio sessione, la riconnessione del bridge o lo stato dell’agente non
  devono trasformare l’audio in steering o inviarlo bypassando il composer.
- Toggle-to-talk richiede un indicatore persistente inequivocabile. La policy
  su visibilità/perdita focus va definita nello spike, privilegiando lo stop
  sicuro quando il runtime non può garantire che l’utente veda lo stato attivo.

## Fasi di lavoro

### Fase 0 — Spike delle API e decisioni bloccanti

Provare con un microfono reale, senza salvare audio, in ciascun runtime:

- Browser View Chrome su loopback;
- Side Panel Chrome;
- VS Code Extension Development Host;
- Visual Studio/WebView2 su Windows.

Per ogni ambiente verificare:

- presenza e comportamento di `SpeechRecognition`;
- riconoscimento locale, `available()`, `install()` e tag `it-IT`;
- presenza o assenza di API per rimuovere modelli;
- permesso microfono, `enumerateDevices()`, cambio device e `getUserMedia()`;
- `SpeechRecognition.start(audioTrack)` con una periferica esplicita;
- gestione di `onend`, errori, lingua e risultati interim;
- supporto reale delle scorciatoie quando la Web UI ha focus;
- contesto sicuro Browser View locale e comportamento su URL HTTP remoto.

**Uscita:** matrice capability per runtime, decisione sul comportamento cloud,
sulla rimozione modelli, sui default delle scorciatoie e sulla policy di stop a
perdita focus. Un runtime senza API resta fuori dalla funzione, senza workaround
nativo o cloud imposto.

### Fase 1 — Core Web condiviso e configurazione

- Definire adapter e tipi TypeScript per l’API sperimentale senza dichiarazioni
  globali non controllate.
- Implementare capability probe, catalogo lingue e macchina a stati pura.
- Estendere `UserConfig` e i quattro config store con migrazione retrocompatibile.
- Implementare scope corretto per device default/esplicito.
- Aggiungere test unitari della policy locale/cloud e del cleanup.

### Fase 2 — Impostazioni e gestione autorizzazioni

- Aggiungere la sezione Dettatura localizzata.
- Collegare discovery device all’apertura impostazioni e al refresh esplicito.
- Implementare lingua/modello, stati download e installazione verificata.
- Rendere visibili e disabilitati i controlli impossibili nel companion.
- Aggiungere opt-in cloud con conferma e revoca immediata.

### Fase 3 — Composer, pulsante e interazioni

- Aggiungere il pulsante prima di Invia, icone, waveform e semantica accessibile.
- Integrare segmento interim/finale senza perdere il draft manuale.
- Implementare push-to-talk e toggle-to-talk con timer, run ID e cleanup.
- Integrare le scorciatoie approvate e la loro indicazione nelle impostazioni e
  nei tooltip.
- Gestire in modo deterministico stop, errori, device removal e lifecycle pagina.

### Fase 4 — Validazione per companion e documentazione

- Eseguire la matrice manuale sui runtime effettivamente supportati.
- Aggiornare la matrice supporto nei README soltanto con capacità verificate.
- Aggiungere note privacy e spiegazione dell’opt-in cloud nella documentazione
  utente del package, senza duplicarla nel README root.
- Verificare build, typecheck, format e test; non aggiornare artefatti locali
  salvo richiesta esplicita dell’utente o release.

## Test

### Unitari

- API assente: nessun pulsante e impostazioni in stato informativo;
- API presente, locale disponibile/scaricabile/non disponibile;
- cloud disabilitato: nessun avvio non locale;
- cloud abilitato solo dopo conferma;
- discovery device senza permesso, con device e con ID non più valido;
- fallback a predefinito solo prima di una nuova dettatura, mai nel mezzo;
- installazione modello, errore e stato download;
- rimozione modello disponibile/non disponibile senza pulsanti ingannevoli;
- push: avvio, interim, finale, release, un solo invio e cleanup;
- toggle: pause, invii consecutivi, stop, `onend` e assenza di duplicati;
- testo manuale preservato durante risultati interim;
- blur, reload, abort e device disconnect fermano tracce/timer;
- `prefers-reduced-motion`, label accessibile e scorciatoie.

### Integrazione UI e configurazione

- le preferenze viaggiano correttamente tra protocollo, bridge, VS Code e
  Visual Studio senza perdere campi sconosciuti;
- la Browser View e il Side Panel riusano il medesimo controller;
- il device ID non viene serializzato in JSONL o incluso in un frame prompt;
- il pulsante è prima di Invia e non modifica gli altri controlli della toolbar;
- impostazioni speech live non mostrano né richiedono l’Applica globale.

### Manuali

Per ogni runtime che supera la Fase 0:

- autorizzazione e revoca del microfono;
- scelta default e scelta di due periferiche reali, poi refresh/disconnessione;
- download e scelta di `it-IT`, lingua di sistema e lingua alternativa;
- push con mouse/touch e tastiera;
- toggle con più pause e più messaggi consecutivi;
- transizione a errore e recupero senza invii imprevisti;
- cloud opt-in, revoca e verifica che senza opt-in non avvenga fallback;
- lettore schermo e reduced motion dove disponibili.

## Criteri di accettazione

- [ ] Audio-to-text di tab, desktop, file e riunioni non è stato aggiunto né
      pubblicizzato.
- [ ] In ogni runtime con API speech valida compare il microfono prima di Invia;
      dove manca, non compare alcun controllo falso.
- [ ] L’API assente o un motore non autorizzato produce una spiegazione chiara,
      non un crash o un fallback cloud implicito.
- [ ] Push-to-talk è il default e invia una sola volta dopo il rilascio.
- [ ] Toggle-to-talk invia un segmento dopo la pausa configurata e resta in
      ascolto per il segmento successivo finché l’utente non lo arresta.
- [ ] L’icona/waveform rende l’ascolto inequivocabile, è accessibile e rispetta
      reduced motion.
- [ ] La scelta periferica mostra default + device rilevati, si aggiorna su
      richiesta e resta disabilitata ma spiegata quando non supportata.
- [ ] Lingua/modello mostra soltanto stati e azioni offerti dall’API; download e
      rimozione non vengono promessi se il runtime non può eseguirli.
- [ ] Trascrizione cloud è spenta per default, richiede conferma esplicita e può
      essere disattivata subito.
- [ ] Audio, trascrizioni, device ID e configurazioni sensibili non finiscono in
      prompt automatici, session JSONL o log.
- [ ] Browser View, Side Panel e companion IDE condividono la stessa logica Web;
      nessun host registra audio come fallback.

## Questioni da decidere insieme

1. Semantica del draft: il segmento vocale deve essere inviato da solo, come
   proposto, o deve fondersi con il testo manuale già presente nel composer?
2. Soglia iniziale per l’invio dopo pausa in toggle-to-talk: 1,5 secondi è una
   proposta, non una decisione fissata.
3. Combinazioni predefinite e livello di configurabilità: bisogna evitare
   collisioni con Chrome, VS Code, Visual Studio, tastiere internazionali e
   comandi del sistema operativo.
4. Cosa fare quando il Side Panel perde focus ma rimane visibile: continuare
   l’ascolto o fermarlo per prudenza?
5. Se un runtime offre solo riconoscimento cloud, il pulsante deve restare
   disabilitato finché l’opt-in non è attivo, come proposto, oppure va nascosto?
6. Quali lingue oltre alla lingua di sistema e `it-IT` devono entrare nel
   catalogo iniziale?
7. Come esporre l’eventuale rimozione di un modello quando Chrome/Web Speech non
   fornisce un’API di uninstall: solo istruzioni al sistema/browser o nessun
   controllo nella prima versione?

## Riferimenti tecnici

- Chrome, on-device Web Speech API: https://developer.chrome.com/blog/new-in-chrome-139/
- Web Speech API, explainer on-device:
  https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md
- Chrome Side Panel API:
  https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Piano companion Chrome: `docs/plans/0010-companion-browser-chrome-firefox.md`
