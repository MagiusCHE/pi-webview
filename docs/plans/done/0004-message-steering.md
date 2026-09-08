# Piano 0004 — Message steering

**Stato:** implementato; architettura riallineata alla coda nativa di pi in
seguito all'introduzione di `clear_queue`.

## Obiettivo

Permettere di inviare nuove istruzioni mentre il modello sta lavorando,
lasciando a pi.dev la responsabilità esclusiva di accodamento, ordine,
modalità di consegna e continuazione dei turni.

## Architettura finale

Pi-webview è un client RPC sottile:

1. durante lo streaming invia immediatamente `prompt` con
   `streamingBehavior: "steer"`;
2. durante la compaction invia immediatamente `steer`, senza una coda locale;
3. visualizza le code `steering` e `followUp` usando esclusivamente gli eventi
   `queue_update` emessi da pi;
4. applica `steeringMode` e `followUpMode` soltanto tramite le rispettive RPC:
   l'interpretazione delle modalità resta nel core;
5. per il dequeue invia `clear_queue` e riporta nell'editor i testi restituiti;
6. per STOP invia `clear_queue` prima di `abort`, senza ritardare l'abort con
   attese client-side;
7. rende i messaggi utente dal `message_start` autoritativo, evitando bubble
   duplicate e preservando input multimodali.

Non esistono più `steerShadow`, `steerPending`, persistenza per workspace,
retry, riconciliazione o consegna differita basati su `turn_end` /
`agent_settled`. Restano soltanto i buffer tecnici JSONL necessari al
trasporto e alla backpressure.

## Comportamento UI

- Invio durante l'elaborazione consegna subito lo steering a pi.
- Il pannello tra thread e composer replica lo snapshot di `queue_update`,
  incluse eventuali stringhe identiche ripetute.
- “Riporta nell'editor” usa `clear_queue` e preserva l'ordine restituito prima
  della bozza già presente.
- Le immagini compatibili sono inoltrate come contenuto multimodale; gli altri
  allegati restano riferimenti testuali `[attachment: path]`.
- I comandi built-in intercettati dal client non entrano mai nello steering.

## File principali

- `src/web/main.ts` — invio immediato, rendering `queue_update`, dequeue e STOP.
- `src/ide/protocol.ts` — RPC `steer`, `follow_up`, `clear_queue`.
- `src/ide/events.ts` — inoltro degli eventi nativi, incluso `queue_update`.
- `src/bridge/pi-process.ts` e adapter IDE — solo trasporto JSONL, nessuna coda
  semantica.
