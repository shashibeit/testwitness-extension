import { pageSupport, urlOrigin } from "../shared/browser";
import "./styles.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="launcher">
    <header class="brand">
      <img src="/icons/testwitness-48.png" width="40" height="40" alt="" />
      <div>
        <p>TestWitness</p>
        <h1>Capture this tab</h1>
      </div>
    </header>
    <section class="tab-card" aria-labelledby="tab-title">
      <span class="status-dot" aria-hidden="true"></span>
      <div>
        <strong id="tab-title">Finding the active tab…</strong>
        <span id="tab-origin"></span>
      </div>
    </section>
    <p id="guidance" class="guidance">
      Open the TestWitness side panel with access limited to this browser tab.
    </p>
    <p id="error" class="error" role="alert" hidden></p>
    <button id="open-panel" type="button" disabled>
      Open TestWitness for this tab
    </button>
    <p class="privacy">Version ${__TEST_WITNESS_EXTENSION_VERSION__} · Evidence remains on this device until downloaded.</p>
  </main>
`;

const button = document.querySelector<HTMLButtonElement>("#open-panel")!;
const title = document.querySelector<HTMLElement>("#tab-title")!;
const origin = document.querySelector<HTMLElement>("#tab-origin")!;
const guidance = document.querySelector<HTMLElement>("#guidance")!;
const error = document.querySelector<HTMLElement>("#error")!;
let targetTab: chrome.tabs.Tab | undefined;

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
}

async function initialize(): Promise<void> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  targetTab = tab;
  title.textContent = tab?.title || "No supported tab selected";
  origin.textContent = urlOrigin(tab?.url);
  const support = pageSupport(tab?.url);
  if (typeof tab?.id !== "number" || tab.windowId < 0 || !support.supported) {
    guidance.textContent =
      support.reason ?? "Open a normal HTTP or HTTPS page and try again.";
    return;
  }
  button.disabled = false;
  button.focus();
}

button.addEventListener("click", () => {
  if (typeof targetTab?.id !== "number") return;
  button.disabled = true;
  guidance.textContent = "Opening the evidence panel…";
  const opening = chrome.sidePanel.open({ windowId: targetTab.windowId });
  void chrome.runtime
    .sendMessage({
      version: 1,
      type: "launcher:activate-tab",
      tabId: targetTab.id,
    })
    .catch(() => undefined);
  void opening
    .then(() => window.close())
    .catch((reason: unknown) => {
      button.disabled = false;
      guidance.textContent =
        "TestWitness could not open the side panel for this window.";
      showError(reason instanceof Error ? reason.message : String(reason));
    });
});

void initialize().catch((reason: unknown) => {
  guidance.textContent = "TestWitness could not inspect the active tab.";
  showError(reason instanceof Error ? reason.message : String(reason));
});
