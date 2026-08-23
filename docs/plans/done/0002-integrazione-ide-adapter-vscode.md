# Piano 0002 — Integrazione IDE: adapter VS Code (primo di tanti)

> Stato: **IMPLEMENTATO** (2026-08-20) — vedi `docs/plans/done/0002-…`.
> Nota di implementazione: il modello di distribuzione è cambiato rispetto alla
> bozza — niente extension sul marketplace. Il deliverable è un **package pi**
> (`packages/pi-webview/`, installabile con `pi install`) che contiene:
>
> 1. un'estensione pi-webview (`extension.ts`) che all'avvio **rileva l'IDE** dalle
>    env (VSCODE_PID/TERM_PROGRAM) e **auto-installa il companion VS Code**
>    (`code --install-extension` sul vsix incluso nel package) — stesso modello
>    di pi-x-ide;
> 2. il **companion VS Code** (adapter in `src/adapters/vscode/`, vsix generato
>    da `pnpm package:ide`): crea la webview della sidebar, spawna
>    `pi --mode rpc` (env `PI_WEBVIEW_COMPANION=1` per evitare il re-install),
>    parla l'IDE bridge protocol via postMessage e riusa i moduli bridge
>    (config/sessioni/trust/allegati); la selezione editor viene inviata
>    direttamente alla webview (niente WS/lock file: il webview è in-process).
>    Script: `pnpm compile` (web+adapter per F5), `pnpm package:ide` (vsix),
>    `pnpm package:addon` (assembly del package pi).
>    Riferimenti: concept 0002 (D1–D6), piano 0001 (base riusata).
>    Dipendenze: la UI e il bridge protocol del piano 0001.
>    Piattaforme: sviluppo su Linux; **deploy cross-platform** (D6) — VS Code
>    gira sui 3 sistemi; spawn/path come nel bridge (piano 0001).

## Obiettivo

Adapter VS Code che ospita **la stessa UI** (`src/web`) in una webview,
con `pi --mode rpc` spawnato dall'extension host e selezione editor iniettata
(riuso del pattern WebSocket server + lock file di Pi x IDE).
Il deploy VS Code è il primo dei tanti: il contratto (IDE bridge protocol)
resta lo stesso per i futuri adapter.

## Struttura target

```
src/
  ide/                 # IDE bridge protocol (dal piano 0001, invariato)
  web/                 # UI (dal piano 0001, invariata)
  adapters/
    vscode/
      extension.ts     # attivazione, comandi, status bar
      webview.ts       # WebviewViewProvider, CSP, localResourceRoots
      bridge.ts        # postMessage ↔ stdio pi (stessi messaggi del bridge)
      selection.ts     # WS server + lock file (pattern Pi x IDE)
tests/                 # riuso test piano 0001 + nuovi per l'adapter
dist/
  web/                 # build UI
  extension/           # build extension host
.vscode/
  launch.json          # F5 → Extension Development Host
  tasks.json
```

## Script pnpm (da aggiungere a quelli del piano 0001)

| Script         | Cosa fa                            |
| -------------- | ---------------------------------- |
| `pnpm compile` | build extension → `dist/extension` |
| `pnpm lint`    | eslint su `src/`                   |
| `pnpm package` | `vsce package` → `.vsix`           |

(riusati dal piano 0001: `dev`, `test`, `format`, `typecheck`)

## Step

1. **Manifest**: campi extension in `package.json` (`engines.vscode`,
   `activationEvents`, `contributes`: comando + view container sidebar).
2. **Debug setup**: `launch.json` (Extension Development Host) + `tasks.json`;
   script `pnpm compile` collegato al preLaunchTask.
3. **Webview**: `WebviewViewProvider` per la sidebar (decisione D: sidebar di
   default, riapribile da comando), `enableScripts`, CSP stretta,
   `localResourceRoots` → `dist/web`.
4. **Adapter bridge**: stesso contratto del bridge standalone ma via
   `postMessage`; spawn `pi --mode rpc` e lifecycle identico al piano 0001
   (inclusa la risoluzione cross-platform del binario `pi` e il check bash
   su Windows, D6).
5. **Selezione editor**: WS server + lock file (pattern Pi x IDE),
   `attachSelection` da status bar e comando; riuso del protocollo
   `selection_changed` / `at_mentioned`.
6. **Extension UI Protocol**: mappatura nella webview —
   `select/confirm/input/editor` → `showQuickPick`/`showInputBox`/message;
   `notify` → messaggi; `setStatus`/`setWidget`/`setTitle`/`set_editor_text`
   → slot lazy già previsti nella UI.
   _(Lazy `setFooter`/`setHeader`/`setWorkingMessage`/`setEditorComponent`:
   richiedono la patch al core di pi — fuori scope, vedi concept 0002 D4.)_
7. **Debug**: F5 + "Developer: Open Webview Developer Tools"; canale Output
   dedicato per i log dell'extension host.
8. **Packaging**: `.vscodeignore`, `vsce package`, verifica installazione
   del `.vsix`.

## Criteri di accettazione

- [ ] F5 avvia l'Extension Development Host con la webview funzionante
- [ ] la UI è la stessa del browser (piano 0001), chat con pi reale
- [ ] attach selection dall'editor funziona (status bar + scorciatoia)
- [ ] `pnpm compile`, `pnpm lint`, `pnpm test` verdi
- [ ] `pnpm package` produce un `.vsix` installabile

## Futuri adapter (non pianificati ora)

- **JetBrains / Neovim**: "apri il browser sul bridge" (piano 0001) —
  quasi zero codice UI; si inietta la selezione via WS.
- La UI non cambia: cambia solo l'adapter che implementa l'IDE bridge protocol.
