# TestWitness Extension Standard v0.1.1: QA Operator Guide

This guide is for QA analysts, test leads, developers, and support engineers who use TestWitness to capture browser-based test evidence. It covers installation, safe session setup, evidence collection, report verification, troubleshooting, and release smoke testing.

TestWitness Extension Standard supports Google Chrome and Microsoft Edge. It captures evidence locally from one approved browser tab. It does not require changes to the application under test, does not require a backend, and does not upload evidence.

> **Release status:** Version 0.1.1 does not have a Chrome Web Store or Microsoft Edge Add-ons listing. Install it in developer mode from an unpacked `dist/` folder. Real-browser behavior, especially tab video and audio, must be tested manually on each supported browser and managed-device configuration.

## 1. Before you begin

### 1.1 Prerequisites for QA testers

Have all of the following before installing the extension:

1. Google Chrome 116 or newer, or a compatible current Microsoft Edge release.
2. Either:
   - a trusted TestWitness v0.1.1 distribution ZIP from your release owner, or
   - the source repository plus its sibling `testwitness` core repository.
3. Permission from your organization to use a developer-mode browser extension.
4. Permission to capture the application, test accounts, payloads, screenshots, video, and audio required by the test plan.
5. A normal `http://` or `https://` application page.
6. A non-production test account and non-production data whenever possible.
7. Enough local disk space for screenshots, an optional WebM recording, and the final ZIP.

The extension cannot instrument browser settings pages, new-tab pages, browser extension stores, other extension pages, `view-source:` pages, or some privileged PDF viewers. `file:` pages are not supported by default.

### 1.2 Understand where evidence is stored

During and after a session, evidence is stored in extension-origin IndexedDB on the local device. A completed session is not uploaded anywhere. The extension retains only a small recent set of completed sessions; when a new session starts, completed history is pruned to the five most recent completed sessions.

Treat the downloaded ZIP as the durable handoff copy. Download and verify it before removing the extension, changing browser profiles, clearing site/extension data, or performing a clean reinstall. Removing the extension can remove its local database, and there is no cloud recovery service.

## 2. Obtain an installable build

### 2.1 If you received a release ZIP

The expected v0.1.1 files are named:

- `testwitness-extension-standard-chrome-0.1.1.zip`
- `testwitness-extension-standard-edge-0.1.1.zip`

To prepare one for developer-mode installation:

1. Obtain the archive from a trusted internal or project release source.
2. Verify its version and integrity using the checksum or release process supplied by your organization.
3. Extract the ZIP to a stable local folder, for example `TestWitness/0.1.1/chrome/`.
4. Open the extracted folder and confirm `manifest.json` is at its top level.
5. Do not select the ZIP itself in **Load unpacked**; Chromium requires the extracted folder.

The Chrome and Edge v0.1.1 packages currently contain the same code, but use the package intended for the browser you are validating.

### 2.2 If you received the source repositories

The current development dependency expects two sibling folders:

```text
Jarvis/
├── testwitness/
└── testwitness-extension/
```

Node.js 20.19 or newer, npm, and Git are required. Build in this order:

```bash
mkdir testwitness-workspace
cd testwitness-workspace
git clone https://github.com/shashibeit/testwitness.git
git clone https://github.com/shashibeit/testwitness-extension.git

cd testwitness
npm ci
npm run build

cd ../testwitness-extension
npm ci
npm run validate
```

`npm run validate` runs unit tests, TypeScript, linting, formatting checks, and the extension build. The loadable unpacked extension is written to `testwitness-extension/dist/`.

To create release archives after validation:

```bash
npm run package
```

The browser-specific archives are written to `testwitness-extension/artifacts/`. Source builds depend on the sibling `@testwitness/core` project; this local dependency must be replaced with an exact published version before independent CI or store publication.

## 3. Install in Google Chrome

Use a clean installation when moving from an older build to v0.1.1. Chrome can preserve older extension behavior during a normal reload.

