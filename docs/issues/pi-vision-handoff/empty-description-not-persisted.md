# Immagini non persistite: descrizione vuota dal modello vision → ricalcolo al resume

- **Componente**: pi-vision-handoff (`vision-handoff.ts`, `src/dataloader.ts`)
- **Scoperto**: 2026-08-24 (sessione pi-webview, verifica handoff vision)
- **Stato**: aperto — da investigare, non trattato per ora

## Problema

Le immagini allegate a una sessione vengono ricalcolate (nuova chiamata vision)
a ogni resume quando **non hanno un blocco persistito** (`[Image described: <hash>]`).
Caso osservato: 2 screenshot lette alle 20:17–20:18 non hanno prodotto il blocco
persistito perché il modello vision ha restituito una **descrizione vuota**.

## Evidenze

Log errore dell'estensione (`~/.pi/agent/logs/pi-vision-handoff/errors.log`):

```json
{
  "timestamp": "2026-08-23T20:18:29.186Z",
  "phase": "batch",
  "reason": "vision model returned an empty description",
  "visionModel": "deepseek/deepseek-v4-flash-vision-exp",
  "imageHashes": ["37e797d3c476e4dee36a9208f638fd8a"],
  "imageCount": 1,
  "config": { "thinking": false, "thinkingLevel": "medium" }
}
```

Nella sessione, i blocchi persistiti ci sono SOLO per immagini con descrizione
valida (es. `[Image described: 3aea9c63…]` a 18:54, `[Image described: 4c88bb91…]`
a 20:09); l'immagine con descrizione vuota (hash `37e797d3…`) non ha marker.

## Cause / fattori

1. **Modello vision** (`deepseek/deepseek-v4-flash-vision-exp`) può restituire
   descrizione vuota → niente da persistere (UNAVAILABLE non viene persistito
   come descrizione utile).
2. **Cache in-memory** (LRU per hash): si azzera al riavvio di pi → al resume
   le immagini senza blocco persistito vengono ricalcolate.
3. `prewarmPastedImages: false`: i path incollati (`[attachment: …]`) non vengono
   pre-descritti; la descrizione parte solo quando l'agente legge l'immagine.

## Da capire (futuro)

- Retry/fallback alla descrizione vuota (config `fallbackModels: []` attualmente
  vuota).
- Persistenza anche del fallimento (UNAVAILABLE) per evitare ricalcoli ripetuti
  di immagini già note come non descrivibili.
- Comportamento del resume quando il messaggio utente contiene solo
  `[attachment: path]` e l'agente non rilegge l'immagine.
