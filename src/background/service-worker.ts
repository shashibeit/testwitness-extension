import { ExtensionSessionCoordinator } from "../application/ExtensionSessionCoordinator";
import { createChromeExtensionApi } from "../browser/ChromeExtensionApi";
import { ExtensionError, toExtensionError } from "../shared/errors";
import {
  isOffscreenEvent,
  parseContentRuntimeMessage,
  parseLauncherMessage,
  parsePanelMessage,
  type RuntimeResponse,
} from "../shared/protocol";
import { IndexedDbEvidenceRepository } from "../storage/IndexedDbEvidenceRepository";

const repository = new IndexedDbEvidenceRepository();
const coordinator = new ExtensionSessionCoordinator({
  repository,
  browser: createChromeExtensionApi(),
});

function success(data: unknown): RuntimeResponse {
  return { ok: true, data };
}

function failure(error: unknown): RuntimeResponse {
  const extensionError = toExtensionError(error, "INVALID_STATE");
  return {
    ok: false,
    error: {
      code: extensionError.code,
      message: extensionError.message,
      recoverable: extensionError.recoverable,
    },
  };
}

function isPanelSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.url === chrome.runtime.getURL("sidepanel.html");
}

function isLauncherSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.url === chrome.runtime.getURL("launcher.html");
}

async function routeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  if (sender.id !== chrome.runtime.id) {
    return failure(
      new ExtensionError(
        "INVALID_MESSAGE",
        "Rejected a foreign extension message.",
      ),
    );
  }

  const launcherMessage = parseLauncherMessage(message);
  if (launcherMessage) {
    if (!isLauncherSender(sender)) {
      return failure(
        new ExtensionError(
          "INVALID_MESSAGE",
          "Launcher command sender was invalid.",
        ),
      );
    }
    try {
      await coordinator.handleActiveTabChanged(launcherMessage.tabId);
      return success({ accepted: true });
    } catch (error) {
      return failure(error);
    }
  }

  const panelMessage = parsePanelMessage(message);
  if (panelMessage) {
    if (!isPanelSender(sender)) {
      return failure(
        new ExtensionError(
          "INVALID_MESSAGE",
          "Panel command sender was invalid.",
        ),
      );
    }
    try {
      return success(await coordinator.handlePanel(panelMessage));
    } catch (error) {
      return failure(error);
    }
  }

  const contentMessage = parseContentRuntimeMessage(message);
  if (contentMessage) {
    try {
      return success(
        await coordinator.handleContent(contentMessage, {
          tabId: sender.tab?.id,
          frameId: sender.frameId,
        }),
      );
    } catch (error) {
      return failure(error);
    }
  }

  if (isOffscreenEvent(message)) {
    try {
      await coordinator.handleVideoEvent(message);
      return success({ accepted: true });
    } catch (error) {
      return failure(error);
    }
  }

  return failure(
    new ExtensionError(
      "INVALID_MESSAGE",
      "The extension message was not recognized.",
    ),
  );
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    void routeMessage(message, sender).then(sendResponse);
    return true;
  },
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  void coordinator
    .handleTabUpdated(tabId, changeInfo.status)
    .catch(() => undefined);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void coordinator.handleActiveTabChanged(tabId).catch(() => undefined);
});

chrome.windows.onFocusChanged.addListener(() => {
  void coordinator.handleActiveTabChanged().catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void coordinator.handleTabRemoved(tabId).catch(() => undefined);
});

async function configureLauncherBehavior(): Promise<void> {
  // Older TestWitness builds enabled direct action-to-side-panel opening.
  // Chrome persists that preference across extension reloads, so explicitly
  // disable it now that the action uses a permission-granting launcher popup.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

chrome.runtime.onInstalled.addListener(() => {
  void configureLauncherBehavior();
  void coordinator.initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void configureLauncherBehavior();
  void coordinator.initialize();
});

void configureLauncherBehavior().catch(() => undefined);
void coordinator.initialize().catch(() => undefined);
