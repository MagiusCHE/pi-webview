# Changelog

pi-webview release notes are maintained in English. When a release is prepared, the `Unreleased` section automatically becomes the new version section.

## [Unreleased]

## [0.7.3] - 2026-10-27

- Fixed synthetic page clicks ignoring page `preventDefault()`: the generated `MouseEvent`/`PointerEvent` objects were not cancelable, so a canceled click still submitted a form or changed the URL hash. Pointer and click events are now cancelable (`view` and `detail` set as in native events), the click result reports `defaultPrevented`, and the extension never cancels or duplicates the default action itself: when the page cancels the activation nothing else runs, otherwise the real default action runs once. Added `defaultAction: "suppress"` to `browser_page_click` and to click actions for SPA controls whose handler does not cancel the event (anchors with `href="#"`, submit inputs): page handlers still run, the browser default is suppressed deterministically and the result reports `defaultActionSuppressed`, so the router is not reset by a hash change or a duplicate submit.
- Added an explicit browser companion protocol version: every companion result is stamped and the tools refuse an older build with a "reload the extension" error instead of rendering a missing field as an empty success. A compact DOM request answered with a full payload now fails instead of reporting "0 visible controls", and duplicate editor ids are refused client-side too.
- Fixed `browser_page_editor list` reporting "no supported editor" on real pages whose handle exposes throwing accessors: the discovery called `getReadOnly()` (which raised `TypeError` on the Zoho Creator handle) inside the scan, so the whole injected function died and the service worker received no result. Every probe is now guarded, `readOnly` stops at the first boolean answer from `getOption`, and a scan that receives no frame result is reported as such instead of looking like "no editor".
- Fixed editor detection failing on large pages: the DOM scan used a bounded object budget, so framework expandos exhausted it before reaching a wrapper that sits late in the document (reported case: 3000 elements, handle at index 2035+). The scan is now shape-first and per element, skips framework internals (`__react*`, `__vue*`, `__ngContext*`, `__svelte*`, `__zone_symbol__*`, `jQuery*`), and raises the element cap to 50000.
- Fixed clicks hanging when `requestAnimationFrame` is paused (background or occluded window): the pre-dispatch frame wait is now bounded to 250 ms and reports `rafTimedOut` instead of turning into a bridge timeout.
- Fixed duplicate `editorId` values in `browser_page_editor list`: DOM fallback fields shared the same id, so read and write could not resolve a single target. Ids are now indexed per position, a request that still matches more than one target is refused, and `list` accepts `filters: { visibleOnly, editableOnly }` to exclude hidden or read-only helper fields. Fields parked off-screen are no longer reported as visible.
- `browser_page_dom` now returns a compact view by default: visible controls with accessible labels, values, state and a unique selector, excluding `script`/`style`/`template`/`noscript`/`svg`/`iframe` content and redacting password, hidden and token-like values. `mode: "full"` keeps the complete HTML serialization.
- Click results now describe dispatch, not application outcome: each click reports the element that received the events, the resulting hash and an `outcome` (`dispatched`/`canceled`/`suppressed`), the sequence reports `actionId` plus the tab URL before and after, and failures or timeouts report `outcome: "unknown"` with an explicit warning that the page may have applied the request. Nothing is retried automatically.
- Added `browser_page_script`: the agent can run JavaScript in the page's own context and get a JSON-serializable result snapshot, for checks that no structured tool can express. It is the only arbitrary-code path, requires its own dedicated `script` authorization (current pi session, one site, or every site) with a dialog that shows the exact code, never inherits the DOM or action grants, and is bounded by a 10-second timeout and a 32 KB output limit.
- Added `browser_page_editor`: the agent can list, read, replace and patch the real document of web code editors, including editors inside frames, through the editor API instead of synthetic DOM events. Editors are recognised by API shape (`value-api`, `offset-document`, `model-registry`) rather than by library name, so no brand-specific code is shipped and adding a new editor needs no change; the standard-pipeline fallback (`dom-field`, textarea/text input/contenteditable) is reported as DOM-verified only because no browser API exposes an editor model. Editor detection reports kind, model URI or label, language, size, line count, read-only state and a content hash; writes require that hash, are rejected when the document changed, and are verified by re-reading the editor document. Editor reads reuse the DOM grant and writes reuse the page-action grant, whose dialog shows the target editor and a preview. Editing is separate from the application's Save: nothing is saved, submitted or published automatically.