1. Download any evidence that must be retained from the currently installed copy.
2. Open `chrome://extensions`.
3. If an older TestWitness is installed, select **Remove** and confirm.
4. Enable **Developer mode** in the upper-right corner.
5. Select **Load unpacked**.
6. Select the extracted package folder or `testwitness-extension/dist/`—the folder that directly contains `manifest.json`.
7. Find **TestWitness Extension Standard** in the extension list.
8. Confirm its version is **0.1.1**.
9. Confirm the card has no manifest or service-worker errors.
10. Open Chrome's Extensions puzzle menu and pin TestWitness to the toolbar. Pinning is optional but strongly recommended for QA operators.

Do not open the controls solely through Chrome's general side-panel menu. The TestWitness launcher click described in section 5 grants temporary access to the selected tab.

## 4. Install in Microsoft Edge

1. Download any evidence that must be retained from the currently installed copy.
2. Open `edge://extensions`.
3. If an older TestWitness is installed, select **Remove** and confirm.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Select the extracted package folder or `testwitness-extension/dist/`.
7. Confirm **TestWitness Extension Standard** displays version **0.1.1**.
8. Confirm Edge reports no manifest or service-worker errors.
9. Pin TestWitness from the Extensions menu if your team uses it frequently.

As in Chrome, use the TestWitness toolbar/Extensions-menu icon to launch it for the active tab. Opening only the general side panel does not reliably grant access.

## 5. Open TestWitness for the correct tab

Version 0.1.1 uses a launcher popup because Chromium grants temporary `activeTab` access after an explicit extension action.

1. Open the exact application page you plan to test.
2. Keep that tab selected and keep its browser window focused.
3. Click the **TestWitness extension icon** in the toolbar or browser Extensions menu.
4. Confirm the popup says **Version 0.1.1** and shows the intended tab.
5. Select **Open TestWitness for this tab**.
6. Wait for the side panel to open.
7. Confirm the panel shows the expected application tab and origin.
8. Confirm the status is **Ready**.

Do not begin if the panel identifies a different tab. Close the launcher/panel, select the intended tab, and repeat these steps.

If the application later moves to a different origin, Chromium may revoke temporary access. Click the TestWitness icon on the new origin and grant access again. Record any capture gap in a tester note.

## 6. Complete session setup

### 6.1 Mandatory fields

Only two fields are required:

| Field                | QA instruction                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Application name** | Required. It is normally prefilled from the active host. Replace it with your team's canonical application name when appropriate. |
| **Environment**      | Required. It defaults to `test`. Change it to the exact environment, such as `qa`, `sit`, `uat`, or `staging`.                    |

If **Start session** is disabled after these fields contain values, another mandatory field is not missing. Read the status and error text at the top of the panel. The usual cause is unsupported page access, an inactive target tab, or an operation already in progress.

### 6.2 Optional but recommended traceability fields

Open **Optional session details** and fill in what your QA process uses:

| Field               | Recommended use                                                |
| ------------------- | -------------------------------------------------------------- |
| **Release version** | Build number, release tag, commit, or deployment version.      |
| **Test case ID**    | Stable ID from the test-management system.                     |
| **Test case name**  | Human-readable scenario name.                                  |
| **Requirement ID**  | Requirement, story, defect, or acceptance-criterion reference. |
| **Tester name**     | Tester responsible for the execution.                          |
| **Employee ID**     | Use only if organizational policy requires it.                 |

These fields improve traceability but do not enable or disable capture.

### 6.3 Recommended privacy-first defaults

For an ordinary functional test, start with:

- Manual screenshots: available.
- **Automatic screenshots**: off.
- **Record browser-tab video**: off.
- **Include tab audio**: off.
- Request body capture: off.
- Response body capture: off.
- Actions, console warnings/errors, Fetch, and XHR capture: on automatically.
- Sanitized request and response headers: on automatically.
- Default mask selectors: keep `[data-sensitive]` and `.testwitness-mask` unless your approved test configuration replaces them.

Enable extra capture only when the test objective requires it. Session capture choices and privacy selectors are fixed after the session starts. Finish the session and create a new one to change them.

### 6.4 Configure screenshot privacy

Open **Privacy and advanced capture** before starting:

