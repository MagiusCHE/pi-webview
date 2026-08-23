# Piano 0001 — Fase standalone: bridge Node (stdio↔WS) + UI in browser

> Stato: **IMPLEMENTATO e verificato** (2026-08-20) — vedi i mark ✅ negli step.
> Riferimenti: concept 0001, concept 0002 (D1, D2, D5, D6).
> Dipendenze: nessuna (usa `pi --mode rpc` così com'è, pi v0.84.2).
> Piattaforme: sviluppo su Linux; portabilità macOS/Windows già rispettata
> nel codice (D6).

## Obiettivo

Dev loop **senza VS Code**: un bridge Node spawna `pi --mode rpc` e lo espone
su WebSocket locale; una web app (UI) nel browser streama le risposte di pi.
Tutto ciò che nasce qui viene riusato dall'adapter VS Code (piano 0002).

## Struttura target

```
src/                 # sorgente (committata)
  ide/               # IDE bridge protocol — tipi condivisi UI↔host
  bridge/            # bridge Node standalone
  web/               # UI web (framework-agnostic)
tests/
  unit/              # test unitari (node --test)
tools/               # script di sviluppo (check-package-manager.mjs, ...)
dist/                # output build (gitignored), specchia src/
docs/
  concept/           # decisioni architetturali
  plans/             # piani di implementazione (questo file)
```

## Script pnpm (da creare in questo piano)

| Script              | Comando                                 | Cosa fa               |
| ------------------- | --------------------------------------- | --------------------- |
| `pnpm dev`          | bridge + web in parallelo               | avvio dev completo    |
| `pnpm dev:bridge`   | `node --watch src/bridge` con `DEBUG=1` | bridge con log JSONL  |
| `pnpm dev:web`      | dev server (HMR) per la UI              | UI in browser         |
| `pnpm build`        | build web → `dist/web`                  | output produzione     |
| `pnpm start`        | build + avvio bridge+web                | uso standalone "vero" |
| `pnpm test`         | `node --test tests/`                    | test unitari          |
| `pnpm test:watch`   | `node --test --watch tests/`            | test in watch         |
| `pnpm format`       | prettier `--write`                      | formatta tutto        |
| `pnpm format:check` | prettier `--check`                      | verifica format       |
| `pnpm typecheck`    | `tsc --noEmit`                          | typecheck             |

## Step

1. **Tooling**: prettier + tsconfig + script pnpm + `tests/` con smoke test.
   ✅ fatto — 12 test unitari, `pnpm format/typecheck/test` verdi.
2. **Bridge** (`src/bridge/`):
   ✅ fatto — `spawn pi --mode rpc`, framing JSONL, WS su 127.0.0.1 + token,
   lifecycle (restart con backoff, kill, backpressure), `--debug`, `--mock-ide`,
   `--serve`/`--open`/`--port`, risoluzione `pi` cross-platform.
3. **Smoke test protocollo**: ✅ fatto — `pnpm smoke` verde (get_state,
   get_commands, get_messages) con pi reale; test E2E streaming prompt OK
   (text_delta → message_end → agent_settled).
4. **UI web minima** (`src/web/`): ✅ fatto — WS, stream testo, thinking e
   tool call collassabili, input (Invio/Shift+Invio), abort, attach (mock),
   pannello connessione manuale, trasporto astratto (WS o postMessage).
5. **IDE bridge protocol v0** (`src/ide/`): ✅ fatto — `protocol.ts` (Frame,
   rpc helpers, IdeRequest/Response/Event), `events.ts` (mapping RPC → UI),
   `transport.ts` (WS + VS Code).
6. **Test unitari**: ✅ fatto — framing JSONL, mapping eventi, spawn.
7. **Criteri di accettazione**: per lo più verificati headlessly; resta la
   verifica visiva di `pnpm dev` nel browser.

## Criteri di accettazione

- [ ] `pnpm dev` apre il browser con la UI funzionante, nessuna dipendenza da VS Code
- [ ] lo streaming di pi è visibile (text_delta → render)
- [ ] invio prompt e abort funzionano
- [ ] `--mock-ide` simula attachSelection senza IDE
- [ ] `pnpm test`, `pnpm format:check`, `pnpm typecheck` verdi
- [ ] bridge logga i frame JSONL con `DEBUG=1`
- [ ] (portabilità) nessun path o comando hard-coded unix: solo
      `os.tmpdir()`/`path.join` e risoluzione `pi` cross-platform
