import type { ResolvedTestWitnessConfig } from "@testwitness/core";

import {
  PAGE_CONTROL_CHANNEL,
  PAGE_EVIDENCE_CHANNEL,
  PAGE_STATUS_CHANNEL,
  PROTOCOL_VERSION,
  type ContentResponse,
  type EvidenceCandidate,
  type PageBridgeControlMessage,
  type PageBridgeEvidenceMessage,
  type PageBridgeStatusMessage,
  type WorkerContentMessage,
} from "../shared/protocol";
import type { PageContext } from "../shared/types";

const INSTALLATION_KEY = "__testWitnessContentScriptV1__";
const MASK_HOST_ATTRIBUTE = "data-testwitness-privacy-mask";
const MAX_BRIDGE_MESSAGE_BYTES = 256 * 1024;

const MANDATORY_PRIVACY_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete~="current-password" i]',
  'input[autocomplete~="new-password" i]',
  'input[autocomplete~="one-time-code" i]',
  "[data-test-witness]",
] as const;

// The content of an embedded browsing/plugin context is not safely inspectable
// from the top document. Cover its complete viewport rectangle instead.
const EMBEDDED_CONTENT_SELECTORS = [
  "iframe",
  "frame",
  "embed",
  "object",
] as const;

interface ContentSession {
  sessionId: string;
  leaseId: string;
  config: ResolvedTestWitnessConfig;
  paused: boolean;
}

interface ContentGlobal extends Window {
  [INSTALLATION_KEY]?: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pageContext(): PageContext {
  return {
    url: window.location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
  };
}

function postPageControl(message: PageBridgeControlMessage): void {
  window.postMessage(message, window.location.origin);
}

function removePrivacyMask(): void {
  document.querySelector(`[${MASK_HOST_ATTRIBUTE}]`)?.remove();
}

function accessibleSelectorRoots(): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [document];
  const visited = new Set<ShadowRoot>();

  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    if (!root) continue;

    for (const element of root.querySelectorAll("*")) {
      const shadowRoot = element.shadowRoot;
      if (!shadowRoot || visited.has(shadowRoot)) continue;
      visited.add(shadowRoot);
      roots.push(shadowRoot);
    }
  }

  return roots;
}

function matchingElements(
  selectors: readonly string[],
  roots: readonly (Document | ShadowRoot)[],
): Element[] {
  const elements = new Set<Element>();
  for (const selector of selectors) {
    const trimmed = selector.trim();
    if (!trimmed) continue;

    for (const root of roots) {
      let matches: NodeListOf<Element>;
      try {
        matches = root.querySelectorAll(trimmed);
      } catch {
        // Do not continue with a partial privacy overlay. The coordinator will
        // abort capture when the content script returns this failure.
        throw new Error(`Invalid privacy selector: ${trimmed}`);
      }
      for (const element of matches) elements.add(element);
    }
  }
  return [...elements];
}

function addMaskBox(
  container: HTMLElement,
  element: Element,
  label: string,
): void {
  const rectangle = element.getBoundingClientRect();
  if (
    rectangle.width <= 0 ||
    rectangle.height <= 0 ||
    rectangle.right <= 0 ||
    rectangle.bottom <= 0 ||
    rectangle.left >= window.innerWidth ||
    rectangle.top >= window.innerHeight
  ) {
    return;
  }

  const box = document.createElement("div");
  box.className = "privacy-box";
  box.style.left = `${Math.max(0, rectangle.left)}px`;
  box.style.top = `${Math.max(0, rectangle.top)}px`;
  box.style.width = `${Math.min(window.innerWidth, rectangle.right) - Math.max(0, rectangle.left)}px`;
  box.style.height = `${Math.min(window.innerHeight, rectangle.bottom) - Math.max(0, rectangle.top)}px`;
  box.textContent = label;
  container.append(box);
}