1. Add one valid CSS selector per line under **Mask selectors** for sensitive visual areas.
2. Add one valid CSS selector per line under **Exclude selectors** for page areas that should be covered as excluded in screenshots.
3. Add one query-parameter name per line under **Additional sensitive query parameters** for application-specific secrets.
4. Keep selectors narrowly scoped and test them on the exact application state.
5. Do not enter secrets themselves—enter selectors or parameter names only.

Password and one-time-code inputs, embedded frames/plugin contexts, and mandatory sensitive values receive built-in protection. Invalid CSS selectors make screenshot masking fail closed rather than capturing an unmasked screenshot. Closed Shadow DOM cannot be inspected; mask the component host if it may display protected data.

## 7. Start and operate a test session

### 7.1 Start the session

1. Verify the intended application tab is still active.
2. Review the environment and traceability details.
3. Review screenshot, video, audio, masking, and payload choices.
4. Select **Start session**, or **Start session with video** when video is enabled.
5. Confirm the panel status changes to **Recording**.
6. Confirm evidence counters are visible.
7. When video is enabled, confirm the panel shows **Recording this tab** and Chromium shows a recording indicator.
8. Add an opening note with the scenario and relevant preconditions.

Only one extension recording session can be active at a time.

### 7.2 Capture manual screenshots

Manual screenshots are the recommended way to create intentional checkpoints:

1. Return to the recorded tab.
2. Keep its browser window focused.
3. Put the application in the state that proves the test step.
4. Remove unrelated notifications or personal information from view.
5. In the panel, replace **Manual checkpoint** with a useful label, such as `Login completed` or `Validation error displayed`.
6. Select **Capture screenshot**.
7. Wait for the screenshot count to increase and check for a notice or error.

A screenshot captures only the visible viewport, not a stitched full page. TestWitness temporarily covers configured sensitive regions, captures the visible tab, and removes the covers immediately. It deliberately refuses to capture if the recorded tab is not the visible tab in the focused window.

### 7.3 Use automatic screenshots

Enable **Automatic screenshots** before starting when the test plan needs navigation checkpoints. The current MVP attempts a screenshot:

1. Shortly after the session starts.
2. After detected same-document navigation, including History API, `popstate`, and hash changes.
3. After a full page load when access reconnects.

Automatic screenshots still require the recorded tab and its browser window to be visible. When the target is not visible or masking cannot be confirmed, TestWitness records a recoverable session notice instead of capturing an unrelated or unmasked screen.

Automatic capture is not a replacement for manually labeled checkpoints. Use manual screenshots for acceptance criteria and defect evidence.

### 7.4 Record optional tab video and audio

Video is disabled by default. To record it:

1. Before starting, enable **Record browser-tab video**.
2. Enable **Include tab audio** only when audio is required and explicitly approved.
3. Select **Start session with video**.
4. Confirm the panel displays **Recording this tab**.
5. Confirm Chrome or Edge displays its native tab-recording indicator.
6. Run the scenario in the selected tab.
7. Use **Pause** and **Resume** as needed; video follows the evidence-session state.
8. Finish the session normally.
9. Verify `recording.webm` exists in the ZIP and plays locally.

The current UI limits video to 30 minutes. Reaching the duration limit, closing the tab, manually ending browser capture, or a recorder error finalizes any available chunks and stops media tracks. A video failure does not discard screenshots, actions, logs, requests, or notes. Audio can contain speech, media, and other sensitive content; leave it off unless necessary.

Automated unit tests mock media APIs. They do not prove that a workstation's real tab-capture permission, enterprise policy, codec, audio path, or WebM playback works. Test video manually in both Chrome and Edge before release use.

### 7.5 Opt in to request and response payloads

If a report shows **Disabled by configuration**, body capture was off when that session started. To enable it:

1. Finish the current session.
2. Start a new session setup.
3. Expand **Privacy and advanced capture**.
4. Under **High-risk diagnostic options**, enable **Capture sanitized request bodies**, **Capture sanitized response bodies**, or both.
5. Start the new session.
6. Repeat the API action after instrumentation is active.
7. Verify the resulting report before sharing it.

Use payload capture only with explicit approval. Mandatory redaction remains active for authorization, cookies, passwords, access/refresh tokens, API keys, CSRF/XSRF tokens, session identifiers, hidden inputs, and file inputs. Application-specific secrets may require additional sensitive query-parameter names or masking rules.

