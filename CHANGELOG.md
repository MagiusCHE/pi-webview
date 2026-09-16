# Changelog

pi-webview release notes are maintained in English. When a release is prepared, the `Unreleased` section automatically becomes the new version section.

## [Unreleased]

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
