# Piano 0011 — Fix installazione companion VS Code su Remote SSH

> Stato: **IMPLEMENTATO NEL CODICE — PUBBLICAZIONE E COMUNICAZIONE PENDENTI**
> Release prevista: **0.4.0**
> Riferimento: [issue GitHub #1](https://github.com/MagiusCHE/pi-webview/issues/1)
> Ambito: fallback di installazione e disinstallazione del companion VS Code
> quando il comando `code` non è disponibile.

## Problema verificato

Il fallback in `src/bridge/companions.ts` presenta tre problemi collegati:

1. `vsCodeExtensionsDir()` considera soltanto `~/.vscode/extensions`. Su un
   host Remote SSH le estensioni risiedono normalmente in
   `~/.vscode-server/extensions`; se la directory desktop non esiste,
   l’installazione viene saltata senza una nota conclusiva.
2. `installVsCodeCompanionDirect()` estrae il VSIX con `tar -xf`. Un VSIX è un
   archivio ZIP e GNU tar su Linux lo rifiuta con `This does not look like a tar
archive`.
3. Nel VSIX i file installabili sono sotto `extension/`. Estrarre l’archivio
   completo direttamente nella cartella finale lascerebbe `package.json` in
   `extension/package.json`, mentre VS Code lo richiede alla radice della
   directory dell’estensione.

Il percorso principale basato sul CLI `code --install-extension` non cambia. Il
fix riguarda il fallback usato quando il CLI non può essere risolto, situazione
comune sugli host headless.

## Obiettivi

- Riconoscere installazioni desktop, VS Code Server e relative varianti
  Insiders senza assumere un unico percorso.
- Installare il VSIX con un’estrazione ZIP multipiattaforma che non dipenda da
  utility disponibili nel sistema operativo.
- Produrre la stessa struttura creata da `code --install-extension`.
- Non rimuovere una versione funzionante prima che il nuovo archivio sia stato
  estratto e validato.
- Usare la stessa discovery per installazione e disinstallazione.
- Conservare il comportamento silenzioso quando non è presente alcuna
  installazione riconoscibile di VS Code.

## Decisioni di implementazione

### 1. Discovery delle directory delle estensioni

Sostituire il singolo `vsCodeExtensionsDir()` con una funzione che restituisce
le directory esistenti e senza duplicati, considerando almeno:

- `${VSCODE_AGENT_FOLDER}/extensions`, quando la variabile indica un percorso
  assoluto valido;
- `~/.vscode-server/extensions`;
- `~/.vscode-server-insiders/extensions`;
- `~/.vscode/extensions`;
- `~/.vscode-insiders/extensions`.

La home deve provenire da `homedir()` su tutte le piattaforme, evitando percorsi
relativi se `USERPROFILE` non è valorizzata. Non devono essere create directory
per installazioni che non esistono già.

Se sono presenti più directory riconosciute, il fallback deve controllarle
tutte. Questo evita di scegliere arbitrariamente tra un’installazione desktop e
una server presenti sullo stesso host. I passi di progresso possono indicare il
tipo di destinazione, mentre il riepilogo continua a produrre un solo invito al
reload per VS Code.

### 2. Estrazione ZIP nativa al processo Node

Aggiungere una dipendenza runtime ZIP adatta all’estrazione sicura, inclusa
normalmente nei bundle esbuild già prodotti dal progetto. L’implementazione usa
`fflate` e valida esplicitamente ogni percorso prima della scrittura. Non usare
`tar`, `unzip`, PowerShell o altri programmi esterni.

Per ogni destinazione da aggiornare:

1. creare una directory temporanea sullo stesso filesystem della directory
   finale;
2. estrarre il VSIX nella directory temporanea;
3. verificare la presenza di `extension/package.json`;
4. verificare che nome, publisher e versione corrispondano al companion e alla
   versione letta dal manifest VSIX;
5. solo dopo la validazione, rimuovere la precedente directory del companion e
   spostare `tmp/extension` in
   `magiusche.pi-webview-ide-<version>`;
6. eliminare sempre il contenitore temporaneo e i metadati esterni del VSIX.

L’estrattore deve impedire path traversal fuori dalla directory temporanea. Un
archivio invalido deve generare una nota di errore senza danneggiare la versione
già installata.

### 3. Risultati e stato di reload

Il fallback deve distinguere per ogni directory:

- companion già aggiornato: nessuna reinstallazione;
- installazione nuova;
- aggiornamento o reinstallazione forzata;
- errore.

I risultati positivi su più directory vengono aggregati in un solo riepilogo VS
Code; gli errori devono restare visibili e identificare la destinazione
interessata senza esporre dati sensibili. Il segnale di reload viene scritto
solo quando almeno una copia già installata è stata aggiornata, mantenendo la
semantica attuale.

### 4. Disinstallazione simmetrica

Il fallback di `/piw uninstall` deve usare la stessa lista di directory e
rimuovere tutte le copie di `magiusche.pi-webview-ide-*` trovate. Il messaggio
“not installed” deve comparire soltanto se nessuna directory contiene il
companion.

La disinstallazione tramite CLI `code` resta invariata quando il CLI è
risolvibile.

## Modifiche previste

- `src/bridge/companions.ts`
  - discovery delle directory desktop/server;
  - estrazione e validazione del payload VSIX;
  - installazione diretta su una o più destinazioni;
  - disinstallazione diretta simmetrica;
  - aggiornamento dei commenti che oggi dichiarano erroneamente il supporto ZIP
    di `tar` su Linux.
- `packages/pi-webview/extension.ts`
  - uso dell’helper condiviso per la disinstallazione senza CLI.
- `package.json` e `pnpm-lock.yaml`
  - dipendenza ZIP usata dal codice runtime e inclusa nei bundle.
- `tests/code-cli.test.ts` oppure un nuovo test dedicato
  - discovery e flusso completo di installazione/disinstallazione diretta.
- `CHANGELOG.md`
  - nota in inglese nella sezione Unreleased.
- `packages/pi-webview/README.md`
  - precisazione sintetica del supporto al fallback su VS Code Server/Remote
    SSH, senza duplicare documentazione nel README root.

## Test automatici

Aggiungere casi che lavorino esclusivamente in directory temporanee:

1. solo `~/.vscode-server/extensions` presente: viene rilevata come
   destinazione;
2. directory desktop e server entrambe presenti: vengono entrambe controllate;
3. nessuna directory riconosciuta: skip silenzioso;
4. estrazione del VSIX reale incluso nel package: `package.json` risulta alla
   radice della cartella installata e i metadati dell’archivio non vengono
   copiati;
5. companion già alla stessa versione: nessuna modifica;
6. aggiornamento da una versione precedente: sostituzione riuscita e segnale di
   reload;
7. archivio invalido o payload senza `extension/package.json`: errore e copia
   precedente intatta;
8. reinstallazione forzata della stessa versione;
9. disinstallazione senza CLI da tutte le directory rilevate;
10. directory non leggibile o errore su una destinazione: le altre destinazioni
    continuano a essere processate e l’errore viene riportato.

Gli helper devono accettare directory esplicite nei test, così la suite non può
leggere o modificare la vera home dell’utente.

## Verifica finale

Eseguire:

```bash
pnpm test
pnpm typecheck
pnpm format:check
```

Non compilare o reinstallare automaticamente gli artefatti locali durante il
fix ordinario. La build completa dei companion resta demandata a una successiva
richiesta esplicita di aggiornamento artefatti o alla procedura di release.

## Comunicazione dopo la release

Quando il piano è stato implementato integralmente e la versione 0.4.0 è stata
pubblicata:

1. aggiungere alla issue GitHub #1 un commento che confermi la pubblicazione del
   fix e indichi chiaramente la release 0.4.0, includendo il relativo link;
2. invitare esplicitamente l’utente che ha aperto la issue a provare la nuova
   versione e a scrivere nella issue se riscontra anomalie o se il problema
   persiste;
3. chiudere la issue solo dopo aver pubblicato il commento, così il riferimento
   alla versione corretta e la richiesta di feedback restano visibili nel
   thread.

Questa comunicazione è parte del completamento del piano: il solo merge del
codice, senza release pubblicata e aggiornamento della issue, non porta il piano
allo stato **IMPLEMENTATO**.

## Criteri di accettazione

- Su un host Remote SSH senza CLI `code`, ma con
  `~/.vscode-server/extensions`, il companion viene installato o aggiornato.
- Il fallback non invoca più `tar` né altre utility ZIP esterne.
- La directory finale contiene `package.json` alla radice ed è riconosciuta da
  VS Code Server.
- Un errore di estrazione non rimuove la versione precedentemente installata.
- Installazione e disinstallazione usano le stesse directory rilevate.
- Tutti i test, il typecheck e il controllo di formattazione passano.