Payload limitations in Standard v0.1.1 include:

- GET requests commonly have no request body.
- Bodies are bounded to 64 KiB and can be marked truncated.
- Body reads have a time limit and may be unavailable.
- Binary, opaque, CORS-protected, oversized, or browser-controlled responses may be omitted or unavailable.
- Images, media streaming, beacons, worker traffic, navigation requests, and requests made before instrumentation are outside normal Fetch/XHR coverage.
- Browser-level response bodies are not captured through a debugger/CDP permission in the Standard edition.

Interpret the body status shown in the report:

| Report status                      | Meaning                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| **Disabled by configuration**      | The relevant opt-in was off when the session started.                       |
| **Captured and sanitized**         | A bounded, sanitized representation is present.                             |
| **No body**                        | The browser exposed an empty body.                                          |
| **Unavailable to page JavaScript** | Capture was enabled, but the browser/page API did not expose a usable body. |
| **Binary body omitted**            | The content was treated as binary and not added to the report.              |
| **Captured and truncated**         | Only the bounded portion was retained.                                      |

## 8. Record notes, pause, resume, and set the result

### 8.1 Add useful tester notes

Use **Add tester note** to record information that automated capture cannot explain:

1. Enter the expected behavior.
2. State the actual behavior when it differs.
3. Record preconditions, test-data aliases, feature flags, or reproducibility details without including secrets.
4. Select **Add note**. `Ctrl+Enter` or `Command+Enter` also submits the note.

Notes can be added while the session is recording or paused. Do not paste passwords, tokens, customer records, or unnecessary personal data into notes.

### 8.2 Pause and resume

1. Select **Pause** before unrelated browsing, interruptions, or setup work that should not become evidence.
2. Confirm the panel status says **Paused**.
3. Complete the unrelated activity.
4. Return to the recorded application tab.
5. Select **Resume**.
6. Confirm the status returns to **Recording**.

Pause stops new action, console, network, and video recording while preserving existing evidence. Manual screenshots are unavailable while paused. Notes and the session result remain editable.

### 8.3 Select the test result

Choose one result before finishing:

- **Passed**: observed behavior met the approved test expectation.
- **Failed**: observed behavior did not meet the test expectation.
- **Blocked**: the test could not be completed because of an environment, dependency, access, or other blocker.
- **Not set**: no verdict was selected. Use this only when your process intentionally permits it.

For **Failed** or **Blocked**, add a note explaining the outcome and include a manually labeled screenshot when safe and relevant. Technical errors in the report do not automatically determine the tester's verdict.

## 9. Finish and download evidence

1. Review the result, notes, counters, and session notices.
2. Select **Finish**.
3. Review the confirmation dialog.
4. Select **Finish and prepare evidence**. Select **Continue testing** instead if more steps remain.
5. Wait for **Evidence is ready**.
6. Select **Download evidence ZIP**.
7. Choose an approved local destination in the browser save dialog.
8. Wait for the browser download to complete.
9. Open and verify the ZIP before selecting **Start a new session**, updating, or uninstalling the extension.

Finishing restores page instrumentation and finalizes available video. The extension uses a unique filename if a file with the same name already exists.

## 10. Verify the ZIP and offline report

Do not attach evidence to a defect, test run, email, or shared location until every applicable check passes.

### 10.1 Archive structure checklist

1. Confirm the ZIP opens without an archive error.
2. Confirm `report.html` exists.
3. Confirm `metadata.json` exists.
4. Confirm `actions.json`, `console-logs.json`, `network-requests.json`, `network-errors.json`, and `notes.json` exist.
5. Confirm `screenshots/` contains the expected numbered images.
6. If video was enabled and completed, confirm `recording.webm` exists.
7. Extract the entire archive before reviewing linked images or video; do not open only `report.html` from inside an archive viewer.

### 10.2 Report content checklist