async function installPrivacyMask(
  maskSelectors: readonly string[],
  excludeSelectors: readonly string[],
): Promise<void> {
  removePrivacyMask();
  const host = document.createElement("div");
  host.setAttribute(MASK_HOST_ATTRIBUTE, "");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
  });
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .layer { position: fixed; inset: 0; pointer-events: none; }
    .privacy-box {
      position: fixed;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: #172b3a;
      border: 1px solid #52667a;
      color: #fff;
      font: 600 11px/1.2 system-ui, sans-serif;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
  `;
  const layer = document.createElement("div");
  layer.className = "layer";
  shadow.append(style, layer);

  const roots = accessibleSelectorRoots();
  for (const element of matchingElements(
    [
      ...MANDATORY_PRIVACY_SELECTORS,
      ...EMBEDDED_CONTENT_SELECTORS,
      ...maskSelectors,
    ],
    roots,
  )) {
    addMaskBox(layer, element, "Masked");
  }
  for (const element of matchingElements(excludeSelectors, roots)) {
    addMaskBox(layer, element, "Excluded");
  }

  document.documentElement.append(host);
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function parseBridgeEvidence(
  value: unknown,
  session: ContentSession,
): { candidate?: EvidenceCandidate; warning?: string } | undefined {
  if (!isRecord(value) || value.channel !== PAGE_EVIDENCE_CHANNEL)
    return undefined;
  if (
    value.sessionId !== session.sessionId ||
    value.leaseId !== session.leaseId
  )
    return undefined;
  if (typeof value.warning === "string" && value.warning.length <= 1_000) {
    return { warning: value.warning };
  }
  if (!isRecord(value.candidate) || !isRecord(value.candidate.record))
    return undefined;
  if (
    !["action", "console", "network-request", "network-error"].includes(
      String(value.candidate.kind),
    )
  ) {
    return undefined;
  }
  try {
    if (JSON.stringify(value).length > MAX_BRIDGE_MESSAGE_BYTES)
      return undefined;
  } catch {
    return undefined;
  }
  return {
    candidate: (value as unknown as PageBridgeEvidenceMessage).candidate,
  };
}

function parseBridgeStatus(
  value: unknown,
  sessionId: string,
  leaseId: string,
): PageBridgeStatusMessage | undefined {
  if (
    !isRecord(value) ||
    value.channel !== PAGE_STATUS_CHANNEL ||
    value.sessionId !== sessionId ||
    value.leaseId !== leaseId ||
    !["configured", "configuration-error"].includes(String(value.type))
  ) {
    return undefined;
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    return undefined;
  }
  return value as unknown as PageBridgeStatusMessage;
}

function install(): void {
  let session: ContentSession | undefined;
  let pendingConfiguration:
    | {
        sessionId: string;
        leaseId: string;
        timer: number;
        resolve: (status: PageBridgeStatusMessage) => void;
      }
    | undefined;

  function waitForConfiguration(
    sessionId: string,
    leaseId: string,
  ): Promise<PageBridgeStatusMessage> {
    if (pendingConfiguration) {
      window.clearTimeout(pendingConfiguration.timer);
      pendingConfiguration.resolve({
        channel: PAGE_STATUS_CHANNEL,
        type: "configuration-error",
        sessionId: pendingConfiguration.sessionId,
        leaseId: pendingConfiguration.leaseId,
        message: "Page instrumentation was replaced by a newer request.",
      });
    }
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (
          pendingConfiguration?.sessionId === sessionId &&
          pendingConfiguration.leaseId === leaseId
        ) {
          pendingConfiguration = undefined;
        }
        resolve({
          channel: PAGE_STATUS_CHANNEL,
          type: "configuration-error",
          sessionId,
          leaseId,
          message: "The page recorder did not acknowledge startup.",
        });
      }, 2_000);
      pendingConfiguration = { sessionId, leaseId, timer, resolve };
    });
  }

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    if (pendingConfiguration) {
      const status = parseBridgeStatus(
        event.data,
        pendingConfiguration.sessionId,
        pendingConfiguration.leaseId,
      );
      if (status) {
        const { resolve, timer } = pendingConfiguration;
        pendingConfiguration = undefined;
        window.clearTimeout(timer);
        resolve(status);
        return;
      }
    }
    if (!session) return;
    const bridgeMessage = parseBridgeEvidence(event.data, session);
    if (!bridgeMessage) return;
    const runtimeMessage = bridgeMessage.candidate
      ? {
          version: PROTOCOL_VERSION,
          type: "content:evidence",
          sessionId: session.sessionId,
          leaseId: session.leaseId,
          candidate: bridgeMessage.candidate,
        }
      : {
          version: PROTOCOL_VERSION,
          type: "content:warning",
          sessionId: session.sessionId,
          leaseId: session.leaseId,
          message: bridgeMessage.warning ?? "Page instrumentation warning.",
        };
    void chrome.runtime.sendMessage(runtimeMessage).catch(() => undefined);
  });

  async function handleMessage(
    message: WorkerContentMessage,
  ): Promise<ContentResponse> {
    switch (message.type) {
      case "worker:get-context":
        return { ok: true, type: "context", context: pageContext() };
      case "worker:configure": {
        session = {
          sessionId: message.sessionId,
          leaseId: message.leaseId,
          config: message.config,
          paused: message.paused,
        };
        const configuration = waitForConfiguration(
          message.sessionId,
          message.leaseId,
        );
        postPageControl({
          channel: PAGE_CONTROL_CHANNEL,
          type: "configure",
          sessionId: message.sessionId,
          leaseId: message.leaseId,
          config: message.config,
          paused: message.paused,
        });
        const status = await configuration;
        if (status.type !== "configured") {
          session = undefined;
          return {
            ok: false,
            message: status.message || "Page instrumentation failed to start.",
          };
        }
        return { ok: true, type: "configured" };
      }
      case "worker:pause":
      case "worker:resume":
      case "worker:stop": {
        if (
          !session ||
          session.sessionId !== message.sessionId ||
          session.leaseId !== message.leaseId
        ) {
          return { ok: false, message: "The page capture lease is stale." };
        }
        postPageControl({
          channel: PAGE_CONTROL_CHANNEL,
          type: message.type.replace("worker:", "") as
            "pause" | "resume" | "stop",
          sessionId: message.sessionId,
          leaseId: message.leaseId,
        });
        if (message.type === "worker:pause") session.paused = true;
        if (message.type === "worker:resume") session.paused = false;
        if (message.type === "worker:stop") session = undefined;
        return {
          ok: true,
          type:
            message.type === "worker:pause"
              ? "paused"
              : message.type === "worker:resume"
                ? "resumed"
                : "stopped",
        };
      }
      case "worker:prepare-screenshot":
        if (
          !session ||
          session.sessionId !== message.sessionId ||
          session.leaseId !== message.leaseId
        ) {
          return {
            ok: false,
            message: "The screenshot request used a stale page lease.",
          };
        }
        try {
          await installPrivacyMask(
            message.maskSelectors,
            message.excludeSelectors,
          );
          return {
            ok: true,
            type: "screenshot-ready",
            context: { url: window.location.href, title: document.title },
          };
        } catch (error) {
          removePrivacyMask();
          return {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      case "worker:restore-screenshot":
        removePrivacyMask();
        return { ok: true, type: "restored" };
    }
  }

  chrome.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (
        sender.id !== chrome.runtime.id ||
        !isRecord(message) ||
        message.version !== PROTOCOL_VERSION
      ) {
        return false;
      }
      if (!String(message.type).startsWith("worker:")) return false;
      void handleMessage(message as unknown as WorkerContentMessage)
        .then(sendResponse)
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    },
  );
}

const contentGlobal = window as ContentGlobal;
if (!contentGlobal[INSTALLATION_KEY]) {
  contentGlobal[INSTALLATION_KEY] = true;
  install();
}
