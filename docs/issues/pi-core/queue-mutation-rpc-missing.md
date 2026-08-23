# Nessuna RPC per mutare la coda stearing (clearQueue/remove)

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/agent-session.js`)
- **Scoperto**: 2026-08-22/24 (piano 0004 — message steering)
- **Stato**: aperto — da proporre upstream a @earendil-works

## Problema

Pi mantiene due code di messaggi in attesa: `steeringQueue` e
`followUpQueue` (pi-agent-core, `PendingMessageQueue`). La sessione espone:

- `steer()` / `followUp()` / `prompt(streamingBehavior)` per ACCODARE;
- `clearQueue()` per SVUOTARE tutto (usato dal TUI per il dequeue Alt+↑/Esc);
- `pendingMessageCount`, evento `queue_update`.

Ma in **RPC mode non esiste alcun comando** per mutare la coda: né
`clear_queue`, né `remove_queue_item`. `clearQueue()` è chiamato solo dal TUI
(`interactive-mode.js` `clearAllQueues`). Non è esposto nemmeno nell'API
estensioni (verificato in `extensions/types.d.ts`).

## Impatto

- Impossibile eliminare/modificare un **singolo** messaggio accodato;
- Impossibile svuotare la coda nativa da un client RPC (webview) senza
  riavviare pi.

## Come lo abbiamo aggirato (piano 0004)

La webview tiene una **coda "ombra"** locale (testo persistito) e consegna i
messaggi a pi nei punti giusti (`turn_end` → `prompt(streamingBehavior:
"steer")`, `agent_settled` → `prompt` normale). Il dequeue (riporta nell'
editor) opera sulla coda ombra. Gli item già consegnati a pi (coda nativa)
non sono recuperabili — limite documentato nel piano.

## Fix suggerito (upstream)

RPC `clear_queue` e/o `remove_queue_item { index | text }` (oppure esporre
`clearQueue`/`getSteeringMessages` nell'API estensioni e in un comando RPC).
Con questo la webview potrebbe usare la coda nativa direttamente e fare
edit/elimina anche sugli item in coda a pi.
