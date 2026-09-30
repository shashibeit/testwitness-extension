# Changelog

All notable changes to TestWitness Extension Standard are documented here.

## 0.1.1 - 2026-09-28

Initial public MVP release.

### Added

- Manifest V3 extension packages for Google Chrome and Microsoft Edge.
- Privacy-scoped launcher popup that grants access only after an explicit tester action.
- Side-panel controls for sessions, screenshots, video, notes, results, and evidence download.
- Fetch/XMLHttpRequest, console, tester-action, screenshot, and optional tab-video evidence.
- IndexedDB persistence and offline TestWitness HTML/ZIP reports.
- Per-session opt-in controls for sanitized request and response payload capture.

### Security and privacy

- Request and response payloads, video, and audio default to disabled.
- Mandatory redaction for credentials, cookies, passwords, tokens, API keys, and session identifiers.
- Screenshot masking for configured selectors, password fields, embedded content, and accessible open Shadow DOM.
- No backend upload or telemetry.

### Fixed

- Active-tab refresh after changing tabs or focused windows.
- Migration from the older direct side-panel behavior to the permission-granting launcher popup.
- Media-track cleanup when recorder startup fails.
- Page-recorder startup acknowledgement and evidence-storage failure reporting.
