# Decision 0006 — Recover session metadata without replaying mutations

Status: accepted, 2026-11-10.

## Failure modes

A VS Code postMessage transport is open before Pi's RPC reader is ready. The
initial `get_state` retry window is finite; the loading safety timer used to
unlock an incomplete composer after 30 seconds. A Pi process finishing startup
after those deadlines could leave model, session and context metadata empty.
Extension `setStatus` calls can also precede the webview listener. Retrying
`get_state` alone does not reproduce those events.

A second concrete Windows defect was in the VS Code caller: `resolvePi()`
returned the absolute shim path, but `new PiProcess(piCmd.command)` discarded
it and passed bare `pi.cmd`. `resolveDirectNode` could not read that file from
an arbitrary workspace, fell back to `cmd /c`, and bypassed the direct managed
CLI invocation. This can break RPC stdin and also makes the host PID address
the launcher, not the real process writing startup-info. Pass
`piCmd.path ?? piCmd.command`, matching the standalone bridge.

`new_session` previously used the default 10-second deadline, swallowed errors,
ignored extension cancellation, and reported history as loaded even when its
refresh failed. A timeout is an unknown mutation outcome, not proof of failure.

## Decision

- The shared UI runs a read-only recovery loop every 5 seconds while visible,
  after initial hydration completes or times out. Attempts are single-flight.
  Restart/disconnect/session transitions invalidate outstanding results.
- Recovery reads state, context statistics and host presentation snapshots.
  Initial history is retried only when still missing/failed and Pi is idle;
  metadata refresh never rebuilds a live assistant/tool renderer.
- A slow boot shows a localized nonmodal recovery notice and Retry now button.
  The startup composer stays locked until history is ready. An unanswered
  pre-RPC extension dialog keeps its existing terminal-intervention behavior;
  recovery must never approve or cancel it automatically.
- `getStartupInfo` retains its existing `info` field and adds optional
  `statusSnapshot: { statusKey: string; statusText: string }[]`. All three hosts
  retain the latest per-process status, including empty-text tombstones. No
  credentials, session files, new Pi RPCs or persistent caches are added.
- The standalone bridge and VS Code host share `ExtensionUiState`; the C# host
  mirrors the status snapshot contract with a thread-safe dictionary. The
  existing browser-handoff widget/title/editor replay is preserved; periodic
  recovery replays **only statuses**, never dialogs, notices or editor text.
- A UI request revision prevents an older snapshot from overwriting a newer
  live status or clear. Returning to a visible panel performs another sync.
- New-session creation uses the 90-second transition deadline and reports
  errors/cancellation. Uncertain outcomes are reconciled by read-only state
  queries; `new_session`, prompts, steering and other mutations are **never
  retried automatically**. Recovery does not restart Pi or change models.

## Scope and limitations

This recovers missing metadata, not a permanently blocked extension or broken
stdin pipe. In those cases the notice remains and the user may explicitly
restart Pi. An empty status snapshot is valid: the UI must not infer that a
particular extension or provider must exist. Older hosts without snapshots
remain compatible but cannot recover already-lost status events.

The host executable must be reloaded after installing a new VSIX; fresh webview
assets alone do not replace already-loaded extension-host code.

## Validation

Unit tests cover retries, visibility, single-flight, invalidation, status
clears, live/snapshot ordering, and exclusion of interactive events. Browser
smoke tests exercise the real UI against a delayed fake RPC/IDE transport,
including readiness after initial retries and an uncertain new-session result.
