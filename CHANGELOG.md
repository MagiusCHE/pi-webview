# Changelog

pi-webview release notes are maintained in English. When a release is prepared, the `Unreleased` section automatically becomes the new version section.

## [Unreleased]

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
