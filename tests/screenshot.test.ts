import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VisibleTabScreenshotCapture,
  type ScreenshotBrowserApi,
} from "../src/capture/VisibleTabScreenshotCapture";
import type { ExtensionError } from "../src/shared/errors";
import { createStoredSession } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VisibleTabScreenshotCapture", () => {
  it("masks, captures, and restores the page in order", async () => {
    const calls: string[] = [];
    const browser: ScreenshotBrowserApi = {
      getTab: async () => ({
        active: true,
        windowId: 22,
        url: "https://example.test",
      }),
      getWindow: async () => ({ focused: true }),
      sendToTab: async (_tabId, message) => {
        const type = (message as { type: string }).type;
        calls.push(type);
        return type === "worker:prepare-screenshot"
          ? {
              ok: true,
              type: "screenshot-ready",
              context: {
                url: "https://example.test?token=secret",
                title: "Demo",
              },
            }
          : { ok: true, type: "restored" };
      },
      captureVisibleTab: async () => {
        calls.push("capture");
        return "data:image/png;base64,AAAA";
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["png"], { type: "image/png" }))),
    );

    const result = await new VisibleTabScreenshotCapture(browser).capture(
      createStoredSession(),
      "Login completed",
      3,
    );
    expect(calls).toEqual([
      "worker:prepare-screenshot",
      "capture",
      "worker:restore-screenshot",
    ]);
    expect(result.fileName).toBe("001-login-completed.png");
    expect(result.url).not.toContain("secret");
    expect(result.actionSequence).toBe(3);
  });

  it("fails before masking when the target tab is not visible", async () => {
    const sendToTab = vi.fn();
    const browser: ScreenshotBrowserApi = {
      getTab: async () => ({ active: false, windowId: 22 }),
      getWindow: async () => ({ focused: true }),
      sendToTab,
      captureVisibleTab: async () => "",
    };
    await expect(
      new VisibleTabScreenshotCapture(browser).capture(
        createStoredSession(),
        "Hidden tab",
        0,
      ),
    ).rejects.toMatchObject({
      code: "TARGET_TAB_INACTIVE",
    } satisfies Partial<ExtensionError>);
    expect(sendToTab).not.toHaveBeenCalled();
  });
});