1. Open the extracted `report.html` without a web server or internet connection.
2. Verify application, environment, release, test case, requirement, tester, URL, browser, operating system, start/end time, duration, and session result.
3. Verify the decision overview and evidence counters are plausible.
4. Review **Capture health** and all recorder warnings.
5. Follow the timeline and confirm the recorded actions match the performed scenario.
6. Review network endpoints, outcomes, status codes, timings, headers, and body-capture states.
7. Verify failed requests and console warnings/errors correspond to the test window.
8. Verify screenshot labels and timestamps, and inspect every screenshot for correct masking.
9. Verify tester notes are accurate and contain no secrets or unnecessary personal data.
10. If video exists, play it from beginning to end and confirm audio is present only when approved.
11. Confirm headers and query parameters containing secrets appear redacted.
12. Confirm payloads appear only when explicitly enabled and are acceptably sanitized.
13. Compare report summaries with the JSON files when the evidence will support a high-impact decision.

A zero count does not prove an event never occurred. Capture may have been disabled, paused, blocked, unavailable, or outside Fetch/XHR/page instrumentation coverage.

If any evidence violates privacy or retention policy, do not distribute it. Delete the archive from shared locations and local trash as required, then repeat the session with stricter settings.

## 11. Update, reload, or uninstall

### 11.1 Reload after a local rebuild

1. Finish active sessions and download required evidence.
2. Run the project's validation/build command.
3. Open `chrome://extensions` or `edge://extensions`.
4. Select **Reload** on the TestWitness card.
5. Reload the application tab so the new bridge can be injected.
6. Click the TestWitness extension icon and launch it for that tab again.
7. Confirm the displayed version and run the smoke test in section 14.

A reload normally keeps extension-origin storage, but do not rely on it as a backup.

### 11.2 Clean update to another release

1. Finish all sessions.
2. Download and verify every ZIP that must be retained.
3. Record the installed version and source of the replacement build.
4. Remove the old extension.
5. Extract the new trusted package to a new stable directory.
6. Follow the Chrome or Edge installation steps.
7. Confirm the new version before testing.
8. Run the release smoke-test checklist.

Removing and reinstalling can delete the extension's IndexedDB evidence. A clean update is intentionally treated as destructive to unsaved local evidence.

### 11.3 Uninstall

1. Finish any active session.
2. Download and verify required evidence.
3. Close the TestWitness panel.
4. Open `chrome://extensions` or `edge://extensions`.
5. Select **Remove** for TestWitness and confirm.
6. Delete extracted extension files and downloaded evidence only according to your team's retention policy.

There is no remote TestWitness copy to recover after uninstall or local data deletion.

## 12. Troubleshooting decision table

