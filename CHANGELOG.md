# Changelog

Le note di rilascio di pi-webview sono mantenute in italiano e in inglese. Durante la preparazione di una release, la sezione `Unreleased` diventa automaticamente la sezione della nuova versione.

pi-webview release notes are maintained in Italian and English. When a release is prepared, the `Unreleased` section automatically becomes the new version section.

## [Unreleased]

## [0.4.0] - 2026-09-15

### Italiano

- Aggiunto il companion ufficiale Google Chrome Side Panel con contesto pagina, selezione e handoff dalla Browser View.
- Aggiunti i tool browser per acquisire DOM e screenshot con consenso esplicito per origine e sessione del pannello.
- Migliorate persistenza, ripresa e gestione delle sessioni vuote nel companion Chrome.
- Separato l’endpoint Chrome configurato dagli intenti interni di sessione e migliorato il flusso di errore delle impostazioni.
- Migliorata la visibilità dei risultati finali dei tool e corretta la coda degli steering contenenti soltanto immagini.
- Aggiunto il reminder versionato delle modalità disponibili, seguito dalle note della nuova versione.

### English

- Added the official Google Chrome Side Panel companion with page context, selection and handoff from Browser View.
- Added browser tools for DOM and screenshot capture with explicit consent per origin and panel session.
- Improved persistence, resume and empty-session handling in the Chrome companion.
- Separated the configured Chrome endpoint from internal session intents and improved the settings error flow.
- Improved the visibility of final tool results and fixed queued image-only steering messages.
- Added the versioned available-modes reminder followed by the new version’s release notes.

## [0.3.2] - 2026-09-14

### Italiano

- Migliorata la promozione degli output finali dei tool, inclusi immagini, file, JSON e codice.
- Migliorato il recupero da sessioni non valide senza modificare il file originale.
- Rafforzati il controllo aggiornamenti e l’inoltro sicuro dei comandi delle estensioni.

### English

- Improved promotion of final tool outputs, including images, files, JSON and code.
- Improved recovery from invalid sessions without modifying the original file.
- Strengthened update checks and safe forwarding of extension commands.
