# RPC per svuotare la coda steering

- **Componente**: pi-core (`modes/rpc/rpc-mode.js` + `core/agent-session.js`)
- **Scoperto**: 2026-08-22/24 (piano 0004 — message steering)
- **Stato**: risolto upstream; verificato in pi `0.85.1`

## Soluzione upstream

La modalità RPC espone `clear_queue`. Il comando svuota in modo atomico le
code native e restituisce separatamente, nell'ordine mantenuto da pi:

```json
{
  "steering": ["Change direction"],
  "followUp": ["Summarize when finished"]
}
```

Pi emette inoltre `queue_update` con lo snapshot completo ogni volta che una
delle due code cambia.

## Integrazione pi-webview

Pi-webview non mantiene più code ombra, persistenza, attese di consegna o
riconciliazione proprie:

- invia subito il messaggio a pi tramite `prompt` con
  `streamingBehavior: "steer"` oppure `steer` durante la compaction;
- mostra il pannello usando esclusivamente `queue_update`;
- usa `clear_queue` per riportare nell'editor i messaggi accodati;
- invia `clear_queue` prima di `abort`, come indicato dal contratto RPC.

La selezione o rimozione di un singolo elemento non è esposta, ma non è
necessaria per il comportamento corrente.