| Symptom                                                     | Most likely cause                                                                                                 | What the QA operator should do                                                                                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capture unavailable** or **Site access is not available** | The launcher was not invoked for the active tab, or the browser did not expose the URL.                           | Select the target HTTP/HTTPS tab, click the TestWitness icon, confirm v0.1.1, and choose **Open TestWitness for this tab**. Do not use only the general side-panel button.            |
| **No active tab**                                           | No eligible focused tab was visible to the launcher.                                                              | Focus the target browser window and tab, close/reopen the launcher, and retry.                                                                                                        |
| Active tab does not expose a URL                            | Temporary `activeTab` access was not granted or browser policy withheld it.                                       | Use the toolbar/Extensions-menu launcher on that exact tab. If policy still blocks it, review **Extension details → Site access** with your administrator and reload the page.        |
| **Start session** remains disabled                          | The page is unsupported, tab access is missing, or another operation is busy.                                     | Populate application and environment, then read the status/error text. Move to a normal HTTP/HTTPS page and repeat the launcher flow. No other metadata field is mandatory.           |
| Browser settings/store/new-tab page will not start          | Chromium forbids extension instrumentation on privileged pages.                                                   | Test the actual HTTP/HTTPS application page instead. This is expected behavior.                                                                                                       |
| Public site such as YouTube will not start                  | The panel was opened without the launcher gesture, or enterprise policy/site access blocks injection.             | Keep the site active, use the TestWitness icon and launcher, reload the site, and test first with video off. If permitted, allow that site under extension **Details → Site access**. |
| Start fails after navigation                                | The application crossed to another origin and temporary access was revoked.                                       | Click the TestWitness icon on the new origin, grant access again, and note any capture gap.                                                                                           |
| Screenshot says target tab/window is inactive               | Another tab or window is visible.                                                                                 | Return to the recorded tab, focus its browser window, and retry. This safeguard prevents capturing the wrong page.                                                                    |
| Screenshot fails with an invalid selector                   | A mask/exclude entry is not valid CSS.                                                                            | Finish the session, correct the selector in a new setup, and retry. The failed capture is intentional privacy protection.                                                             |
| Expected automatic screenshot is missing                    | The tab/window was not visible, page access was reconnecting, or masking failed.                                  | Review **Session notices**. Add a manual screenshot while the target is visible.                                                                                                      |
| Video shows **Video unavailable**                           | `tabCapture`, offscreen recording, MediaRecorder/WebM, policy, or another extension prevented capture.            | Continue the evidence session, since other capture remains active. Retry a new session after checking browser version, policy, and conflicting extensions. Run a manual video test.   |
| ZIP has no `recording.webm`                                 | Video was not enabled before start, did not begin, or ended without usable chunks.                                | Confirm **Record browser-tab video** before a new session and verify both the panel and browser recording indicators.                                                                 |
| Report says **Disabled by configuration** for payload       | Request or response body opt-in was off at session start.                                                         | Finish, start a new session, enable the required high-risk body option, and repeat the request.                                                                                       |
| Payload says unavailable, binary omitted, or truncated      | Browser/CORS/content type/time/64 KiB limits prevented full capture.                                              | Use available metadata and server logs if approved. Do not weaken browser security controls.                                                                                          |
| Expected API request is absent                              | It occurred before instrumentation, while paused, in a worker/beacon/navigation/media path, or outside Fetch/XHR. | Repeat it after session start and resume. Document remaining coverage limits in a note.                                                                                               |
| Changes are not visible after rebuilding                    | The unpacked extension or page still runs old bundles.                                                            | Reload TestWitness on the extensions page, reload the target page, and repeat the launcher flow.                                                                                      |
| Download does not start                                     | Browser download permission/policy, storage, or ZIP generation failed.                                            | Read the panel error, verify browser download settings and free space, keep the completed session intact, and retry before uninstalling.                                              |
| Report opens but images/video do not                        | `report.html` was opened directly inside the ZIP or files were moved separately.                                  | Extract the entire ZIP and keep its internal folder structure together.                                                                                                               |

When escalating a problem, provide the browser/version, operating system, extension version, target URL origin without secrets, exact panel error, reproduction steps, and whether video/payload options were enabled. Do not send sensitive evidence unless the recipient and channel are approved.

## 13. Privacy approval checklist

The test owner and QA operator should complete this checklist before capture:

- [ ] The test has an approved purpose and evidence owner.
- [ ] The target is a non-production environment, or production capture has explicit approval.
- [ ] Test accounts and synthetic/minimized data are used where possible.
- [ ] Retention duration and approved storage location are known.
- [ ] Distribution recipients are authorized to see the evidence.
- [ ] Required application-specific mask selectors were identified and tested.
- [ ] Additional sensitive query-parameter names were added.
- [ ] Closed Shadow DOM hosts and embedded content were considered.
- [ ] Video is enabled only when continuous visual evidence is necessary.
- [ ] Audio is enabled only when essential and all affected parties/policies allow it.
- [ ] Request/response bodies remain off unless payload evidence is approved and necessary.
- [ ] The operator understands that sanitization cannot guarantee removal of every application-specific secret.
- [ ] The operator will inspect every screenshot, note, payload, and recording before sharing.
- [ ] A deletion process exists for rejected or expired evidence.

Always-redacted categories include authorization and proxy authorization, cookies and Set-Cookie, passwords, access and refresh tokens, API keys and client secrets, CSRF/XSRF tokens, and session identifiers in headers or query parameters. Do not intentionally place these values in free-form notes.

## 14. Release smoke-test checklist

Run this checklist on the supported current Chrome and Edge versions before distributing a new extension build. Use a controlled local or QA page with safe synthetic data.

### 14.1 Installation and launcher

