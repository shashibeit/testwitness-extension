import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtensionSessionCoordinator } from "../src/application/ExtensionSessionCoordinator";
import type { ExtensionBrowserApi } from "../src/browser/ChromeExtensionApi";
import {
  VisibleTabScreenshotCapture,
  type ScreenshotBrowserApi,
} from "../src/capture/VisibleTabScreenshotCapture";
import type { ContentResponse, RuntimeResponse } from "../src/shared/protocol";
import type {
  ExtensionStateSnapshot,
  StartSessionInput,
} from "../src/shared/types";
import { IndexedDbEvidenceRepository } from "../src/storage/IndexedDbEvidenceRepository";

const DATABASE_NAME = "testwitness-extension-standard";
let repository: IndexedDbEvidenceRepository;

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
    request.addEventListener("blocked", () => resolve(), { once: true });
  });
}

function startInput(): StartSessionInput {
  return {
    applicationName: "Shop portal",
    environment: "QA",
    metadata: { testCaseId: "TC-LOGIN-1", testerName: "QA Tester" },
    preferences: {
      captureVideo: false,
      includeAudio: false,
      automaticScreenshots: false,
      captureRequestBody: false,
      captureResponseBody: false,
      maxVideoDurationMinutes: 30,
      maskSelectors: ["[data-sensitive]"],
      excludeSelectors: [],
      sensitiveQueryParameters: [],
    },
  };
}

function createBrowser(): ExtensionBrowserApi {
  return {
    getActiveTab: async () => ({
      id: 11,
      windowId: 22,
      active: true,
      title: "Shop portal",
      url: "https://shop.example.test/login",
    }),
    getTab: async () => ({
      id: 11,
      windowId: 22,
      active: true,
      title: "Shop portal",
      url: "https://shop.example.test/login",
    }),
    injectScript: vi.fn(async () => undefined),
    sendToTab: vi.fn(
      async (_tabId: number, message: unknown): Promise<ContentResponse> => {
        const type = (message as { type: string }).type;
        if (type === "worker:get-context") {
          return {
            ok: true,
            type: "context",
            context: {
              url: "https://shop.example.test/login?sessionId=secret",
              title: "Sign in",
              userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
              platform: "MacIntel",
              viewport: { width: 1280, height: 720 },
              screen: { width: 1920, height: 1080 },
            },
          };
        }
        if (type === "worker:prepare-screenshot") {
          return {
            ok: true,
            type: "screenshot-ready",
            context: {
              url: "https://shop.example.test/dashboard",
              title: "Dashboard",
            },
          };
        }
        if (type === "worker:configure")
          return { ok: true, type: "configured" };
        if (type === "worker:pause") return { ok: true, type: "paused" };
        if (type === "worker:resume") return { ok: true, type: "resumed" };
        if (type === "worker:stop") return { ok: true, type: "stopped" };
        return { ok: true, type: "restored" };
      },
    ),
    ensureOffscreenDocument: vi.fn(async () => undefined),
    getTabMediaStreamId: vi.fn(async () => "stream-id"),
    sendOffscreen: vi.fn(async (): Promise<RuntimeResponse> => ({
      ok: true,
      data: {},
    })),
    broadcast: vi.fn(async () => undefined),
    setBadge: vi.fn(async () => undefined),
  };
}

function createScreenshots(): VisibleTabScreenshotCapture {
  const browser: ScreenshotBrowserApi = {
    getTab: async () => ({
      active: true,
      windowId: 22,
      url: "https://shop.example.test",
    }),
    getWindow: async () => ({ focused: true }),
    sendToTab: async (_tabId, message) =>
      (message as { type: string }).type === "worker:prepare-screenshot"
        ? {
            ok: true,
            type: "screenshot-ready",
            context: {
              url: "https://shop.example.test/dashboard",
              title: "Dashboard",
            },
          }
        : { ok: true, type: "restored" },
    captureVisibleTab: async () => "data:image/png;base64,AAAA",
  };
  return new VisibleTabScreenshotCapture(browser);
}

beforeEach(async () => {
  await deleteDatabase();
  repository = new IndexedDbEvidenceRepository();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"], { type: "image/png" }))),
  );
});

afterEach(async () => {
  repository.close();
  await deleteDatabase();
  vi.unstubAllGlobals();
});

