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
Use the pi coding agent in a Chrome side panel with page context, DOM access and screenshots under your control.
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
Required to show the active page title, URL and favicon, track tab changes, replace the standalone piw tab after a confirmed handoff, and capture the visible viewport when the screenshot tool is explicitly called.
```

**scripting**

```text
Required to read the current text selection and serialize the active page DOM when the corresponding agent tool is explicitly called.
```

**storage**

```text
Required to store the user-configured piw server URL locally and retain short-lived handoff state while the standalone view moves into the side panel. Chrome Sync is not used.
```

**Host access (`<all_urls>`)**

```text
Required because page context, selection and the opt-in DOM tool must work on the arbitrary HTTP or HTTPS page selected by the user. Chrome's tabs.captureVisibleTab API specifically requires <all_urls> when a screenshot is requested asynchronously after the original user gesture. Host access is also required to connect to a user-configured piw server on loopback, LAN, Tailscale or HTTPS. The extension code still limits page context and tools to HTTP/HTTPS pages. Page DOM and screenshots are never collected in the background; the first tool request for each origin and panel session asks for confirmation.
```

## Privacy questionnaire

Answer according to the actual behavior rather than minimizing the declaration:

- the extension handles personal communications, authentication information, website content and browsing activity needed for its single purpose;
- messages, attachments, selected text, requested DOM and requested screenshots may be sent to the user-configured piw server, AI provider and other user-configured tools;
- the developer does not receive, sell or use this data for advertising, analytics, credit decisions or unrelated purposes;
- authentication information can be present in the configured server URL and is stored only in `storage.local`;
- remote code execution is not used; every executable asset is included in the extension package.

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
