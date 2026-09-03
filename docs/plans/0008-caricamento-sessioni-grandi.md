# Piano 0008 — Caricamento efficiente delle sessioni grandi

> Stato: **PIANIFICATO** — non ancora implementato.
> Ambito: letture e rendering eseguiti da pi-webview; il comportamento interno
> del core di pi è fuori scope.

## Problema

VS Code e lo standalone `piw` condividono `src/bridge/sessions.ts`. Al primo
caricamento, e ogni volta che cambia l'`mtime`, `listSessions()` legge e analizza
l'intero JSONL di ogni sessione interessata per ricavare titolo, conteggi,
ultima attività, compaction e modello del branch attivo.

La webview attende questa scansione prima di caricare la cronologia. Il limite
`History (messages)` viene applicato soltanto dopo la risposta RPC e limita il
rendering DOM, non le letture dei metadati.

## Obiettivi

- Evitare che l'elenco sessioni blocchi la visualizzazione della chat.
- Non rileggere dall'inizio un JSONL cresciuto soltanto per append.
- Conservare la correttezza con branch, compaction, rename e modello salvato.
- Mantenere identico il comportamento tra companion VS Code e `piw`.
- Non modificare il formato delle sessioni gestito dal core di pi.

## Piano

1. Separare il caricamento della cronologia dal popolamento del menu sessioni:
   mostrare la chat appena disponibile e aggiornare il menu in modo asincrono.
2. Sostituire la cache basata sul solo `mtime` con un indice incrementale per
   file contenente almeno dimensione, offset letto, metadati aggregati e dati
   necessari a risolvere il branch attivo.
3. Se il file è cresciuto per append, leggere e analizzare soltanto i byte dopo
   l'ultimo offset; ricostruire tutto solo in caso di troncamento, riscrittura,
   migrazione o incoerenza rilevata.
4. Leggere separatamente l'header iniziale con una lettura limitata.
5. Ottimizzare la ricerca di una sessione per ID usando prima nomi file e
   directory, evitando `listSessions()` globale quando possibile.
6. Leggere a ritroso gli ultimi custom entry di pi-webview (flag CLI e settings)
   senza analizzare l'intero file.
7. Valutare una cache persistente opzionale soltanto dopo aver misurato la cache
   incrementale in memoria; ogni dato persistito deve essere invalidabile in
   modo affidabile.

## Correttezza e fallback

- Una semplice lettura delle ultime X righe non è sufficiente: X indica
  messaggi visuali, non record fisici, e i `parentId` possono puntare molto
  indietro nel file.
- Qualunque dubbio sull'integrità dell'indice deve causare una scansione
  completa, mai metadati silenziosamente errati.
- Le sessioni non attive e immutate devono continuare a essere servite dalla
  cache senza I/O sul contenuto.

## Verifica

- Test con append incrementale, truncate/rewrite, branch abbandonati, compaction,
  rename e custom entry multiple.
- Benchmark a cache fredda e calda su sessioni di dimensioni crescenti.
- Misurazione separata di scansione metadati, payload RPC e rendering DOM.
- Verifica manuale sia nel companion VS Code sia nello standalone browser.