describe("ExtensionSessionCoordinator", () => {
  it("broadcasts fresh state when the active browser tab changes", async () => {
    const browser = createBrowser();
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
    });

    await coordinator.handleActiveTabChanged();

    expect(browser.broadcast).toHaveBeenCalledOnce();
  });

  it("runs a complete persisted session lifecycle", async () => {
    const browser = createBrowser();
    let currentTime = Date.parse("2026-09-26T12:00:00.000Z");
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
      now: () => new Date((currentTime += 1_000)),
    });

    const started = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = started.session?.sessionId;
    expect(started.session?.phase).toBe("recording");
    expect(started.session?.metadata.currentUrl).not.toContain("secret");
    expect(browser.injectScript).toHaveBeenCalledTimes(2);
    if (!sessionId) throw new Error("Expected a session ID.");

    const stored = await repository.getSession(sessionId);
    if (!stored) throw new Error("Expected a stored session.");
    await coordinator.handleContent(
      {
        version: 1,
        type: "content:evidence",
        sessionId,
        leaseId: stored.leaseId,
        candidate: {
          kind: "action",
          record: {
            sequence: 999,
            timestamp: "2026-09-26T12:00:04.000Z",
            type: "click",
            elementTag: "button",
            elementText: "Sign in",
            url: "https://shop.example.test/login",
          },
        },
      },
      { tabId: 11, frameId: 0 },
    );
    await coordinator.handlePanel({
      version: 1,
      type: "panel:capture-screenshot",
      sessionId,
      label: "Login complete",
    });
    await coordinator.handlePanel({
      version: 1,
      type: "panel:add-note",
      sessionId,
      text: "Validated the happy path.",
    });
    await coordinator.handlePanel({
      version: 1,
      type: "panel:set-result",
      sessionId,
      result: "passed",
    });
    await coordinator.handlePanel({
      version: 1,
      type: "panel:pause",
      sessionId,
    });
    await coordinator.handlePanel({
      version: 1,
      type: "panel:resume",
      sessionId,
    });
    const stopped = (await coordinator.handlePanel({
      version: 1,
      type: "panel:stop",
      sessionId,
    })) as ExtensionStateSnapshot;

    expect(stopped.session?.phase).toBe("stopped");
    expect(stopped.session?.result).toBe("passed");
    expect(stopped.session?.counts).toMatchObject({
      screenshots: 1,
      actions: 1,
      notes: 1,
    });
    const evidence = await repository.getEvidence(
      (await repository.getSession(sessionId))!,
    );
    expect(evidence.actions[0]?.sequence).toBe(1);
    expect(evidence.screenshots[0]?.fileName).toBe("001-login-complete.png");
    expect(evidence.notes[0]?.text).toBe("Validated the happy path.");
  });

  it("prevents simultaneous sessions", async () => {
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser: createBrowser(),
      screenshots: createScreenshots(),
    });
    await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    });
    await expect(
      coordinator.handlePanel({
        version: 1,
        type: "panel:start",
        input: startInput(),
      }),
    ).rejects.toMatchObject({ code: "SESSION_ALREADY_ACTIVE" });
  });

  it("marks an interrupted startup as failed and permits a retry", async () => {
    const browser = createBrowser();
    const successfulSendToTab = browser.sendToTab;
    let configureAttempts = 0;
    browser.sendToTab = vi.fn(
      async (tabId: number, message: unknown): Promise<ContentResponse> => {
        if ((message as { type: string }).type === "worker:configure") {
          configureAttempts += 1;
          if (configureAttempts === 1) {
            return {
              ok: false,
              message: "The page bridge did not become ready.",
            };
          }
        }
        return successfulSendToTab(tabId, message);
      },
    );
    let currentTime = Date.parse("2026-09-26T12:00:00.000Z");
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
      now: () => new Date((currentTime += 1_000)),
    });

    await expect(
      coordinator.handlePanel({
        version: 1,
        type: "panel:start",
        input: startInput(),
      }),
    ).rejects.toMatchObject({ code: "INSTRUMENTATION_FAILED" });

    const failed = await repository.getLatestSession();
    expect(failed).toMatchObject({
      phase: "failed",
      pageAccess: "degraded",
      videoStatus: "off",
    });
    expect(failed?.endedAt).toBeDefined();
    expect(failed?.warnings.at(-1)).toMatchObject({
      code: "RECORDER_ERROR",
      severity: "error",
    });
    expect(browser.sendToTab).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ type: "worker:stop" }),
    );

    const retried = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;

    expect(retried.session?.phase).toBe("recording");
    expect(retried.session?.sessionId).not.toBe(failed?.sessionId);
    expect(configureAttempts).toBe(2);
  });

  it("converts a rejected configuration message into a recoverable failed session", async () => {
    const browser = createBrowser();
    const successfulSendToTab = browser.sendToTab;
    browser.sendToTab = vi.fn(
      async (tabId: number, message: unknown): Promise<ContentResponse> => {
        if ((message as { type: string }).type === "worker:configure") {
          throw new Error("Receiving end does not exist.");
        }
        return successfulSendToTab(tabId, message);
      },
    );
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
    });

    await expect(
      coordinator.handlePanel({
        version: 1,
        type: "panel:start",
        input: startInput(),
      }),
    ).rejects.toMatchObject({
      code: "INSTRUMENTATION_FAILED",
      recoverable: true,
    });

    const failed = await repository.getLatestSession();
    expect(failed?.phase).toBe("failed");
    expect(failed?.warnings.at(-1)?.message).toContain(
      "Receiving end does not exist.",
    );
  });

  it("fails a stale starting session during worker recovery", async () => {
    const browser = createBrowser();
    let currentTime = Date.parse("2026-09-26T12:00:00.000Z");
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
      now: () => new Date((currentTime += 1_000)),
    });
    const started = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = started.session?.sessionId;
    if (!sessionId) throw new Error("Expected a session ID.");
    const stale = await repository.getSession(sessionId);
    if (!stale) throw new Error("Expected a stored session.");
    stale.phase = "starting";
    stale.endedAt = undefined;
    stale.metadata.endedAt = undefined;
    stale.metadata.durationMs = 0;
    await repository.saveSession(stale);

    await coordinator.initialize();

    const recovered = await repository.getSession(sessionId);
    expect(recovered).toMatchObject({
      phase: "failed",
      pageAccess: "degraded",
    });
    expect(recovered?.warnings.map(({ code }) => code)).toEqual([
      "SERVICE_WORKER_RECOVERED",
      "RECORDER_ERROR",
    ]);
    expect(recovered?.endedAt).toBeDefined();

    const retried = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    expect(retried.session?.phase).toBe("recording");
    expect(retried.session?.sessionId).not.toBe(sessionId);
  });

  it("finishes a stale stopping session during worker recovery", async () => {
    const browser = createBrowser();
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
    });
    const started = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = started.session?.sessionId;
    if (!sessionId) throw new Error("Expected a session ID.");
    const stale = await repository.getSession(sessionId);
    if (!stale) throw new Error("Expected a stored session.");
    stale.phase = "stopping";
    await repository.saveSession(stale);

    await coordinator.initialize();

    const recovered = await repository.getSession(sessionId);
    expect(recovered?.phase).toBe("stopped");
    expect(recovered?.warnings).toEqual([
      expect.objectContaining({ code: "SERVICE_WORKER_RECOVERED" }),
    ]);
    expect(browser.sendToTab).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ type: "worker:stop" }),
    );
  });

  it("keeps recording and reports degraded access when pause is not acknowledged", async () => {
    const browser = createBrowser();
    const successfulSendToTab = browser.sendToTab;
    browser.sendToTab = vi.fn(
      async (tabId: number, message: unknown): Promise<ContentResponse> => {
        if ((message as { type: string }).type === "worker:pause") {
          return {
            ok: false,
            message: "The page recorder did not acknowledge pause.",
          };
        }
        return successfulSendToTab(tabId, message);
      },
    );
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
    });
    const started = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = started.session?.sessionId;
    if (!sessionId) throw new Error("Expected a session ID.");

    await expect(
      coordinator.handlePanel({
        version: 1,
        type: "panel:pause",
        sessionId,
      }),
    ).rejects.toMatchObject({ code: "INSTRUMENTATION_FAILED" });

    const session = await repository.getSession(sessionId);
    expect(session).toMatchObject({
      phase: "recording",
      pageAccess: "degraded",
    });
    expect(session?.warnings.at(-1)).toMatchObject({
      code: "PAGE_ACCESS_LOST",
      severity: "error",
    });
  });

  it("remains paused and records a capture gap when resume messaging rejects", async () => {
    const browser = createBrowser();
    const successfulSendToTab = browser.sendToTab;
    let rejectResume = false;
    browser.sendToTab = vi.fn(
      async (tabId: number, message: unknown): Promise<ContentResponse> => {
        if (
          rejectResume &&
          (message as { type: string }).type === "worker:resume"
        ) {
          throw new Error("The tab navigated before resume completed.");
        }
        return successfulSendToTab(tabId, message);
      },
    );
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
    });
    const started = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = started.session?.sessionId;
    if (!sessionId) throw new Error("Expected a session ID.");
    await coordinator.handlePanel({
      version: 1,
      type: "panel:pause",
      sessionId,
    });
    rejectResume = true;

    await expect(
      coordinator.handlePanel({
        version: 1,
        type: "panel:resume",
        sessionId,
      }),
    ).rejects.toMatchObject({ code: "INSTRUMENTATION_FAILED" });

    const session = await repository.getSession(sessionId);
    expect(session).toMatchObject({ phase: "paused", pageAccess: "degraded" });
    expect(session?.warnings.at(-1)).toMatchObject({
      code: "CAPTURE_GAP",
      severity: "error",
    });
    expect(session?.warnings.at(-1)?.message).toContain(
      "tab navigated before resume completed",
    );
  });

  it("finishes stopping but reports cleanup failure when stop is not acknowledged", async () => {
    const browser = createBrowser();
    const successfulSendToTab = browser.sendToTab;
    browser.sendToTab = vi.fn(
      async (tabId: number, message: unknown): Promise<ContentResponse> => {
        if ((message as { type: string }).type === "worker:stop") {
          return { ok: true, type: "resumed" };
        }
        return successfulSendToTab(tabId, message);
      },
    );
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser,
      screenshots: createScreenshots(),
    });
    const started = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = started.session?.sessionId;
    if (!sessionId) throw new Error("Expected a session ID.");

    const stopped = (await coordinator.handlePanel({
      version: 1,
      type: "panel:stop",
      sessionId,
    })) as ExtensionStateSnapshot;

    expect(stopped.session).toMatchObject({
      phase: "stopped",
      pageAccess: "degraded",
    });
    expect(stopped.session?.warnings.at(-1)).toMatchObject({
      code: "RECORDER_ERROR",
      severity: "error",
    });
  });

  it("rejects evidence from another tab or a stale lease", async () => {
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser: createBrowser(),
      screenshots: createScreenshots(),
    });
    const state = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = state.session?.sessionId ?? "";
    await expect(
      coordinator.handleContent(
        {
          version: 1,
          type: "content:evidence",
          sessionId,
          leaseId: "stale-lease",
          candidate: {
            kind: "console",
            record: {
              id: "console-1",
              timestamp: new Date().toISOString(),
              level: "error",
              message: "spoofed",
              arguments: [],
              url: "https://evil.example",
            },
          },
        },
        { tabId: 99, frameId: 0 },
      ),
    ).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
  });

  it("surfaces an evidence storage failure without incrementing counters", async () => {
    const coordinator = new ExtensionSessionCoordinator({
      repository,
      browser: createBrowser(),
      screenshots: createScreenshots(),
    });
    const state = (await coordinator.handlePanel({
      version: 1,
      type: "panel:start",
      input: startInput(),
    })) as ExtensionStateSnapshot;
    const sessionId = state.session?.sessionId ?? "";
    const stored = await repository.getSession(sessionId);
    if (!stored) throw new Error("Expected a stored session.");
    vi.spyOn(repository, "addEvidence").mockRejectedValueOnce(
      new Error("Quota exceeded"),
    );

    await expect(
      coordinator.handleContent(
        {
          version: 1,
          type: "content:evidence",
          sessionId,
          leaseId: stored.leaseId,
          candidate: {
            kind: "console",
            record: {
              id: "console-storage-failure",
              timestamp: new Date().toISOString(),
              level: "error",
              message: "Application error",
              arguments: [],
              url: "https://shop.example.test/login",
            },
          },
        },
        { tabId: 11, frameId: 0 },
      ),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" });

    const afterFailure = await repository.getSession(sessionId);
    expect(afterFailure?.counts.consoleLogs).toBe(0);
    expect(afterFailure?.evidenceOrdinal).toBe(0);
    expect(afterFailure?.warnings.at(-1)).toMatchObject({
      code: "STORAGE_QUOTA_REACHED",
      severity: "error",
    });
  });
});
