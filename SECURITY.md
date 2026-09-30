# Security Policy

TestWitness captures diagnostic evidence from browser sessions. Security and privacy issues can therefore expose credentials, personal information, proprietary application data, or test artifacts and should be handled carefully.

## Supported versions

Security fixes are applied to the latest released version and the current default branch. Users should reproduce an issue with the latest version before reporting it when it is safe to do so.

## Reporting a vulnerability

Do not include vulnerability details, credentials, captured evidence, customer information, or proof-of-concept exploits in a public issue.

1. Open this repository's **Security** tab.
2. Open **Advisories**.
3. Select **Report a vulnerability** and submit the report through GitHub Private Vulnerability Reporting, if that option is enabled.
4. Include the affected version, browser and version, impact, reproducible steps, and a minimal proof of concept using synthetic data.

If private vulnerability reporting is not enabled, open a minimal public issue asking the maintainers for a secure reporting channel. State only that you have a potential security issue and how maintainers can contact you through your GitHub account. Do not disclose the vulnerability or attach evidence in that issue.

Please allow maintainers time to acknowledge and investigate the report before publishing details. Do not test against systems, accounts, or data you do not own or have explicit authorization to assess.

## Privacy-sensitive risks

Reports are especially valuable for defects involving:

- Failure to redact passwords, authorization headers, cookies, session identifiers, access or refresh tokens, API keys, or CSRF tokens
- Sensitive query parameters or request/response fields appearing in exports
- Screenshot masks failing or page content being captured before masking is active
- Evidence from one tab, origin, or session being exposed to another
- Media tracks, object URLs, patched browser APIs, or event listeners remaining active after capture stops
- Unauthorized capture caused by overly broad permissions or missing user consent
- HTML report injection, unsafe filenames, or malicious ZIP contents
- Evidence persistence or downloads occurring after the user cancels or ends a session

Request and response body capture is intentionally disabled by default because payloads can contain sensitive business and personal data. When diagnosing capture behavior, use synthetic test data, enable only the minimum required options, inspect artifacts locally, and delete them when no longer needed.

If a secret is exposed in an evidence archive, stop sharing the archive, securely delete accessible copies, and rotate or revoke the exposed credential immediately. A redacted report is not automatically safe to publish; review every artifact before sharing it.
