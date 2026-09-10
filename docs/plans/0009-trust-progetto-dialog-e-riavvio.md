# Piano 0009 — Project trust: stato effettivo, dialog TUI e riavvio

> Stato: **IMPLEMENTATO**
> Riferimenti: `docs/issues/pi-core/*` (comportamento di pi verificato su
> 0.85.1), `src/bridge/trust.ts`, `src/ide/protocol.ts`,
> `src/adapters/visualstudio/src/PiWebview.Vs.Core/Platform/TrustRuntime.cs`.

## Contesto verificato su pi 0.85.1

- Il prompt di trust compare **solo** in modalità TUI interattiva e solo se il
  workspace (o un antenato) contiene risorse protette: `.pi/settings.json`,
  `.pi/{extensions,skills,prompts,themes}`, `.pi/SYSTEM.md`,
  `.pi/APPEND_SYSTEM.md`, `.agents/skills`.
- Il prompt ha cinque scelte (`getProjectTrustOptions` in pi core):
  `Trust`, `Trust parent folder (<path>)`, `Trust (this session only)`,
  `Do not trust`, `Do not trust (this session only)`. `Trust`,
  `Trust parent folder` e `Do not trust` persistono in `trust.json`; le due
  opzioni `session only` non salvano nulla.
- In `--mode rpc` (la modalità di pi-webview) `hasUI` è falso: **nessun
  prompt**. Senza decisione salvata e con `defaultProjectTrust: "ask"` le
  risorse protette del progetto vengono ignorate per quella esecuzione.
  `ask` quindi non è un terzo livello operativo, ma assenza di decisione.
- Le risorse caricate dipendono dall'avvio del processo: una decisione nuova
  ha effetto solo dal riavvio successivo di pi.

## Obiettivo

Allineare il chip di trust della webview a questo comportamento, togliendo lo
stato `ask` dalla UI e sostituendo il popover con il dialog completo del prompt
di pi, gestendo esplicitamente il riavvio necessario.

## Decisioni

1. **Niente `ask` nella UI.** `TrustStatus` è `trusted | untrusted`. Lo stato
   mostrato è quello del **processo pi in esecuzione** (decisione salvata →
   `defaultProjectTrust` `always`/`never` → altrimenti `untrusted`).
   L'icona segue il valore: scudo verde per attendibile, warning giallo per
   non attendibile.
2. **Dialog al posto del popover.** Il click sul chip apre un dialog con le
   stesse cinque opzioni del prompt TUI, nell'ordine di pi core. La lista
   arriva dall'host (`TrustResult.options`), quindi resta una sola fonte di
   verità; le etichette sono localizzate dalla webview e includono il path
   della cartella superiore per `trust-parent`.
3. **Opzioni `*-session` fedeli a pi.** Non persistono nulla: armano i flag
   per-run `--approve` / `--no-approve`, consumati dal solo avvio successivo
   (un riavvio ulteriore termina la scelta "solo questa sessione", come in pi).
4. **Applicazione tramite riavvio.** `TrustRuntime.apply()` scrive la
   decisione (o arma l'override) e riporta `pendingRestart`; lo `status()`
   continua a descrivere il processo in esecuzione. Se la sessione non sta
   lavorando il riavvio è automatico, altrimenti un dialog chiede
   "Riavvia ora / Riavvia più tardi". Con "più tardi" il chip mantiene lo
   stato precedente con un `!` rosso accanto all'icona finché non avviene un
   riavvio (che ricarica le risorse e azzera il marker).
5. **Stato per processo, mai nella sessione.** `TrustRuntime` vive nell'host
   (bridge standalone, companion VS Code, companion Visual Studio) con mirror
   C#; il JSONL di sessione non contiene nulla del trust.

## Superficie tecnica

- `src/bridge/trust.ts`: `getTrust`, `trustOptions`, `applyTrustOption`,
  `trustOverrideArgs`, `TrustRuntime`.
- `src/ide/protocol.ts`: `TrustStatus`, `TrustOptionId`, `TrustOption`,
  `TrustResult` (con `parentPath`, `pendingRestart`, `sessionOnly`,
  `options`), richiesta `applyTrustOption` (sostituisce `setTrust`).
- `src/web/`: dialog trust, dialog di riavvio, badge `!`, i18n it/en.
- Bridge/`host.ts` VS Code: `TrustRuntime` per processo, argomenti di lancio,
  gate delle impostazioni di progetto sullo stato applicato.
- Visual Studio: `TrustStore` + `TrustRuntime` C# con la stessa semantica.