## [0.7.2] - 2026-10-26

- Fixed the Chrome companion breaking on plain-http pages: the content script called `crypto.randomUUID()`, which does not exist outside a secure context, and the thrown error aborted the whole script. On LAN or tailnet addresses reached by IP this silently disabled page context, selection, DOM, screenshot and page actions. Ids now come from a shared helper with a `getRandomValues` fallback that also works over plain http.

## [0.7.1] - 2026-10-22

- Fixed copying selected chat history in VS Code moving focus back to the prompt and losing the selection. Keyboard and context-menu Copy now keep focus in the chat, including after the composer has been used.

## [0.7.0] - 2026-10-16

- Fixed update checks silently failing on Windows when pi and npm are installed as `.cmd` shims. Core and extension version checks now use the Windows command processor, restoring startup update notices and the yellow header shield when updates are available.

## [0.6.13] - 2026-10-13

- Session picker search matches session titles and workspace directory names, requires all space- or comma-separated terms, and shows a muted directory subtitle for sessions outside the current workspace. Parent directories and full paths are not searched.

## [0.6.12] - 2026-10-12

- Stopping a run now keeps tool results inside their cards instead of promoting them as the final response, including results received after STOP. A localized interruption event is shown live and preserved in resumed history without adding model-context messages.

- Completion notifications no longer fall back to the chat when desktop notifications are unavailable, denied or fail, preventing duplicate assistant responses.

- Promoted textual tool results now stay inside a box with a three-line preview and localized Show all / Show less controls, in both live chat and resumed history. JSON and code retain their full-content Copy action, while images, files and media keep their existing presentation.

## [0.6.11] - 2026-10-11

- Fixed non-compact status bars still clipping text inside individual extension slots on narrow screens. Each slot now wraps its full text, including ANSI-colored segments, long words and explicit line breaks, in every bar position; compact mode remains unchanged.

## [0.6.10] - 2026-10-04

- Fixed Chrome full-page DOM requests failing because the scripting API received an undefined argument; full-page requests now use a JSON-serializable null selector.

- Fixed F5 development launches conflicting with the installed VS Code companion: the companion is now disabled only in the Extension Development Host, avoiding duplicate view and provider registrations while leaving normal VS Code windows unchanged.

- Added an editable full-path field to the standalone and Chrome folder picker, so folder paths can be typed or pasted directly. Missing, non-directory or inaccessible paths show an inline error without changing the workspace or session.

## [0.6.9] - 2026-09-28

- Fixed a session load getting stuck when a pi extension asked for a confirmation during startup. pi installs its RPC response reader only after the first extension binding, so that dialog can never be answered: the loader stayed up, the question was unreachable and the history request timed out after 90 seconds. The question is now shown as an inert notice with the terminal instructions and the reload hint, the session stays locked instead of waiting, and every dialog arriving after RPC answered keeps working as before.

- Inline code in the standalone page and in the Chrome panel now renders like inside the VS Code webview: the colored chip (theme preformat color, padding, radius and the monospace font) is defined in the UI itself, with the standalone palette as fallback, and fenced code blocks keep their own surface instead of inheriting the preformat color.

- Collapsed Agentic thinking blocks no longer repaint their hidden content. Thought bodies, tool arguments, tool results and shell exit codes are retained as data and rendered the first time the block or the single tool is expanded, the per-tool timers suspend while their parent is collapsed, and the multi-second clocks tick once per second instead of once per frame. Headers, counts and final states stay current, so expanding a block always shows the latest complete state.

- Picking a session that lives in another repository no longer asks what to do when the current session is still empty: an unstarted session has nothing to preserve or fork, so the standalone page resumes the selected session in its own workspace directly. Chrome already reloaded the original session and the fixed-workspace IDE companions keep their fork confirmation.

## [0.6.8] - 2026-09-27

- Fixed `piw --pi <command|path>` being silently ignored: `resolvePi` now accepts the explicit override and the launcher passes a single `--pi` to the bridge (the previous duplicate let the PATH-resolved value win).

