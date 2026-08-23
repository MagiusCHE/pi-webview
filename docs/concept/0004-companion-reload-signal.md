# 0004 — Companion reload signal (multi-IDE)

- **Stato**: implementato (0.1.7)
- **Ambito**: estensione pi → companion IDE

## Problema

Quando il pacchetto pi-webview viene aggiornato (`pi update --extensions`) mentre
l'IDE è **già aperto**, il companion installato viene aggiornato su disco
(`code --install-extension --force`) ma la **finestra resta sulla versione
vecchia caricata in memoria**: la versione vista in VS Code è quella giusta solo
al riavvio. L'utente non ha alcun segnale che la finestra va ricaricata.

## Contratto: `~/.pi/pi-webview/companion-reload.json`

L'estensione pi (lato pi) scrive un segnale quando il companion è stato
**aggiornato** (versione installata precedente ≠ versione del vsix incluso —
mai per installazioni fresche):

```json
{ "version": "0.1.7" }
```

- **Chi scrive**: l'estensione pi all'avvio (`packages/pi-webview/extension.ts`)
  e `piw` all'avvio (`src/bridge/companion.ts`) — entrambi dopo un update.
  Se il companion è già alla versione giusta, il segnale viene **cancellato**
  (nessun segnale stale).
- **Chi legge**: il companion dell'IDE, all'attivazione **e** con un watcher
  sulla directory (per l'update mentre l'IDE è aperto).
- **Semantica del confronto** (versione caricata dall'IDE vs `version` del
  segnale):
  - **uguali** → la finestra è già sulla nuova versione (IDE riavviato dopo
    l'update): rimuovi il segnale, **nessuna notifica**;
  - **diverse** → la finestra ha la versione vecchia: notifica di reload e
    rimozione del segnale (una sola notifica, niente duplicati).

## Implementazione per un nuovo IDE

Il companion deve:

1. all'attivazione: `checkReloadSignal()` (legge il file, confronta, notifica,
   rimuove il file);
2. watcher sulla dir `~/.pi/pi-webview` filtrando sul nome
   `companion-reload.json` → stesso check;
3. notifica con il comando di reload dell'IDE (VS Code:
   `showInformationMessage` + `workbench.action.reloadWindow`).

Il formato del file e la semantica del confronto sono il contratto: l'IDE non
ha bisogno di sapere come è stato installato l'aggiornamento.

## Note

- La directory `~/.pi/pi-webview/` è propria di pi-webview (già usata per
  `bridge.json`): nessuna collisione con pi-x-ide.
- Il segnale è scritto **solo per update**, mai per la prima installazione
  (la webview non è ancora attiva, il reload non serve).
- I messaggi dell'estensione pi e di `piw` sono separati dal segnale: la
  notifica IDE è l'azione, i messaggi console/pi sono informativi.
