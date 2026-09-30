import {
  DataSanitizer,
  type ScreenshotFormat,
  type ScreenshotRecord,
} from "@testwitness/core";

import { ExtensionError } from "../shared/errors";
import { createId } from "../shared/ids";
import { PROTOCOL_VERSION, type ContentResponse } from "../shared/protocol";
import type { StoredSession } from "../shared/types";

export interface ScreenshotBrowserApi {
  getTab(
    tabId: number,
  ): Promise<{ active: boolean; windowId: number; url?: string }>;
  getWindow(windowId: number): Promise<{ focused: boolean }>;
  sendToTab(tabId: number, message: unknown): Promise<ContentResponse>;
  captureVisibleTab(
    windowId: number,
    options: { format: ScreenshotFormat; quality?: number },
  ): Promise<string>;
}

function defaultBrowserApi(): ScreenshotBrowserApi {
  return {
    getTab: async (tabId) => chrome.tabs.get(tabId),
    getWindow: async (windowId) => chrome.windows.get(windowId),
    sendToTab: async (tabId, message) =>
      chrome.tabs.sendMessage(tabId, message),
    captureVisibleTab: async (windowId, options) =>
      chrome.tabs.captureVisibleTab(windowId, options),
  };
}

function safeLabel(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 70) || "screenshot"
  );
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  if (!dataUrl.startsWith("data:image/")) {
    throw new ExtensionError(
      "SCREENSHOT_FAILED",
      "The browser returned an invalid screenshot.",
    );
  }
  const response = await fetch(dataUrl);
  return response.blob();
}

/** Captures the actual visible tab only after the content script confirms privacy masks. */
export class VisibleTabScreenshotCapture {
  readonly #browser: ScreenshotBrowserApi;

  public constructor(browser: ScreenshotBrowserApi = defaultBrowserApi()) {
    this.#browser = browser;
  }

  public async capture(
    session: StoredSession,
    label: string,
    actionSequence: number,
  ): Promise<ScreenshotRecord> {
    const tab = await this.#browser.getTab(session.targetTabId);
    const browserWindow = await this.#browser.getWindow(session.targetWindowId);
    if (
      !tab.active ||
      tab.windowId !== session.targetWindowId ||
      !browserWindow.focused
    ) {
      throw new ExtensionError(
        "TARGET_TAB_INACTIVE",
        "Return to the recorded tab and keep its browser window focused before taking a screenshot.",
      );
    }

    const sanitizer = new DataSanitizer(session.config.privacy);
    const safeScreenshotLabel = sanitizer.sanitizeText(
      label.trim() || "Manual checkpoint",
      200,
    );
    let prepared = false;

    try {
      const response = await this.#browser.sendToTab(session.targetTabId, {
        version: PROTOCOL_VERSION,
        type: "worker:prepare-screenshot",
        sessionId: session.sessionId,
        leaseId: session.leaseId,
        maskSelectors: session.config.privacy.maskSelectors,
        excludeSelectors: session.config.privacy.excludeSelectors,
      });
      if (!response.ok || response.type !== "screenshot-ready") {
        throw new ExtensionError(
          "SCREENSHOT_FAILED",
          response.ok
            ? "The page did not confirm screenshot masking."
            : response.message,
        );
      }
      prepared = true;

      const format = session.config.screenshot.format;
      const dataUrl = await this.#browser.captureVisibleTab(
        session.targetWindowId,
        {
          format,
          ...(format === "jpeg"
            ? { quality: Math.round(session.config.screenshot.quality * 100) }
            : {}),
        },
      );
      const blob = await dataUrlToBlob(dataUrl);
      const extension = format === "jpeg" ? "jpg" : "png";
      const sequence = session.screenshotSequence + 1;

      return {
        id: createId("screenshot"),
        timestamp: new Date().toISOString(),
        label: safeScreenshotLabel,
        url: sanitizer.sanitizeUrl(response.context.url || tab.url || ""),
        actionSequence,
        blob,
        fileName: `${String(sequence).padStart(3, "0")}-${safeLabel(safeScreenshotLabel)}.${extension}`,
      };
    } catch (error) {
      if (error instanceof ExtensionError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ExtensionError(
        "SCREENSHOT_FAILED",
        `Screenshot capture failed: ${message}`,
      );
    } finally {
      if (prepared) {
        await this.#browser
          .sendToTab(session.targetTabId, {
            version: PROTOCOL_VERSION,
            type: "worker:restore-screenshot",
            sessionId: session.sessionId,
            leaseId: session.leaseId,
          })
          .catch(() => undefined);
      }
    }
  }
}