- Moved the static context row (editor selection or browser page) inside the composer footer, below the divider that separates the scrolling chat from the input area: the row no longer hovers above that border as if it belonged to the chat, and it now shares the composer geometry.

- Fixed a message injected by another pi session (`send_to_session`) landing next to the still-open Agentic thinking block and leaving it spanning across the conversation: a `custom` message is now a visible boundary exactly like a user message, so the block is closed before its card, the internal work that follows opens a new block and the live view matches the resumed history.

## [0.6.7] - 2026-09-26

- Unified the product icon on the terracotta tile everywhere the background is not known in advance: the VS Code companion (Extensions list, activity bar and view header), the Visual Studio companion (Extension Manager and "Other Windows" entry) and the standalone `piw` page (favicon and desktop notifications) no longer use a white glyph on transparency, which disappeared on light backgrounds exactly like the old Chrome Web Store icon did. Only the editor title bar command buttons keep their monochrome light/dark glyphs.

- Thinking blocks now render markdown (bold, lists, links, fenced code with the shared Copy block header) instead of showing the raw markers, and they do it lazily: nothing is formatted while the block is collapsed, the first pass happens when the block is expanded and a streaming thought is re-rendered on the visible block only. Consecutive thought blocks from the provider keep sharing one card, as before.

## [0.6.6] - 2026-09-25

- Fixed the session picker appearing to do nothing on large sessions: switching and history loading now wait up to 90 seconds instead of the 10 second RPC timeout, so a session that takes longer to reload no longer drops back to the new-session screen mid-load.
- Fixed a failed session switch being invisible: an error from pi, a cancelled switch or a timed-out request is now reported in the chat instead of leaving the interface on the previous screen, the "session resumed" notice is only shown after a successful load and the new-session banner no longer appears over an unloaded session.
- Fixed the Windows browser launch dropping the launch intent: `piw` now passes the URL to `cmd start` quoted, so the `&launch=…` parameter survives and a reused bridge opens the new session in the folder where `piw` was invoked.

## [0.6.5] - 2026-09-24

- Provider balance now follows the API host of the provider instead of a hardcoded provider id: any provider pointing at the same API (for example a second DeepSeek key under a custom provider id) reports cost and balance like the built-in one, and the session cost stays visible on its own when a provider exposes no balance.
- Sub-cent session costs are shown with extra precision instead of rounding to `$0.00`, and the OpenRouter balance is derived from `total_credits - total_usage` when the endpoint no longer returns `remaining_credits`.
- Fixed a failed compaction hiding pi's message: the exact error (for example "Compaction failed: Nothing to compact (session too small)") is now shown in the chat instead of only in the block tooltip.

## [0.6.4] - 2026-09-22

- Localized the Agentic thinking block in Italian: the block label ("Ragionamento agentico") and the counter chips (pensieri, letture, scritture, strumenti) were still English.
- Fixed the first run without any configured provider: the webview now shows pi's "no models available" guidance (terminal `/login`, providers/models documentation) instead of an empty model picker and an unexplained `unknown` model.
- Fixed the VS Code companion check on Windows: the GUI `Code.exe` was used as if it were the CLI ("bad option: --list-extensions"), the `code.cmd` wrapper is now preferred and an unusable CLI falls back to the direct vsix install.
- Fixed the context gauge staying stale during a long agent run: it now refreshes after every model response instead of only when the whole run settles.

## [0.6.3] - 2026-09-22

- Fixed the startup loop when the session's saved provider or model no longer exists: pi no longer retries the same broken launch, resuming or switching to that session falls back once to the default model of new sessions instead of being refused, the fallback is reported in the chat and the interface stays usable when even the default is broken.
- Fixed the thinking level kept from the previous model after a model switch: it is now clamped to the levels supported by the new model.
- Fixed the agentic thinking counter staying yellow and animated after an interrupted run: a thought that never receives its end event is now closed as interrupted when the run ends or pi disconnects.

## [0.6.2] - 2026-09-21

