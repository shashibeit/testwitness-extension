import type { SessionResultStatus } from "@testwitness/core";

import { downloadEvidence } from "../evidence/download";
import {
  PROTOCOL_VERSION,
  type RuntimeResponse,
  type StateChangedMessage,
} from "../shared/protocol";
import type {
  ExtensionStateSnapshot,
  StartSessionInput,
} from "../shared/types";
import { IndexedDbEvidenceRepository } from "../storage/IndexedDbEvidenceRepository";

import "./styles.css";

const repository = new IndexedDbEvidenceRepository();
const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("TestWitness side-panel root was not found.");

root.innerHTML = `
  <a class="skip-link" href="#session-controls">Skip to session controls</a>
  <header class="app-header">
    <div class="brand-mark" aria-hidden="true">TW</div>
    <div>
      <div class="brand-title">TestWitness</div>
      <div class="brand-subtitle">Extension Standard</div>
    </div>
  </header>

  <div id="operation-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
  <div id="error-alert" class="alert alert-error" role="alert" hidden></div>

  <main class="panel-main">
    <section class="card status-card" aria-labelledby="status-heading">
      <div class="status-row">
        <span id="status-dot" class="status-dot" aria-hidden="true"></span>
        <div>
          <h1 id="status-heading">Ready</h1>
          <p id="status-detail">Choose a web application tab to begin.</p>
        </div>
        <time id="elapsed-time" datetime="PT0S">00:00</time>
      </div>
      <div class="tab-context">
        <strong id="tab-title">Loading active tab…</strong>
        <span id="tab-origin"></span>
      </div>
    </section>

    <form id="start-form" class="view-stack" novalidate>
      <section class="card" aria-labelledby="capture-heading">
        <div class="card-heading">
          <div>
            <p class="eyebrow">Capture this tab</p>
            <h2 id="capture-heading">Session setup</h2>
          </div>
          <span class="privacy-chip">Local only</span>
        </div>
        <label>
          <span>Application name</span>
          <input id="application-name" name="applicationName" required maxlength="200" autocomplete="off" />
        </label>
        <div class="field-grid">
          <label>
            <span>Environment</span>
            <input id="environment" name="environment" value="test" required maxlength="100" autocomplete="off" />
          </label>
          <label>
            <span>Release version</span>
            <input id="release-version" name="releaseVersion" maxlength="200" autocomplete="off" />
          </label>
        </div>
      </section>

      <section class="card" aria-labelledby="choices-heading">
        <h2 id="choices-heading">Capture choices</h2>
        <label class="switch-row">
          <span>
            <strong>Record browser-tab video</strong>
            <small>Disabled by default. Chrome or Edge will show a tab-recording indicator.</small>
          </span>
          <input id="capture-video" type="checkbox" role="switch" />
        </label>
        <label class="switch-row nested-option" id="audio-option">
          <span>
            <strong>Include tab audio</strong>
            <small>Audio is disabled by default.</small>
          </span>
          <input id="include-audio" type="checkbox" role="switch" disabled />
        </label>
        <label class="switch-row">
          <span>
            <strong>Automatic screenshots</strong>
            <small>Capture at session start and after detected navigation.</small>
          </span>
          <input id="automatic-screenshots" type="checkbox" role="switch" />
        </label>
      </section>

      <details class="card disclosure">
        <summary>Optional session details</summary>
        <div class="details-content">
          <div class="field-grid">
            <label><span>Test case ID</span><input id="test-case-id" maxlength="200" /></label>
            <label><span>Requirement ID</span><input id="requirement-id" maxlength="200" /></label>
          </div>
          <label><span>Test case name</span><input id="test-case-name" maxlength="300" /></label>
          <div class="field-grid">
            <label><span>Tester name</span><input id="tester-name" maxlength="200" /></label>
            <label><span>Employee ID</span><input id="tester-id" maxlength="200" /></label>
          </div>
        </div>
      </details>

      <details class="card disclosure">
        <summary>Privacy and advanced capture</summary>
        <div class="details-content">
          <p class="guidance">Passwords, authorization, cookies, API keys, CSRF tokens, and sensitive query parameters are always redacted.</p>
          <label>
            <span>Mask selectors <small>one CSS selector per line</small></span>
            <textarea id="mask-selectors" rows="3" spellcheck="false">[data-sensitive]
.testwitness-mask</textarea>
          </label>
          <label>
            <span>Exclude selectors <small>one CSS selector per line</small></span>
            <textarea id="exclude-selectors" rows="2" spellcheck="false"></textarea>
          </label>
          <label>
            <span>Additional sensitive query parameters <small>one name per line</small></span>
            <textarea id="sensitive-query" rows="2" spellcheck="false"></textarea>
          </label>
          <div class="risk-box">
            <strong>High-risk diagnostic options</strong>
            <label class="check-row"><input id="request-bodies" type="checkbox" /> Capture sanitized request bodies</label>
            <label class="check-row"><input id="response-bodies" type="checkbox" /> Capture sanitized response bodies</label>
            <small>Keep these disabled unless the test specifically requires payload evidence.</small>
          </div>
        </div>
      </details>

      <button id="start-button" class="button button-primary button-full" type="submit">Start session</button>
      <p id="start-help" class="helper">Actions, console warnings/errors, and Fetch/XHR activity will be captured and sanitized.</p>
    </form>

    <div id="active-view" class="view-stack" hidden>
      <section id="session-controls" class="card session-controller" aria-labelledby="controls-heading">
        <div class="card-heading compact">
          <div>
            <p class="eyebrow">Active session</p>
            <h2 id="controls-heading">Capture controls</h2>
          </div>
          <span id="video-state" class="video-state">Video off</span>
        </div>
        <div class="button-row">
          <button id="pause-button" class="button button-secondary" type="button">Pause</button>
          <button id="finish-button" class="button button-danger-outline" type="button">Finish</button>
        </div>
      </section>

      <section class="metrics" aria-label="Evidence counters">
        <div class="metric"><strong id="count-screenshots">0</strong><span>Screenshots</span></div>
        <div class="metric"><strong id="count-actions">0</strong><span>Actions</span></div>
        <div class="metric"><strong id="count-requests">0</strong><span>Requests</span></div>
        <div class="metric"><strong id="count-issues">0</strong><span>Issues</span></div>
      </section>

      <section class="card" aria-labelledby="screenshot-heading">
        <h2 id="screenshot-heading">Capture a checkpoint</h2>
        <label><span>Screenshot label</span><input id="screenshot-label" maxlength="200" value="Manual checkpoint" /></label>
        <button id="screenshot-button" class="button button-primary button-full" type="button">Capture screenshot</button>
        <p id="screenshot-help" class="helper"></p>
      </section>

      <section class="card" aria-labelledby="note-heading">
        <h2 id="note-heading">Add tester note</h2>
        <label class="sr-only" for="note-text">Tester note</label>
        <textarea id="note-text" rows="3" maxlength="4000" placeholder="What did you validate or observe?"></textarea>
        <button id="add-note-button" class="button button-secondary button-full" type="button">Add note</button>
      </section>

      <section class="card" aria-labelledby="result-heading">
        <fieldset id="result-fieldset">
          <legend id="result-heading">Session result</legend>
          <div class="result-options">
            <label><input type="radio" name="result" value="not-set" checked /><span>Not set</span></label>
            <label><input type="radio" name="result" value="passed" /><span>Passed</span></label>
            <label><input type="radio" name="result" value="failed" /><span>Failed</span></label>
            <label><input type="radio" name="result" value="blocked" /><span>Blocked</span></label>
          </div>
        </fieldset>
      </section>

      <section id="warnings-card" class="card warning-card" aria-labelledby="warnings-heading" hidden>
        <h2 id="warnings-heading">Session notices</h2>
        <ul id="warnings-list"></ul>
      </section>
    </div>

    <div id="complete-view" class="view-stack" hidden>
      <section class="card completion-card" aria-labelledby="complete-heading">
        <span id="result-badge" class="result-badge">Not set</span>
        <h2 id="complete-heading">Evidence is ready</h2>
        <p id="complete-summary"></p>
        <button id="download-button" class="button button-primary button-full" type="button">Download evidence ZIP</button>
        <button id="new-session-button" class="button button-secondary button-full" type="button">Start a new session</button>
      </section>
    </div>
  </main>

  <footer class="app-footer">Evidence stays in this browser until you download or remove it.</footer>

  <dialog id="finish-dialog" aria-labelledby="finish-dialog-heading">
    <form method="dialog" class="dialog-card">
      <h2 id="finish-dialog-heading">Finish this session?</h2>
      <p id="finish-dialog-summary">TestWitness will restore page instrumentation and prepare the evidence.</p>
      <div class="dialog-actions">
        <button class="button button-secondary" value="cancel">Continue testing</button>
        <button id="confirm-finish" class="button button-danger" value="confirm">Finish and prepare evidence</button>
      </div>
    </form>
  </dialog>
`;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing side-panel element: ${selector}`);
  return value;
}

const startForm = element<HTMLFormElement>("#start-form");
const activeView = element<HTMLDivElement>("#active-view");
const completeView = element<HTMLDivElement>("#complete-view");
const errorAlert = element<HTMLDivElement>("#error-alert");
const operationStatus = element<HTMLDivElement>("#operation-status");
const finishDialog = element<HTMLDialogElement>("#finish-dialog");
let currentState: ExtensionStateSnapshot | undefined;
let busy = false;
let showNewSessionForm = false;

function input(selector: string): HTMLInputElement {
  return element<HTMLInputElement>(selector);
}

function textarea(selector: string): HTMLTextAreaElement {
  return element<HTMLTextAreaElement>(selector);
}

function announce(message: string): void {
  operationStatus.textContent = "";
  window.setTimeout(() => {
    operationStatus.textContent = message;
  }, 0);
}

function showError(message: string): void {
  errorAlert.textContent = message;
  errorAlert.hidden = false;
}

function clearError(): void {
  errorAlert.hidden = true;
  errorAlert.textContent = "";
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function textValue(selector: string): string | undefined {
  const value = input(selector).value.trim();
  return value || undefined;
}

async function sendPanel<T>(message: object): Promise<T> {
  const response: RuntimeResponse<T> = await chrome.runtime.sendMessage({
    version: PROTOCOL_VERSION,
    ...message,
  });
  if (!response?.ok)
    throw new Error(
      response?.error.message ?? "The extension did not respond.",
    );
  return response.data;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
}

function elapsedMilliseconds(): number {
  const session = currentState?.session;
  if (!session) return 0;
  if (session.metadata.endedAt) return session.metadata.durationMs;
  return Date.now() - new Date(session.metadata.startedAt).getTime();
}

function updateTimer(): void {
  const timer = element<HTMLTimeElement>("#elapsed-time");
  const elapsed = elapsedMilliseconds();
  timer.textContent = formatDuration(elapsed);
  timer.dateTime = `PT${Math.floor(elapsed / 1_000)}S`;
}

function videoLabel(state: string): string {
  const labels: Record<string, string> = {
    off: "Video off",
    "requesting-permission": "Starting tab video…",
    recording: "● Recording this tab",
    paused: "Video paused",
    finalizing: "Saving video…",
    captured: "Video saved",
    unavailable: "Video unavailable",
  };
  return labels[state] ?? "Video off";
}

function setBusy(value: boolean): void {
  busy = value;
  for (const control of document.querySelectorAll<
    | HTMLButtonElement
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
  >("button, input, textarea, select")) {
    if (control.id === "include-audio" && !input("#capture-video").checked)
      continue;
    control.disabled = value;
  }
  if (!value)
    input("#include-audio").disabled = !input("#capture-video").checked;
}

function render(state: ExtensionStateSnapshot): void {
  currentState = state;
  const session = state.session;
  const isComplete =
    session?.phase === "stopped" || session?.phase === "failed";
  const isActive = Boolean(session && !isComplete);
  const showStart = !isActive && (!isComplete || showNewSessionForm);

  startForm.hidden = !showStart;
  activeView.hidden = !isActive;
  completeView.hidden = !isComplete || showNewSessionForm;
  element("#tab-title").textContent = state.activeTab.title;
  element("#tab-origin").textContent =
    state.activeTab.origin || state.activeTab.reason || "";
  const startButton = element<HTMLButtonElement>("#start-button");
  startButton.disabled = busy || !state.activeTab.supported;
  element("#start-help").textContent = state.activeTab.supported
    ? "Actions, console warnings/errors, and Fetch/XHR activity will be captured and sanitized."
    : (state.activeTab.reason ?? "This page cannot be captured.");
  if (!input("#application-name").value && state.activeTab.origin) {
    try {
      input("#application-name").value = new URL(state.activeTab.url).hostname;
    } catch {
      input("#application-name").value = state.activeTab.title;
    }
  }

  const statusHeading = element("#status-heading");
  const statusDetail = element("#status-detail");
  const statusDot = element("#status-dot");
  statusDot.className = "status-dot";

  if (!session || showNewSessionForm) {
    statusHeading.textContent = state.activeTab.supported
      ? "Ready"
      : "Capture unavailable";
    statusDetail.textContent = state.activeTab.supported
      ? "Configure evidence capture for the active tab."
      : (state.activeTab.reason ?? "Choose another tab.");
  } else if (isComplete) {
    statusHeading.textContent = "Ready to download";
    statusDetail.textContent =
      "The session is stopped and all available evidence is saved locally.";
    statusDot.classList.add("is-complete");
  } else {
    const paused = session.phase === "paused";
    statusHeading.textContent = paused
      ? "Paused"
      : session.phase === "stopping"
        ? "Finishing"
        : "Recording";
    statusDetail.textContent =
      session.pageAccess === "ready"
        ? "Capturing the selected browser tab."
        : "The session is active, but page instrumentation needs attention.";
    statusDot.classList.add(paused ? "is-paused" : "is-recording");

    element("#video-state").textContent = videoLabel(session.videoStatus);
    const pauseButton = element<HTMLButtonElement>("#pause-button");
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.disabled = busy || session.phase === "stopping";
    element<HTMLButtonElement>("#finish-button").disabled =
      busy || session.phase === "stopping";
    element<HTMLButtonElement>("#screenshot-button").disabled = busy || paused;
    element("#screenshot-help").textContent = paused
      ? "Resume the session to capture a screenshot."
      : "Configured private elements are covered before the browser captures pixels.";
    element("#count-screenshots").textContent = String(
      session.counts.screenshots,
    );
    element("#count-actions").textContent = String(session.counts.actions);
    element("#count-requests").textContent = String(
      session.counts.networkRequests,
    );
    element("#count-issues").textContent = String(
      session.counts.consoleLogs + session.counts.networkErrors,
    );
    const selected = document.querySelector<HTMLInputElement>(
      `input[name="result"][value="${session.result}"]`,
    );
    if (selected) selected.checked = true;

    const warningsCard = element("#warnings-card");
    const warningsList = element<HTMLUListElement>("#warnings-list");
    warningsCard.hidden = session.warnings.length === 0;
    warningsList.replaceChildren(
      ...session.warnings.slice(-5).map((sessionWarning) => {
        const item = document.createElement("li");
        item.textContent = sessionWarning.message;
        return item;
      }),
    );
  }

  if (isComplete && session && !showNewSessionForm) {
    const label = session.result === "not-set" ? "Not set" : session.result;
    const badge = element("#result-badge");
    badge.textContent = label;
    badge.className = `result-badge result-${session.result}`;
    element("#complete-summary").textContent =
      `${formatDuration(session.metadata.durationMs)} · ${session.counts.screenshots} screenshots · ${session.counts.actions} actions · ${session.counts.networkRequests} requests`;
  }
  updateTimer();
}

async function refreshState(): Promise<void> {
  const state = await sendPanel<ExtensionStateSnapshot>({
    type: "panel:get-state",
  });
  render(state);
}

async function runOperation(
  label: string,
  operation: () => Promise<void>,
): Promise<void> {
  clearError();
  setBusy(true);
  announce(label);
  try {
    await operation();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    setBusy(false);
  }
}

startForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runOperation("Starting TestWitness session…", async () => {
    const inputValue: StartSessionInput = {
      applicationName: input("#application-name").value,
      environment: input("#environment").value,
      releaseVersion: textValue("#release-version"),
      metadata: {
        testCaseId: textValue("#test-case-id"),
        testCaseName: textValue("#test-case-name"),
        requirementId: textValue("#requirement-id"),
        testerName: textValue("#tester-name"),
        testerEmployeeId: textValue("#tester-id"),
      },
      preferences: {
        captureVideo: input("#capture-video").checked,
        includeAudio: input("#include-audio").checked,
        automaticScreenshots: input("#automatic-screenshots").checked,
        captureRequestBody: input("#request-bodies").checked,
        captureResponseBody: input("#response-bodies").checked,
        maxVideoDurationMinutes: 30,
        maskSelectors: splitLines(textarea("#mask-selectors").value),
        excludeSelectors: splitLines(textarea("#exclude-selectors").value),
        sensitiveQueryParameters: splitLines(
          textarea("#sensitive-query").value,
        ),
      },
    };
    const state = await sendPanel<ExtensionStateSnapshot>({
      type: "panel:start",
      input: inputValue,
    });
    showNewSessionForm = false;
    render(state);
    announce("Session started.");
  });
});

input("#capture-video").addEventListener("change", () => {
  input("#include-audio").disabled = !input("#capture-video").checked;
  element("#start-button").textContent = input("#capture-video").checked
    ? "Start session with video"
    : "Start session";
});

element("#pause-button").addEventListener("click", () => {
  const session = currentState?.session;
  if (!session) return;
  void runOperation(
    session.phase === "paused" ? "Resuming session…" : "Pausing session…",
    async () => {
      const type = session.phase === "paused" ? "panel:resume" : "panel:pause";
      render(
        await sendPanel<ExtensionStateSnapshot>({
          type,
          sessionId: session.sessionId,
        }),
      );
      announce(
        session.phase === "paused" ? "Session resumed." : "Session paused.",
      );
    },
  );
});

element("#screenshot-button").addEventListener("click", () => {
  const session = currentState?.session;
  if (!session) return;
  void runOperation("Capturing screenshot…", async () => {
    render(
      await sendPanel<ExtensionStateSnapshot>({
        type: "panel:capture-screenshot",
        sessionId: session.sessionId,
        label: input("#screenshot-label").value,
      }),
    );
    announce("Screenshot captured and stored locally.");
  });
});

async function addNote(): Promise<void> {
  const session = currentState?.session;
  const note = textarea("#note-text").value.trim();
  if (!session || !note) return;
  await runOperation("Adding tester note…", async () => {
    render(
      await sendPanel<ExtensionStateSnapshot>({
        type: "panel:add-note",
        sessionId: session.sessionId,
        text: note,
      }),
    );
    textarea("#note-text").value = "";
    announce("Tester note added.");
  });
}

element("#add-note-button").addEventListener("click", () => void addNote());
textarea("#note-text").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    void addNote();
  }
});

element("#result-fieldset").addEventListener("change", (event) => {
  const session = currentState?.session;
  const target = event.target;
  if (
    !session ||
    !(target instanceof HTMLInputElement) ||
    target.name !== "result"
  )
    return;
  void runOperation("Updating session result…", async () => {
    render(
      await sendPanel<ExtensionStateSnapshot>({
        type: "panel:set-result",
        sessionId: session.sessionId,
        result: target.value as SessionResultStatus,
      }),
    );
    announce(`Session result set to ${target.value}.`);
  });
});

element("#finish-button").addEventListener("click", () =>
  finishDialog.showModal(),
);
finishDialog.addEventListener("close", () => {
  if (finishDialog.returnValue !== "confirm") return;
  const session = currentState?.session;
  if (!session) return;
  void runOperation("Finishing session and saving evidence…", async () => {
    render(
      await sendPanel<ExtensionStateSnapshot>({
        type: "panel:stop",
        sessionId: session.sessionId,
      }),
    );
    announce("Session stopped. Evidence is ready to download.");
  });
});

element("#download-button").addEventListener("click", () => {
  const session = currentState?.session;
  if (!session) return;
  void runOperation("Preparing evidence ZIP…", async () => {
    const result = await downloadEvidence(repository, session.sessionId);
    announce(`Downloaded ${result.fileName}.`);
  });
});

element("#new-session-button").addEventListener("click", () => {
  showNewSessionForm = true;
  if (currentState) render(currentState);
  input("#application-name").focus();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "background:state-changed"
  ) {
    const stateMessage = message as StateChangedMessage;
    render(stateMessage.state);
  }
  return false;
});

window.setInterval(updateTimer, 1_000);
void refreshState().catch((error: unknown) =>
  showError(error instanceof Error ? error.message : String(error)),
);
