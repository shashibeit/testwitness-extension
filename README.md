# TestWitness Extension Standard

> Every test has a story. Capture the proof.

[![CI](https://github.com/shashibeit/testwitness-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/shashibeit/testwitness-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

TestWitness Extension Standard is a privacy-first Manifest V3 extension for Google Chrome and Microsoft Edge. It lets a QA tester capture evidence from an application without adding TestWitness to that application's source code.

The extension is a separate project from [`@testwitness/core`](https://github.com/shashibeit/testwitness). It reuses the core evidence model, HTML report, ZIP exporter, privacy sanitizer, and browser instrumentation while providing extension-specific tab screenshots, tab video, persistent storage, and lifecycle management.

QA teams should use the [complete QA Operator Guide](docs/QA-GUIDE.md) for installation, safe capture, evidence verification, troubleshooting, and the release smoke-test checklist.

## MVP capabilities

- Start one tab-scoped evidence session at a time.
- Pause and resume action, console, network, and video capture.
- Capture the visible tab as a real browser screenshot.
- Mask configured elements and password fields before screenshot pixels are captured.
- Capture screenshots manually or automatically at session start and navigation.
- Optionally record the selected tab as WebM video. Video and audio are disabled by default.
- Capture safe tester actions, console warnings/errors, and Fetch/XHR outcomes.
- Capture sanitized request/response headers by default.
- Capture sanitized request/response bodies only after an explicit high-risk opt-in.
- Add tester notes and select passed, failed, blocked, or not-set.
- Persist in-progress evidence in extension-origin IndexedDB.
- Generate the existing TestWitness offline HTML report and evidence ZIP.
- Download all evidence locally; the extension has no backend and uploads nothing.

## QA team quick start (version 0.1.1)

This is the recommended path for a QA tester who has received either the unpacked `dist/` folder or the source repository. You do not need to modify the application under test.

### What you need

- Google Chrome 116 or newer, or a compatible Microsoft Edge release
- An unpacked `dist/` folder produced from this project, or the Chrome/Edge artifact ZIP extracted to a local directory
- A normal `http://` or `https://` page to test
- Permission from your organization to capture the page and its data

Do not test from browser settings, a new-tab page, a browser extension store, another extension page, or `view-source:`. Chromium does not allow extensions to instrument those pages. `file:` pages are not supported by default.

### Install the unpacked extension in Chrome

1. If an older TestWitness extension is installed, first remove it from `chrome://extensions`. This clean-install step is important when moving to version 0.1.1 because Chrome may retain older side-panel behavior.
2. Open `chrome://extensions`.
3. Enable **Developer mode** in the upper-right corner.
4. Select **Load unpacked**.
5. Select the `testwitness-extension/dist` directory itself. If QA received an artifact ZIP, extract it first and select the extracted directory containing `manifest.json`; do not select the ZIP file.
6. Confirm the TestWitness card displays version **0.1.1** and has no manifest errors.
7. Use the Extensions puzzle menu to pin TestWitness to the toolbar. Pinning is optional, but it makes the required launcher action easier to find.

### Install the unpacked extension in Microsoft Edge

1. If an older TestWitness extension is installed, first remove it from `edge://extensions`.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Select the `testwitness-extension/dist` directory itself. If QA received an artifact ZIP, extract it first and select the extracted directory containing `manifest.json`.
6. Confirm the TestWitness card displays version **0.1.1** and has no manifest errors.
7. Pin TestWitness from the Extensions menu if desired.

### Open TestWitness for the application tab

Version 0.1.1 uses a small launcher popup. This explicit click is required so Chromium grants temporary `activeTab` access without TestWitness requesting permanent access to every website.

1. Open the exact application page you want to test and keep that tab active.
2. Click the **TestWitness extension icon** in the browser toolbar or Extensions menu. Do not open it only from Chromium's general side-panel menu.
3. Confirm the popup displays **Version 0.1.1**.
4. Select **Open TestWitness for this tab**.
5. The TestWitness side panel opens. Confirm it identifies the intended page and displays **Ready**.
6. If it says **No active tab** or **The active tab does not expose a URL**, close the panel and follow the troubleshooting steps below; mandatory form fields are not the cause of that message.

### Required fields

Only these session fields are required:

| Field            | Requirement                                                            |
| ---------------- | ---------------------------------------------------------------------- |
| Application name | Required. It is normally prefilled from the active site's host name.   |
| Environment      | Required. It defaults to `test`; change it to the real QA environment. |

Test-case ID/name, requirement ID, release version, tester name, and employee ID are optional. QA teams should still provide test-case and release details when available because they make the exported evidence easier to trace.

If **Start session** remains disabled after the two required fields are populated, read the status/error text at the top of the panel. The usual cause is missing access to the active tab, an unsupported browser page, or an operation already in progress—not another missing metadata field.

### Choose capture options before starting

Capture settings are fixed for the life of a session. To change them, finish the current session and start a new one.

| Option                             | Default       | QA guidance                                                                                                                               |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Manual screenshots                 | On            | Use **Capture screenshot** at meaningful checkpoints.                                                                                     |
| Automatic screenshots              | Off           | Enable for a checkpoint at session start and after detected navigation. The tested tab must remain visible.                               |
| Record browser-tab video           | Off           | Enable only when a continuous visual record is required. Video is limited to 30 minutes in the current UI.                                |
| Include tab audio                  | Off           | Enable only with approval; audio may contain conversations or other sensitive information.                                                |
| Actions, console, and Fetch/XHR    | On            | Captures bounded and sanitized application evidence after instrumentation starts.                                                         |
| Sanitized request/response headers | On            | Sensitive headers remain redacted even when header capture is enabled.                                                                    |
| Sanitized request bodies           | Off           | High-risk opt-in under **Privacy and advanced capture**. Enable only when payload evidence is necessary and approved.                     |
| Sanitized response bodies          | Off           | High-risk opt-in. Browser/CORS restrictions, binary data, and size limits can still make a response unavailable or omitted.               |
| Mask/exclude selectors             | Team-specific | Add selectors for sensitive page regions before the session. Password fields and embedded browsing contexts receive mandatory protection. |

To enable payloads shown as **Disabled by configuration** in a report:

1. Finish the active session.
2. Open a new session setup form.
3. Expand **Privacy and advanced capture**.
4. Enable **Capture sanitized request bodies** and/or **Capture sanitized response bodies**.
5. Start a new session and repeat the API action.

Payload capture does not disable mandatory redaction. Authorization, cookies, passwords, access/refresh tokens, API keys, CSRF/XSRF tokens, session identifiers, hidden values, and file input values remain protected. GET requests commonly have no request body; binary, opaque, CORS-protected, oversized, worker, beacon, media, and browser-level traffic may not expose a body to the Standard extension.

## Recommended QA evidence workflow

The following example uses a typical login and profile-update test case.

1. Prepare a non-production test account and open the application's login page.
2. Click the TestWitness icon and choose **Open TestWitness for this tab**.
3. Enter an application name and the exact environment, such as `qa` or `staging`.
4. Add the test-case ID/name, requirement ID, release version, and tester identity when your process requires traceability.
5. Review privacy selectors and choose screenshots, video, audio, and payload options according to the test plan.
6. Select **Start session**. If video is enabled, verify Chromium shows its recording indicator.
7. Add an opening note describing the scenario and preconditions.
8. Perform login. After the expected landing page appears, capture a screenshot labeled, for example, `Login completed`.
9. Navigate to the profile form, make the intended change, and submit it. Capture another screenshot showing the resulting state without exposing sensitive data.
10. Exercise any negative path required by the test, such as a validation error or failed API response. Add a note explaining expected versus actual behavior.
11. Use **Pause** before performing unrelated activity; use **Resume** when the test continues. Existing evidence is preserved.
12. Select **Passed**, **Failed**, **Blocked**, or **Not set**. A failed/blocked session should include a concise note explaining why.
13. Select **Finish**, review the confirmation, then select **Finish and prepare evidence**.
14. Select **Download evidence ZIP** and retain it according to your team's approved evidence policy.

If the tested application navigates to a different origin, Chromium may revoke temporary tab access. Click the TestWitness icon on the new origin and grant access again. Treat any reported capture gap as part of the test record.

## Verify the downloaded evidence

Do not submit the ZIP to a ticket or test-management system until it passes this checklist:

- The ZIP opens without an archive error.
- `report.html` opens locally without a server or internet connection.
- The session ID, application, environment, release, test case, tester, start/end times, duration, URL, and result are correct.
- Notes are readable and contain no secrets or unnecessary customer information.
- Expected manual and automatic screenshots appear, have useful labels/timestamps, and show masking where required.
- Actions follow the scenario in the expected order without exposing complete free-text or password values.
- Console entries and network records correspond to the test window.
- Header and query-parameter secrets display as redacted.
- Request/response payloads are present only if they were explicitly enabled; **Disabled by configuration** is expected when the opt-in was off.
- If video was enabled, `recording.webm` exists and plays. If video failed, the report explains the condition and the remaining evidence is still intact.
- The extracted JSON files and `screenshots/` files match the evidence summarized by the report.

If any captured content violates privacy or retention rules, do not distribute the archive. Delete it and repeat the session with stricter capture settings.

## Developer repository relationship

For local development, `package.json` uses:

```json
"@testwitness/core": "file:../testwitness"
```

The folders should therefore be siblings:

```text
Jarvis/
├── testwitness/
└── testwitness-extension/
```

Before independent CI or store publication, publish `@testwitness/core` and replace the local dependency with an exact released version.

## Developer prerequisites

- Node.js 20.19 or newer
- npm
- Git
- Google Chrome 116 or newer, or a compatible Microsoft Edge release
- The sibling `testwitness` core project

Chrome 116 is the minimum because the service worker obtains a tab stream ID and the offscreen document consumes that stream.

## Build from source

Clone both repositories into the same parent directory, then build the core dependency first:

```bash
mkdir testwitness-workspace
cd testwitness-workspace
git clone https://github.com/shashibeit/testwitness.git
git clone https://github.com/shashibeit/testwitness-extension.git

cd testwitness
npm ci
npm run build
```

Then install and validate the extension:

```bash
cd ../testwitness-extension
npm ci
npm run validate
```

The unpacked extension is written to `dist/`.

Create separate Chrome and Edge store archives:

```bash
npm run package
```

This creates:

```text
artifacts/testwitness-extension-standard-chrome-0.1.1.zip
artifacts/testwitness-extension-standard-edge-0.1.1.zip
```

The initial archives have identical code. They are named separately because Chrome Web Store and Microsoft Edge Add-ons require separate submissions. Install the resulting `dist/` folder by following the Chrome or Edge QA instructions above.

## Enable and disable features on the go

Before starting a session:

- Turn **Record browser-tab video** on or off. It is off by default.
- Turn **Include tab audio** on only when needed. It is off by default.
- Turn **Automatic screenshots** on or off.
- Expand **Privacy and advanced capture** to change mask or exclude selectors.
- Explicitly opt into request or response bodies. Both are off by default.

During a session:

- **Pause** stops action, console, network, and video recording without deleting evidence already captured.
- **Resume** continues the same session.
- Manual screenshots are available while recording and disabled while paused.
- Notes and the session result can be updated while recording or paused.
- If video becomes unavailable, the session continues to preserve screenshots, actions, logs, requests, and notes.

Changing privacy selectors or body-capture choices after a session starts is intentionally not supported in this MVP. Stop the session and start a new one so the report has one consistent privacy policy.

## Architecture

```text
Side panel
  ├─ session controls, notes, result, counters
  └─ ZIP generation and download
       │
Manifest V3 service worker
  ├─ authoritative tab-scoped session state
  ├─ script injection and navigation recovery
  ├─ screenshot orchestration and badges
  └─ runtime message validation
       │
Isolated content script
  ├─ page metadata
  ├─ screenshot mask/restore handshake
  └─ untrusted MAIN-world message boundary
       │
MAIN-world page bridge
  ├─ action and history recording
  ├─ console interception
  └─ Fetch/XMLHttpRequest interception
       │
Offscreen document
  ├─ tab MediaStream consumption
  ├─ MediaRecorder lifecycle
  └─ video Blob persistence
       │
IndexedDB
  └─ session state, structured evidence, screenshots, and video
```

The MAIN-world bridge is required because a normal isolated content script cannot patch the application's `window.fetch`, `XMLHttpRequest`, `console`, or `history` realm. Page-bridge messages are always treated as untrusted, bounded, validated, and sanitized again before storage. Because this bridge runs in and observes an application-controlled JavaScript realm, a hostile page can observe, suppress, or forge page-derived events. TestWitness Standard is an evidence-capture aid, not cryptographic attestation or tamper-proof audit logging.

## Permissions

| Permission   | Why it is needed                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `activeTab`  | Temporary access after the tester clicks the extension; avoids permanent access to every site. |
| `scripting`  | Injects the isolated content script and MAIN-world recorder into the approved tab.             |
| `storage`    | Supports extension settings and future managed configuration. Evidence itself uses IndexedDB.  |
| `tabCapture` | Records the tester-approved active tab when video is enabled.                                  |
| `offscreen`  | Hosts MediaRecorder because MV3 service workers do not have DOM/media APIs.                    |
| `downloads`  | Starts the locally generated evidence ZIP download.                                            |
| `sidePanel`  | Provides persistent framework-independent controls outside the tested page.                    |

HTTP and HTTPS host access is declared as optional, not mandatory. The extension does not request `<all_urls>`, `webRequest`, or `debugger` in the Standard edition.

## Privacy and security

The following values remain mandatory redactions:

- Authorization and proxy authorization
- Cookies and Set-Cookie
- Passwords
- Access and refresh tokens
- API keys and client secrets
- CSRF/XSRF tokens
- Session identifiers in headers or query parameters
- Password, hidden, and file input values

Additional safeguards:

- Request and response bodies are disabled by default.
- Tab audio and video are disabled by default.
- Screenshot capture fails if privacy masking cannot be confirmed.
- Embedded `iframe`, `frame`, `embed`, and `object` rectangles are masked as a whole before screenshot capture.
- Configured selectors and mandatory password selectors are inspected in the document and accessible open Shadow DOM roots.
- A screenshot fails when the session tab is not the visible tab in the focused window, preventing accidental capture of another tab.
- Evidence Blobs are written directly to IndexedDB and never serialized through runtime messages.
- Runtime messages are allowlisted, bounded, tied to the target tab, and protected from stale documents with a per-navigation lease.
- Only top-frame evidence is accepted in MVP 1.
- No evidence is uploaded.

Do not capture production customer data without organizational approval, a documented lawful purpose, and an appropriate retention policy.

## Automatic screenshots

When enabled, the MVP captures:

- A checkpoint shortly after session startup
- A checkpoint after same-document navigation such as History API, popstate, or hash changes
- A checkpoint after a full page load when page access reconnects

Automatic capture still requires the target tab and browser window to be visible. If they are not, TestWitness records a recoverable warning instead of capturing the wrong screen.

## Video behavior

- Enabling video and selecting **Start session** is the tester's explicit approval to record that active tab. TestWitness does not bypass browser capture controls.
- Video records the active tab only, not the entire desktop.
- Audio is disabled by default.
- Recording is limited to 30 minutes by the current side-panel setting.
- Pause/resume follows the evidence session.
- Closing the tab, stopping capture, reaching the duration limit, or a recorder error finalizes available chunks and stops media tracks.
- Video failure does not discard any other evidence.

Unit tests use mocked media APIs. They do not prove that real tab capture, browser permission UI, codecs, or WebM playback work on a particular workstation. Complete the manual video test below before a release.

## Manual release test

Run this once in current Chrome and Edge:

1. Load `dist/` as an unpacked extension.
2. Open a local or QA application over HTTP/HTTPS.
3. Start a session without video.
4. Trigger a click, form change, successful request, failed request, console warning, and console error.
5. Capture a screenshot containing an element matching `[data-sensitive]`; verify it is opaque in the report.
6. Pause and verify new activity is not recorded; resume and verify capture continues.
7. Stop and download the ZIP. Confirm `report.html`, JSON evidence, and screenshot files open.
8. Start another session with video enabled.
9. Verify the browser displays a tab-capture indicator.
10. Pause/resume, then stop. Confirm `recording.webm` exists and plays.
11. Repeat video capture and manually stop sharing from the browser indicator. Confirm other evidence continues and the report shows a video notice.
12. Navigate within the same origin and verify instrumentation reconnects.
13. Navigate to a different origin and verify TestWitness reports that page access must be granted again rather than silently recording a gap.

## Known MVP limitations

- Chrome/Edge internal pages, extension stores, other extension pages, and `view-source:` pages cannot be instrumented.
- `file:` pages are not supported by default.
- A visible-tab screenshot captures the viewport, not a stitched full-page image.
- Closed Shadow DOM cannot be inspected by the extension. Configure a mask selector for the component host when it may contain sensitive content; embedded browsing contexts are masked as a whole.
- Cross-origin navigation can revoke `activeTab`; the tester may need to click the extension icon again.
- Page-derived action, console, and Fetch/XHR evidence is observable by the tested page and is not tamper-proof.
- The page bridge captures Fetch/XHR initiated after instrumentation. It does not cover images, beacons, worker traffic, browser navigation requests, or requests that started before the session.
- Browser-level response bodies are not available without a much more powerful debugger/CDP integration. That capability is intentionally deferred to a separately permissioned enterprise edition.
- Evidence is retained locally for the latest completed sessions; long-term retention controls are future work.
- Firefox and Safari extension packages are not part of this project yet.

## Troubleshooting

### `No active tab` or `The active tab does not expose a URL`

This normally means the side panel was opened without the toolbar launcher gesture that grants temporary tab access. It is not caused by missing session fields.

1. Confirm `chrome://extensions` or `edge://extensions` shows TestWitness version **0.1.1**.
2. Close the existing TestWitness side panel.
3. Open and focus the normal HTTP/HTTPS page you want to test.
4. Click the TestWitness toolbar/Extensions-menu icon on that tab.
5. In the version 0.1.1 popup, select **Open TestWitness for this tab**.

Do not open TestWitness only from the browser's general side-panel menu. If the versioned launcher does not appear, remove the unpacked extension, load `dist/` again, and reload the target page.

### The side panel says `Capture unavailable`

Open a normal HTTP or HTTPS application page. Chrome settings, Edge settings, browser stores, PDFs rendered by privileged viewers, and other internal pages are restricted.

If it is a normal application page, keep it active and use the TestWitness launcher again. In the extension's **Details → Site access**, allow the specific test site if Chromium or an enterprise policy requires explicit site access. Reload the page after changing access.

### Start fails after navigation

The page probably moved to another origin and `activeTab` access was revoked. Click the TestWitness extension icon on the new page, then reload/retry. Persistent optional host-permission UX is planned for the next iteration.

### Start is disabled after switching to another tab

Populate **Application name** and **Environment**, then read the status message at the top of the panel. Use the latest build, reload TestWitness from `chrome://extensions` or `edge://extensions`, and reload the target page. The side panel refreshes when the active tab or focused window changes. The target must be a normal HTTP or HTTPS page. If access was granted to a different tab, close the panel and run the launcher from the intended tab.

### TestWitness cannot start on YouTube or another public site

Keep the target tab active, click the TestWitness extension icon on that same tab, and select **Open TestWitness for this tab** in the launcher. This popup-based gesture grants temporary `activeTab` access; opening TestWitness only from Chrome's persistent side-panel menu does not. If browser policy still denies injection, open the extension's **Details → Site access** settings and explicitly allow that site. Test first with video disabled to separate page-instrumentation issues from tab-recording issues. Reload the target page after every extension rebuild.

### Screenshot capture says the target tab is inactive

Return to the recorded tab and focus its browser window. TestWitness deliberately refuses to capture whichever unrelated tab happens to be visible.

### A screenshot is missing or fails

- Confirm the session is recording, not paused.
- Keep the recorded tab visible in the focused browser window until capture completes.
- Check the panel warnings. TestWitness fails closed when it cannot confirm that privacy masks were applied; it does not silently take an unmasked screenshot.
- Validate each custom mask/exclude selector in the tested application. Invalid selectors can prevent the privacy handshake.
- Remember that automatic screenshots occur only at startup and detected navigation, not after every click.

### Video is unavailable

Start a new session and enable **Record browser-tab video** before selecting **Start session**. Keep the intended tab active during startup. Verify that the browser supports `tabCapture`, `offscreen`, `MediaRecorder`, and WebM, and ensure no enterprise policy or another extension is blocking tab capture. Test first with video disabled to confirm that page evidence works independently. The rest of the evidence session remains usable when video fails.

### The downloaded ZIP has no video

Video must be enabled before starting the session. Confirm the panel showed **Recording this tab** and that the browser showed its recording indicator.

If the tester stopped tab sharing from the browser indicator, the available recording may be finalized early. Check the report warning. Unit tests mock the media APIs; real video capture must be verified manually on each supported browser/release workstation.

### The report says `Disabled by configuration` for a payload

This is expected when request or response body capture was off at session start. Finish the session, start a new one, expand **Privacy and advanced capture**, enable the required body option, and repeat the request. These settings cannot be changed during an active session.

### A payload says unavailable, omitted, binary, or truncated

TestWitness can capture only what page-level Fetch/XMLHttpRequest instrumentation can safely observe. GET requests may have no body. Opaque/CORS-protected responses, browser/media traffic, worker requests, beacons, binary content, and requests started before instrumentation may not expose a usable body. Captured bodies are bounded; large content can be truncated. Mandatory redaction always applies.

### Expected actions or network calls are missing

Only activity after **Start session** and while the session is recording is eligible. Paused activity is intentionally omitted. The Standard edition observes top-frame page actions and Fetch/XHR; it does not capture images, beacons, worker traffic, browser navigation requests, or requests that began before instrumentation. Cross-origin navigation may require another launcher grant.

### The ZIP does not download

Finish the session and wait for evidence preparation to complete before selecting **Download evidence ZIP**. Check the browser's download permission, download shelf, configured download folder, and available disk space. Enterprise policies may block extension-initiated downloads. Do not repeatedly finish the same active session while preparation is running.

### Changes do not appear after rebuilding

Open `chrome://extensions` or `edge://extensions` and reload the unpacked extension. Reload the tested page before starting a new session so the newly built bridge is injected.

## Update, reload, or uninstall

### QA: install a newer artifact

1. Finish the active session and download any evidence you must retain.
2. Extract the new Chrome or Edge artifact ZIP into a new local directory. Do not overwrite files while the old extension is running.
3. Open `chrome://extensions` or `edge://extensions` and remove the old TestWitness installation.
4. Select **Load unpacked** and choose the newly extracted directory containing `manifest.json`.
5. Confirm the expected version on the extension card and in the TestWitness launcher.
6. Reload the application-under-test page and grant access through **Open TestWitness for this tab**.

Extension-origin IndexedDB belongs to the installed extension. Download required evidence before removing or reinstalling it.

### Developer: reload a freshly built version

1. Finish and download any active evidence session before updating.
2. Rebuild the local `dist/` contents with `npm run build`.
3. Open `chrome://extensions` or `edge://extensions`.
4. Select **Reload** on the TestWitness card.
5. Reload the application-under-test tab so the current content and page scripts are injected.
6. Click the TestWitness extension icon and use **Open TestWitness for this tab** again.
7. Confirm the launcher and extension card show the expected version.

If an update changes launcher, manifest, permission, or side-panel behavior, perform a clean reinstall: finish/download evidence, select **Remove**, then use **Load unpacked** on the new `dist/` folder.

### Temporarily disable TestWitness

Open the browser's extensions page and turn off the TestWitness card. Finish and download an active session first; disabling the extension can interrupt recording and leave evidence unavailable from the UI.

### Uninstall TestWitness

1. Finish the current session and download any evidence you must retain.
2. Open `chrome://extensions` or `edge://extensions`.
3. Select **Remove** on the TestWitness card and confirm.
4. Delete downloaded evidence separately if it should not be retained.

Removing the extension removes its extension-origin storage, including locally retained IndexedDB evidence. Downloaded ZIP files are outside extension storage and are not removed automatically.

## Developer and contributor workflow

Keep `testwitness` and `testwitness-extension` as sibling directories while the extension uses the local core dependency. Build the core first, then validate the extension:

```bash
cd ../testwitness
npm install
npm run build

cd ../testwitness-extension
npm install
npm run validate
```

`npm run validate` is the minimum automated check before a pull request. It does not replace the manual Chrome/Edge test matrix, especially for real tab video, browser permission UI, side-panel behavior, WebM codecs/playback, screenshot privacy, or enterprise browser policies.

### Development commands

```bash
npm run test          # Vitest unit/integration suite
npm run test:watch    # watch mode
npm run typecheck     # strict TypeScript validation
npm run lint          # ESLint
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run build         # build loadable MV3 dist/
npm run package       # create Chrome and Edge ZIP artifacts
npm run validate      # tests + typecheck + lint + format + build
```

## Store-release work still required

- Perform and record the manual Chrome and Edge test matrix.
- Add a public privacy policy and data-use disclosure.
- Replace the sibling file dependency with a released `@testwitness/core` version.
- Add signed store artwork, screenshots, support URL, and release notes.
- Validate managed-browser and enterprise DLP behavior.
- Add Playwright coverage for the unpacked extension where the CI browser supports side panels.
- Complete Chrome Web Store and Edge Add-ons review separately.

## Contributing

Issues, accessibility feedback, privacy reviews, and pull requests are welcome. Keep changes framework-independent, privacy-first, and scoped to Manifest V3 Chrome/Edge behavior unless the proposal explicitly introduces another target. Add or update tests, run `npm run validate`, and record the applicable manual browser results in the pull request. Never add production secrets or captured customer evidence to fixtures, commits, issues, or pull requests.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities using [SECURITY.md](SECURITY.md), and see [CHANGELOG.md](CHANGELOG.md) for version history.

If TestWitness helps your QA or development team, share the project and give it a star.

## License

MIT. See [LICENSE](LICENSE).
