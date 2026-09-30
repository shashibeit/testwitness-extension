import type {
  ContentResponse,
  OffscreenCommandMessage,
  RuntimeResponse,
} from "../shared/protocol";

export interface BrowserTab {
  id?: number;
  windowId: number;
  active: boolean;
  title?: string;
  url?: string;
}

export interface ExtensionBrowserApi {
  getActiveTab(): Promise<BrowserTab | undefined>;
  getTab(tabId: number): Promise<BrowserTab>;
  injectScript(
    tabId: number,
    file: string,
    world: "ISOLATED" | "MAIN",
  ): Promise<void>;
  sendToTab(tabId: number, message: unknown): Promise<ContentResponse>;
  ensureOffscreenDocument(): Promise<void>;
  getTabMediaStreamId(tabId: number): Promise<string>;
  sendOffscreen(message: OffscreenCommandMessage): Promise<RuntimeResponse>;
  broadcast(message: unknown): Promise<void>;
  setBadge(tabId: number, text: string, color: string): Promise<void>;
}

let creatingOffscreenDocument: Promise<void> | undefined;

async function hasOffscreenDocument(): Promise<boolean> {
  if (typeof chrome.runtime.getContexts !== "function") return false;
  const documentUrl = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [documentUrl],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  creatingOffscreenDocument ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification:
        "Record the user-approved browser tab while the TestWitness session is active.",
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("single offscreen")) throw error;
    })
    .finally(() => {
      creatingOffscreenDocument = undefined;
    });
  await creatingOffscreenDocument;
}

export function createChromeExtensionApi(): ExtensionBrowserApi {
  return {
    async getActiveTab() {
      const tabs = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      return tabs[0];
    },
    async getTab(tabId) {
      return chrome.tabs.get(tabId);
    },
    async injectScript(tabId, file, world) {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        files: [file],
        world,
      });
    },
    async sendToTab(tabId, message) {
      return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    },
    ensureOffscreenDocument,
    async getTabMediaStreamId(tabId) {
      return chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    },
    async sendOffscreen(message) {
      return chrome.runtime.sendMessage(message);
    },
    async broadcast(message) {
      await chrome.runtime.sendMessage(message).catch(() => undefined);
    },
    async setBadge(tabId, text, color) {
      await Promise.all([
        chrome.action.setBadgeText({ tabId, text }),
        chrome.action.setBadgeBackgroundColor({ tabId, color }),
      ]);
    },
  };
}
