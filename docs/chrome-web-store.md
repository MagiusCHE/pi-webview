# Chrome Web Store release checklist

This document contains the repository-specific information needed to create the official pi-webview Chrome companion listing.

## First draft upload

1. Run `pnpm package:chrome`.
2. Open the Chrome Web Store Developer Dashboard.
3. Select **New item** and upload `dist/pi-webview-chrome.zip`.
4. Save the item as a draft and complete its listing before submission.
5. Prefer **Unlisted** for the first production release.

The permanent extension ID is `hcdjfkcgojomhpmcfgipginghhlncamn`. It is not a credential and is stored in `CHROME_WEB_STORE_ID` for the guided installer.

## Listing copy

**Name**

```text
pi-webview
```

**Summary**

```text
Use the pi coding agent in a Chrome side panel with page context, targeted DOM access and structured page interaction under your control.
```

**Single purpose**

```text
pi-webview provides a side-panel interface for a user-operated piw server and lets the user's pi agent work with the active browser page.
```

**Category**

```text
Developer Tools
```

## Permission justifications

**sidePanel**

```text
Required to display the pi-webview conversation beside the page the user is browsing.
```

**tabs**

```text
Required to show the active page title, URL and favicon, track tab changes, replace the standalone piw tab after a confirmed handoff, capture the visible viewport when the screenshot tool is explicitly called, and perform an explicitly authorized page reload or HTTP/HTTPS navigation.
```

**scripting**

```text
Required to read the current text selection, serialize the complete DOM or one selected element when explicitly requested, read and edit the document of a web code editor through the API shape the page exposes, and perform only authorized structured selector/visual/coordinate clicks, type, select, focus, page/container scroll, scroll-into-view, CSS-class and inline-style changes. Pointer events are synthetic DOM events. Reaching editor objects requires injecting one packaged function into the page's own JavaScript context. The user may additionally and explicitly authorize the agent to run JavaScript in the active page (`browser_page_script`): that code is written by the user's own AI agent, runs only with the page's privileges, is bounded by a timeout and an output limit, and is gated by its own consent class (current pi session, one site, or globally) with a dedicated confirmation showing the code. The extension ships every executable asset in the package, does not load remote code into the extension, does not accept stylesheet source code, and does not request Chrome's debugger permission or use CDP.
```

**storage**

```text
Required to store the user-configured piw server URL locally and retain short-lived handoff state while the standalone view moves into the side panel. Chrome Sync is not used.
```

**Host access (`<all_urls>`)**

```text
Required because page context, selection and the opt-in DOM and structured-action tools must work on the arbitrary HTTP or HTTPS page selected by the user. Chrome's tabs.captureVisibleTab API specifically requires <all_urls> when a screenshot is requested asynchronously after the original user gesture. Host access is also required to connect to a user-configured piw server on loopback, LAN, Tailscale or HTTPS. The extension code still limits page context and tools to HTTP/HTTPS pages. Complete/targeted DOM, screenshot and structured-action access have separate authorization groups; visual/coordinate clicks, CSS mutations, scrolling and reload/navigation use the action grant. Navigation accepts only absolute HTTP/HTTPS URLs. Users can grant each operation for the current pi session, one website across sessions, or every website globally. The first action authorization displays targets, coordinates and value previews and explains that future sequences run without another prompt within the selected scope; grants can be reset in the Chrome-only settings.
```

## Privacy questionnaire

Answer according to the actual behavior rather than minimizing the declaration:

- the extension handles personal communications, authentication information, website content and browsing activity needed for its single purpose;
- messages, attachments, selected text, requested complete/targeted DOM, requested screenshots and structured click, page-action, navigation or CSS-mutation instructions may be sent to the user-configured piw server, AI provider and other user-configured tools;
- the developer does not receive, sell or use this data for advertising, analytics, credit decisions or unrelated purposes;
- authentication information can be present in the configured server URL and is stored only in `storage.local`;
- every executable extension asset is included in the extension package and no code is loaded from the network into the extension;
- the only caller-supplied evaluation is `browser_page_script`: the user's own pi agent may run JavaScript in the active page after granting the dedicated script consent, and nothing runs before that grant.

Use this public privacy-policy URL:

```text
https://github.com/MagiusCHE/pi-webview/blob/main/PRIVACY.md
```

## Before submission

- verify that the Chrome Web Store ID is `hcdjfkcgojomhpmcfgipginghhlncamn` and rebuild;
- run format, typecheck, unit tests, bridge smoke and Chrome smoke;
- test the exact ZIP in a clean Chrome profile;
- provide screenshots showing the side panel, connection settings and page-context consent;
- verify that no authenticated piw URL or personal page data appears in screenshots;
- verify the listing support/contact details in the publisher account;
- inspect the final ZIP and repository diff for secrets and personal data.