- Fixed the promoted tool output printed as the chat response rendering larger than the rest of the conversation: it now uses the same text size and line height as normal chat messages.
- Fixed the Chrome Web Store listing icon disappearing against the white store theme: the Chrome companion now ships a terracotta tile icon that stays visible in both light and dark themes.

## [0.6.1] - 2026-09-19

- Added "move the session into the new folder" to the session-picker folder change: the conversation continues in the selected workspace and the old copy is removed, so no duplicate session is left behind.

## [0.6.0] - 2026-09-19

- Made release publishing deterministic: every release builds all distributable artifacts, packages one hash-verified tarball, and publishes exactly that archive.
- Added npm browser sign-in and browser-based two-factor confirmation to the publish flow, and verified the published tarball integrity on the npm registry before creating the release.
- Verified the release tag commit and the GitHub release asset hash, with a recorded artifact manifest for safe idempotent recovery.
- Split release preparation from publishing so a release tag can no longer point to a commit that predates its version bump.

## [0.5.0] - 2026-09-17

- Added a privacy-first, capability-gated speech-to-text composer flow with local recognition preferred, push-to-talk and toggle modes, preserved manual drafts, and an explicit cloud-transcription opt-in.
- Added a consent-gated Chrome Side Panel microphone permission flow that captures only selected microphone input and never tab, desktop, meeting, or file audio.
- Presented the pi-webview version reminder as a single informational startup-style card instead of a warning.
- Allowed consent-gated HTTP(S) navigation from Chrome internal pages such as the New Tab page, while keeping DOM reads, screenshots and page actions blocked there.

## [0.4.2] - 2026-09-16

- Fixed structured typing in model-driven `contenteditable` editors such as CKEditor by sending the `beforeinput` contract in the page world and verifying that the editor retained the text.
- Isolated Chrome session resume state per browser window so opening the Side Panel in a new window starts a new session while reloads, reconnects and handoffs retain the intended session.
- Added session, per-site and global authorization scopes for DOM, screenshot and structured page-action tools, with a Chrome-only permission reset control.
- Added targeted element-DOM reads plus structured CSS-class and inline-style mutation tools, reusing the existing DOM and action authorization scopes without arbitrary JavaScript.
- Added dedicated browser navigation and scrolling tools for safe HTTP(S) reload/navigation, bounded page or container scrolling, and bringing selected elements into view.
- Added visual hit-test and viewport-coordinate browser clicks for overlaid controls while keeping pointer events synthetic and the Chrome debugger permission absent.
- Unified restart-sensitive settings behind one dirty-only Apply action, including Chrome server URL, pi.dev settings and CLI flags.
- Made Chrome resume sessions selected from another workspace through a fresh channel in their original path instead of prompting for a fork or stranding the in-place restart loader.
- Recovered the Chrome Side Panel automatically when an unpacked-extension reload invalidates its runtime context, and replaced stale page listeners without uncaught errors.
- Fixed the VS Code update shield remaining hidden on slower Windows startup paths by keeping the control visible and always writing the initial per-process startup snapshot.

## [0.4.1] - 2026-09-16

- Added a consent-gated structured browser action tool for clicking, typing, selecting, focusing and scrolling without arbitrary JavaScript execution.
- Separated DOM and screenshot consent so the first screenshot always explains that the image may be sent to the configured AI model.
- Preserved `ask_user` option labels and descriptions in live and resumed conversation cards.

## [0.4.0] - 2026-09-16

- Fixed direct VS Code companion installation on Remote SSH hosts by discovering VS Code Server extension directories and safely extracting the bundled VSIX without external archive tools.
- Added the official Google Chrome Side Panel companion with page context, selection and handoff from Browser View.
- Added browser tools for DOM and screenshot capture with explicit consent per origin and panel session.
- Improved persistence, resume and empty-session handling in the Chrome companion.
- Separated the configured Chrome endpoint from internal session intents and improved the settings error flow.
- Improved the visibility of final tool results and fixed queued image-only steering messages.
- Added the versioned available-modes reminder followed by the new version’s release notes.

## [0.3.2] - 2026-09-14

- Improved promotion of final tool outputs, including images, files, JSON and code.
- Improved recovery from invalid sessions without modifying the original file.
- Strengthened update checks and safe forwarding of extension commands.
