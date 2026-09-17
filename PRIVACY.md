# pi-webview Chrome Companion Privacy Policy

Last updated: September 16, 2026

## Summary

The pi-webview Chrome companion connects the browser side panel to a piw server selected by the user. The extension does not operate a developer-controlled backend, does not include analytics or advertising, and does not sell personal information.

## Data handled by the extension

The extension may handle:

- messages and attachments submitted by the user through the side-panel conversation;
- live microphone audio only while the user explicitly dictates in the Side Panel; it is not recorded, stored or sent to piw, and only the resulting text follows the normal message flow;
- the configured piw server URL, including an authentication token when the user supplies one;
- the URL, title and favicon of the active browser tab;
- text selected by the user on the active page;
- the complete serialized DOM when `browser_page_dom` is called, or the serialized outer HTML of one selected element when `browser_page_element_dom` is called;
- an image of the visible page viewport when the `browser_page_screenshot` tool is called;
- structured selector, visual-hit-test or viewport-coordinate click instructions when `browser_page_click` or `browser_page_action` is called;
- structured type, select, focus or scroll instructions when `browser_page_action` or `browser_page_scroll` is called;
- structured reload or HTTP/HTTPS navigation instructions when `browser_page_navigation` is called;
- structured CSS class additions/removals and inline-style changes when `browser_page_class` or `browser_page_style` is called.

For Chrome Web Store disclosure purposes, this corresponds to personal communications, authentication information, web history and website content. The extension does not intentionally collect personally identifiable, health, financial, payment, location or general user-activity data. Such information may nevertheless be present in content that the user chooses to send or explicitly authorizes the agent to access.

DOM and screenshots are not captured merely because a page is opened. Complete and targeted DOM reads share one DOM authorization; screenshots have a separate authorization; selector/visual/coordinate clicks, type/select/focus/scroll actions, reload/navigation and CSS-class/inline-style mutations share the structured-action authorization. Granting one of these three operation groups never authorizes the others. For each operation, the user can grant access for the current pi session across visited sites, for the current website origin across sessions, or globally across websites and sessions. The first structured-action request displays its targets, coordinates and value previews and warns that future clicks, type, select, focus, scroll, reload/navigation, CSS-class and inline-style changes will run without additional prompts within the selected scope and may have external effects. Navigation accepts only absolute HTTP/HTTPS URLs. Pointer actions are synthetic DOM events. The extension does not request Chrome's `debugger` permission, use CDP, evaluate arbitrary JavaScript or accept stylesheet source code. These grants can be reset from the Chrome-only pi-webview settings. The Chrome manifest declares `<all_urls>` because Chrome requires that host permission for screenshots requested asynchronously through `captureVisibleTab`; the implementation still limits page context and tools to HTTP and HTTPS pages.

## How data is used

Messages and attachments submitted through the side panel are sent to the piw server to perform the user’s request. Page URL, title and selected text are shown in the side panel and may be included as context when the user sends a message to pi. Complete or targeted DOM and screenshots are returned only in response to the corresponding agent tool call and an applicable authorization grant. Structured page actions, including visual/coordinate clicks, navigation and CSS mutations are sent to the Chrome companion only when an applicable action grant exists; after the initial authorization, later sequences within that grant’s scope run without another prompt.

The companion sends this data to the piw server configured by the user. piw runs pi and may pass messages, attachments, selected text, DOM extracts or screenshots to the AI provider and other tools configured by the user. The privacy terms of those services apply to data sent to them. If the user explicitly enables cloud transcription, microphone audio and/or its transcription may instead be processed by the browser's speech service or its provider; raw audio is never sent to piw, pi or the developer.

## Storage

The configured piw server URL is stored locally in Chrome extension storage. It is not stored with Chrome Sync. The URL may contain a private authentication credential and is not written to pi-webview logs.

Browser grants scoped to the current pi session are stored as custom metadata inside that session’s local JSONL file and disappear when the session is deleted. Per-origin and global grants are stored in the local piw user configuration. The Chrome-only settings can reset persistent grants and grants for the current session.

Temporary DOM files may be created by piw on the server machine when a captured DOM is too large for an inline tool result. They use restrictive file permissions and are eligible for automatic cleanup after 24 hours.

The extension does not maintain a remote user database.

## Sharing

The developer does not receive or sell browsing data. Data is shared only with:

- the piw server explicitly configured by the user;
- the AI provider and other tools configured in the user’s own pi installation, when required to perform the user’s request.

## Permissions

- **Side panel:** displays the pi-webview interface beside browser pages.
- **Microphone:** after the user explicitly starts dictation in the Side Panel, pi-webview opens its own short permission window. Chrome requests microphone access only when the user presses **Allow microphone** there. The extension does not capture tab, desktop, meeting or file audio, and does not record, store or send raw microphone audio to piw.
- **Tabs:** reads the active tab’s title, URL and favicon, captures its visible viewport on request, and performs authorized reload or HTTP/HTTPS navigation.
- **Scripting and website access:** reads the current selection, acquires complete or targeted DOM and performs authorized selector/visual/coordinate clicks, other structured page actions and CSS class/inline-style mutations only for the documented browser-context and agent-tool features. Pointer events remain synthetic; the extension does not request the `debugger` permission.
- **Storage:** stores the piw connection URL and temporary session handoff state locally; piw stores the authorization scopes described above in the local session/config files.

Chrome-protected pages and other pages where extension access is forbidden cannot be read, captured or controlled.

## Security

Connections may use HTTP or HTTPS because users can operate piw over loopback, a trusted LAN or a private network such as Tailscale. Authentication tokens are treated as credentials. Users should expose piw only on networks they trust and should not share authenticated URLs.

## Changes

Material changes to this policy will be published in this repository before the corresponding extension update is released.

## Contact

Questions and privacy requests can be submitted through the project’s public issue tracker:

https://github.com/MagiusCHE/pi-webview/issues
