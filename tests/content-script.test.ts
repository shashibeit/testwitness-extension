import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  PAGE_STATUS_CHANNEL,
  type ContentResponse,
  type PageBridgeControlMessage,
  type PageBridgeStatusMessage,
  type WorkerContentMessage,
} from "../src/shared/protocol";
import { createStoredSession } from "./fixtures";

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ContentResponse) => void,
) => boolean;

let runtimeListener: RuntimeListener | undefined;
let posted: unknown[] = [];

function sendWorkerMessage(
  message: WorkerContentMessage,
): Promise<ContentResponse> {
  if (!runtimeListener)
    throw new Error("Content-script listener was not installed.");
  return new Promise((resolve) => {
    const asynchronous = runtimeListener?.(
      message,
      { id: "test-extension" },
      resolve,
    );
    expect(asynchronous).toBe(true);
  });
}

function latestControl(): PageBridgeControlMessage {
  const message = posted.at(-1);
  if (!message || typeof message !== "object") {
    throw new Error("Expected a page control message.");
  }
  return message as PageBridgeControlMessage;
}

function acknowledge(
  control: PageBridgeControlMessage,
  type: PageBridgeStatusMessage["type"],
  controlId = control.controlId,
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        channel: PAGE_STATUS_CHANNEL,
        type,
        controlId,
        sessionId: control.sessionId,
        leaseId: control.leaseId,
      } satisfies PageBridgeStatusMessage,
    }),
  );
}

async function configurePage(): Promise<void> {
  const pending = sendWorkerMessage({
    version: 1,
    type: "worker:configure",
    sessionId: "session-1",
    leaseId: "lease-1",
    config: createStoredSession().config,
    paused: false,
  });
  await Promise.resolve();
  const control = latestControl();
  expect(control.type).toBe("configure");
  acknowledge(control, "configured");
  await expect(pending).resolves.toEqual({ ok: true, type: "configured" });
}

beforeAll(async () => {
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      onMessage: {
        addListener: (listener: RuntimeListener): void => {
          runtimeListener = listener;
        },
      },
      sendMessage: vi.fn(async () => undefined),
    },
  });
  await import("../src/content/content-script");
});

beforeEach(() => {
  posted = [];
  vi.spyOn(window, "postMessage").mockImplementation((message) => {
    posted.push(message);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isolated content-script control acknowledgements", () => {
  it("waits for matching MAIN-world acknowledgements before confirming controls", async () => {
    await configurePage();

    const pendingPause = sendWorkerMessage({
      version: 1,
      type: "worker:pause",
      sessionId: "session-1",
      leaseId: "lease-1",
    });
    await Promise.resolve();
    const pauseControl = latestControl();
    acknowledge(pauseControl, "paused", "forged-control-id");

    let settled = false;
    void pendingPause.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    acknowledge(pauseControl, "paused");
    await expect(pendingPause).resolves.toEqual({ ok: true, type: "paused" });
  });

  it("returns a failure when the page recorder does not acknowledge a control", async () => {
    vi.useFakeTimers();
    await configurePage();

    const pendingResume = sendWorkerMessage({
      version: 1,
      type: "worker:resume",
      sessionId: "session-1",
      leaseId: "lease-1",
    });
    await Promise.resolve();
    expect(latestControl().type).toBe("resume");

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pendingResume).resolves.toEqual({
      ok: false,
      message: "The page recorder did not acknowledge resume.",
    });
  });
});
