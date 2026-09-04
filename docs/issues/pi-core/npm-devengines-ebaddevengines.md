# npm 12 devEngines blocca `pi update` (e `npm view`) in cwd gestiti da pnpm

- **Componente**: pi-core (`core/package-manager.js` — `getLatestNpmVersion`/`runCommandCapture`) + npm 12 (`devEngines`)
- **Scoperto**: 2026-09-04 (feature update pi core nel webview)
- **Stato**: aperto — da proporre upstream a @earendil-works

## Problema

npm 12 valida i campi `devEngines`/`packageManager` del `package.json` del
progetto corrente e, se il package manager dichiarato non è npm (es. un repo
gestito da pnpm con `packageManager: pnpm@…`), rifiuta **ogni** comando npm
con `EBADDEVENGINES` — anche `npm view <pkg> version`, che non installa
niente:

```
npm error EBADDEVENGINES Invalid name "pnpm" does not match "npm" for "packageManager"
```

Conseguenze in pi:

- `pi update` / `pi update --self` eseguiti con cwd = un progetto gestito da
  pnpm falliscono: `Error: Could not determine latest pi version: The
operation was aborted due to timeout` (il lookup npm di pi
  `DefaultPackageManager.getLatestNpmVersion` eredita la cwd della sessione);
- lo stesso vale per qualsiasi lookup versione che pi fa in quella cwd.

Dalla home (o da qualsiasi cwd senza `package.json`) `pi update --self`
funziona normalmente: `pi is already up to date (v0.85.0)`.

Verificato su pi 0.85.0 + npm 12.0.2, cwd = repo pi-webview (pnpm).

## Impatto

- `pi update` è inaffidabile quando la sessione è aperta in un progetto
  pnpm/corepack (caso comune in sviluppo).
- Ogni tooling che fa lookup versione npm ereditando la cwd della sessione
  (incluso il check di obsolescenza di pi-webview) si blocca nello stesso
  modo.

## Mitigazione lato pi-webview

- il check di obsolescenza (`packages/pi-webview/lib/update-check.ts`) esegue
  `npm view` con **cwd neutro** (`os.tmpdir()`): il `~/.npmrc` (registry
  custom, proxy) resta rispettato, il `package.json` locale no;
- `/piw update.pi.core.exts` rileva la firma dell'errore
  (`EBADDEVENGINES` / `Could not determine latest pi version`) e ripete
  l'update **una** volta da cwd neutra.

## Fix upstream auspicato

pi dovrebbe eseguire i lookup npm con cwd neutra (o disabilitare la
validazione devEngines per i soli `npm view`), così `pi update` funziona da
qualsiasi progetto.
