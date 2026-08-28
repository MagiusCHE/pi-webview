# .vscode-example — VS Code workspace settings template

Template for the VS Code workspace configuration. `.vscode/` is gitignored;
use it by **copying and renaming** this folder to `.vscode/` when you need
it (nothing in the repo applies it automatically):

    cp -r .vscode-example .vscode

## Why `settings.json` matters (Linux + wine)

Building the Visual Studio companion on Linux (`node tools/setup-vs-wine.mjs`)
creates a project-local wine prefix at `src/adapters/visualstudio/.wine/`.
Every wine prefix contains a `dosdevices/z:` symlink pointing to the unix
root (`/`) — wine uses it to map the process working directory for the
Windows build tools (VSCT, CreatePkgDef, vsixutil).

If VS Code search follows symlinks (`search.followSymlinks`), its ripgrep
scans follow `z:` out of the workspace and index the **entire filesystem**
(four `rg` processes at 100% CPU on all cores — they search for
`package.json`/`tsconfig`/`*.csproj` that will never exist in `/usr`,
`/etc`, `/proc`, …).

The `settings.json` here:

- disables symlink follow (`search.followSymlinks: false`), and
- excludes `**/.wine/**` from search, the file explorer and the file
  watcher (`search.exclude`, `files.exclude`, `files.watcherExclude`).

Every scan then stays inside the workspace. On Windows there is no wine
prefix: the settings are unnecessary but harmless.

The other files (`launch.json`, `tasks.json`) are the standard development
configs (F5 Extension Development Host + `pnpm compile` task).
