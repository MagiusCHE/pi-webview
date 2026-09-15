# pi-webview Chrome Companion Privacy Policy

Last updated: September 16, 2026

## Summary

The pi-webview Chrome companion connects the browser side panel to a piw server selected by the user. The extension does not operate a developer-controlled backend, does not include analytics or advertising, and does not sell personal information.

## Data handled by the extension

The extension may handle:

- messages and attachments submitted by the user through the side-panel conversation;
- the configured piw server URL, including an authentication token when the user supplies one;
- the URL, title and favicon of the active browser tab;
- text selected by the user on the active page;
- the serialized DOM of the active page when the `browser_page_dom` tool is called;
- an image of the visible page viewport when the `browser_page_screenshot` tool is called.

For Chrome Web Store disclosure purposes, this corresponds to personal communications, authentication information, web history and website content. The extension does not intentionally collect personally identifiable, health, financial, payment, location or general user-activity data. Such information may nevertheless be present in content that the user chooses to send or explicitly authorizes the agent to access.

DOM and screenshots are not captured merely because a page is opened. The first DOM or screenshot request for an origin during a side-panel session requires the user’s confirmation. The Chrome manifest declares `<all_urls>` because Chrome requires that host permission for screenshots requested asynchronously through `captureVisibleTab`; the implementation still limits page context and tools to HTTP and HTTPS pages.

## How data is used

Messages and attachments submitted through the side panel are sent to the piw server to perform the user’s request. Page URL, title and selected text are shown in the side panel and may be included as context when the user sends a message to pi. DOM and screenshots are returned only in response to the corresponding agent tool call.

The companion sends this data to the piw server configured by the user. piw runs pi and may pass messages, attachments, selected text, DOM extracts or screenshots to the AI provider and other tools configured by the user. The privacy terms of those services apply to data sent to them.

## Storage

The configured piw server URL is stored locally in Chrome extension storage. It is not stored with Chrome Sync. The URL may contain a private authentication credential and is not written to pi-webview logs.

Temporary DOM files may be created by piw on the server machine when a captured DOM is too large for an inline tool result. They use restrictive file permissions and are eligible for automatic cleanup after 24 hours.

The extension does not maintain a remote user database.

## Sharing

The developer does not receive or sell browsing data. Data is shared only with:

- the piw server explicitly configured by the user;
- the AI provider and other tools configured in the user’s own pi installation, when required to perform the user’s request.

## Permissions

- **Side panel:** displays the pi-webview interface beside browser pages.
- **Tabs:** reads the active tab’s title, URL and favicon and captures its visible viewport on request.
- **Scripting and website access:** reads the current selection and acquires the DOM only for the documented browser-context and agent-tool features.
- **Storage:** stores the piw connection URL and temporary session handoff state locally.

Chrome-protected pages and other pages where extension access is forbidden cannot be read or captured.

## Security

Connections may use HTTP or HTTPS because users can operate piw over loopback, a trusted LAN or a private network such as Tailscale. Authentication tokens are treated as credentials. Users should expose piw only on networks they trust and should not share authenticated URLs.

## Changes

Material changes to this policy will be published in this repository before the corresponding extension update is released.

## Contact

Questions and privacy requests can be submitted through the project’s public issue tracker:

https://github.com/MagiusCHE/pi-webview/issues
