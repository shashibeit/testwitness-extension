# Contributing to TestWitness Extension Standard

Thank you for helping TestWitness make evidence collection safer and easier for QA teams and developers.

## Before you begin

By contributing, you agree that your contribution may be distributed under the project's MIT License. Keep all changes privacy-first: the extension can observe application activity, so a seemingly small change can affect credentials, personal data, or test evidence.

For security vulnerabilities, do not open a public issue containing sensitive details. Follow [SECURITY.md](SECURITY.md) instead.

## Prerequisites

- Node.js 20.19 or newer
- npm
- A current Chrome or Microsoft Edge installation for manual extension testing
- Git

## Repository layout and core dependency

This project remains separate from the TestWitness core SDK and uses the exact public `@testwitness/core` version recorded in `package.json` and `package-lock.json`. A core checkout is not required for normal extension development:

```bash
git clone https://github.com/shashibeit/testwitness-extension.git
cd testwitness-extension
npm ci
npm run validate
```

For coordinated, unpublished changes in both repositories, the projects may be checked out as siblings:

```text
workspace/
├── testwitness/
└── testwitness-extension/
```

Build and temporarily link the local core package without changing the committed dependency:

```bash
cd testwitness
npm ci
npm run build
npm link

cd ../testwitness-extension
npm ci
npm link @testwitness/core
npm run validate
```

Run `npm ci` in the extension afterward to restore the pinned registry package. Do not commit a temporary link or generated `node_modules`, `dist`, coverage, artifact, or ZIP files. Upgrade the pinned core version deliberately, regenerate the lockfile, and validate the complete extension before committing.

## Development commands

Run these commands from `testwitness-extension`:

| Command                | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm run test`         | Run unit and integration tests once.                                          |
| `npm run test:watch`   | Run tests while files change.                                                 |
| `npm run typecheck`    | Check TypeScript without emitting files.                                      |
| `npm run lint`         | Run ESLint.                                                                   |
| `npm run format:check` | Verify Prettier formatting.                                                   |
| `npm run format`       | Apply Prettier formatting.                                                    |
| `npm run build`        | Build and validate the unpacked Manifest V3 extension in `dist`.              |
| `npm run package`      | Build Chrome and Edge installation ZIPs.                                      |
| `npm run validate`     | Run tests, type checking, linting, formatting checks, and a production build. |

## Testing in Chrome or Edge

1. Build the extension with `npm run build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository's `dist` directory.
5. Open a non-production HTTP or HTTPS test application.
6. Invoke TestWitness from its toolbar icon, open the side panel, and exercise the affected workflow.
7. After rebuilding, reload the extension and refresh the target tab before retesting.

For capture changes, manually verify start, pause, resume, stop, screenshot, report download, and cleanup. Real tab video capture and browser permission behavior require manual testing; mocked media tests are not a substitute.

Never use production customer data for contribution testing. Use synthetic accounts and inspect the generated report and JSON files to confirm that passwords, authorization values, cookies, API keys, CSRF tokens, and other configured secrets are not present.

## Making a change

- Keep the extension framework-independent and compatible with Manifest V3.
- Preserve original page behavior when instrumenting browser APIs.
- Restore listeners, patched functions, object URLs, and media tracks during cleanup.
- Keep request and response body capture disabled by default.
- Add or update tests for behavior changes and failure paths.
- Update user documentation when setup, permissions, privacy behavior, or limitations change.
- Avoid broad host permissions unless the behavior cannot be implemented safely with narrower permissions.

Before opening a pull request, run:

```bash
npm run validate
```

## Pull requests

Include:

- A concise description of the user problem and solution
- Testing performed, including browser and version for manual checks
- Privacy, permission, and compatibility impact
- Screenshots for visible UI changes
- Known limitations or follow-up work

Keep pull requests focused. Maintainers may ask for changes when a contribution expands permissions, captures additional data, or cannot demonstrate reliable cleanup.