- [ ] Install from a clean browser profile or remove the prior TestWitness build first.
- [ ] Confirm the extension name and expected version.
- [ ] Confirm there are no manifest or service-worker errors.
- [ ] Open a normal HTTP/HTTPS page and use the TestWitness icon.
- [ ] Confirm the launcher identifies the active tab and displays the expected version.
- [ ] Select **Open TestWitness for this tab** and confirm the side panel shows **Ready**.
- [ ] Confirm a restricted browser page is rejected with a clear message.

### 14.2 Session setup and structured evidence

- [ ] Confirm application name and environment are the only mandatory fields.
- [ ] Start a session without video and with payload bodies off.
- [ ] Trigger a click, input change, form submission, navigation, console warning, and console error.
- [ ] Trigger one successful Fetch/XHR request and one failed request.
- [ ] Confirm counters change plausibly.
- [ ] Pause, generate activity, and confirm it is not captured.
- [ ] Resume and confirm new activity is captured.
- [ ] Add a note and select each result option at least once; leave the intended final result selected.

### 14.3 Screenshot privacy

- [ ] Display a synthetic secret in an element matching `[data-sensitive]`.
- [ ] Capture a manually labeled screenshot.
- [ ] Confirm the synthetic secret is covered in the exported image.
- [ ] Confirm password and one-time-code inputs are covered.
- [ ] Confirm an embedded frame is covered as a whole.
- [ ] Enable automatic screenshots in a new session and verify start/navigation checkpoints.
- [ ] Switch away from the recorded tab and confirm screenshot capture refuses rather than capturing the wrong tab.
- [ ] Supply an invalid selector in a controlled test and confirm capture fails closed.

### 14.4 Payload opt-in

- [ ] With body capture off, confirm the report says **Disabled by configuration**.
- [ ] Start a new approved session with request and response bodies enabled.
- [ ] Trigger a small JSON request/response and confirm its sanitized form is reported.
- [ ] Confirm authorization, cookie, token, and sensitive query values remain redacted.
- [ ] Exercise a binary or oversized response and confirm its limitation state is clear.

### 14.5 Real browser video

- [ ] Start a separate session with video on and audio off.
- [ ] Confirm the browser displays a tab-recording indicator.
- [ ] Pause and resume; confirm the panel and recording state follow the session.
- [ ] Finish and confirm `recording.webm` exists and plays.
- [ ] Repeat with approved synthetic tab audio and verify playback.
- [ ] Manually stop capture using the browser indicator; confirm other evidence continues and the panel/report shows a video notice.
- [ ] Confirm all media tracks stop after finish, duration limit, manual stop, tab close, and recorder error where practical.

These are manual tests. Unit tests with mocked media APIs are not a substitute for this matrix.

### 14.6 Export and cleanup

- [ ] Finish the session and download the ZIP.
- [ ] Extract it and open `report.html` offline.
- [ ] Verify metadata, result, timeline, endpoint summaries, issues, notes, screenshots, JSON files, and optional video.
- [ ] Confirm displayed values are escaped and no HTML supplied by the test page executes in the report.
- [ ] Confirm evidence remains local and no unexpected upload occurs.
- [ ] Reload the extension and application page, then complete another short session.
- [ ] Uninstall the extension after preserving approved evidence and confirm no TestWitness controls remain.

Record the browser build, operating system, extension archive checksum, date, tester, pass/fail outcome, and any enterprise policies for each smoke-test run.

## 15. Operational limitations to communicate

Before relying on a TestWitness archive, reviewers should understand:

1. Screenshots cover the visible viewport, not the entire scrolling document.
2. Capture is tab-scoped and can have gaps after cross-origin navigation or when paused.
3. Page actions, console messages, and Fetch/XHR evidence come from an application-controlled JavaScript realm and are not tamper-proof audit records.
4. Closed Shadow DOM and browser-controlled/worker/network paths have limited observability.
5. The Standard edition does not use broad `<all_urls>`, `webRequest`, or debugger/CDP permissions.
6. Firefox and Safari extension packages are not included in v0.1.1.
7. There is no store listing yet and no automatic store-update channel.
8. There is no backend upload, organization-wide evidence repository, or cloud recovery in this MVP.

Use TestWitness as a structured QA evidence aid. Correlate critical findings with application logs, server telemetry, test-management records, and approved observability systems when necessary.
