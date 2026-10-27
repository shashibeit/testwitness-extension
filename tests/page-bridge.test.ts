import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TestWitnessCore from "@testwitness/core";

import {
  PAGE_CONTROL_CHANNEL,
  PAGE_STATUS_CHANNEL,
  type PageBridgeControlMessage,
} from "../src/shared/protocol";
import { createStoredSession } from "./fixtures";

const recorderState = vi.hoisted(() => ({
  instances: [] as Array<{
    start: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@testwitness/core", async (importOriginal) => {
  const actual = await importOriginal<typeof TestWitnessCore>();
  class Recorder {
    public readonly start = vi.fn();
    public readonly pause = vi.fn();
    public readonly resume = vi.fn();
    public readonly stop = vi.fn();

    public constructor() {
      recorderState.instances.push(this);
    }
  }
  return {
    ...actual,
    ActionRecorder: Recorder,
    ConsoleRecorder: Recorder,
    NetworkRecorder: Recorder,
  };
});

const posted: unknown[] = [];

function dispatchControl(message: PageBridgeControlMessage): void {
  window.dispatchEvent(
    new MessageEvent("message", { data: message, source: window }),
  );
}

beforeAll(async () => {
  await import("../src/page/page-bridge");
});

beforeEach(() => {
  posted.length = 0;
  vi.spyOn(window, "postMessage").mockImplementation((message) => {
    posted.push(message);
  });
});

describe("MAIN-world page bridge control acknowledgements", () => {
  it("echoes the control ID after configuration and each successful control", () => {
    const config = createStoredSession().config;
    dispatchControl({
      channel: PAGE_CONTROL_CHANNEL,
      type: "configure",
      controlId: "configure-1",
      sessionId: "session-1",
      leaseId: "lease-1",
      config,
      paused: false,
    });
    dispatchControl({
      channel: PAGE_CONTROL_CHANNEL,
      type: "pause",
      controlId: "pause-1",
      sessionId: "session-1",
      leaseId: "lease-1",
    });
    dispatchControl({
      channel: PAGE_CONTROL_CHANNEL,
      type: "resume",
      controlId: "resume-1",
      sessionId: "session-1",
      leaseId: "lease-1",
    });
    dispatchControl({
      channel: PAGE_CONTROL_CHANNEL,
      type: "stop",
      controlId: "stop-1",
      sessionId: "session-1",
      leaseId: "lease-1",
    });

    expect(posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: PAGE_STATUS_CHANNEL,
          type: "configured",
          controlId: "configure-1",
        }),
        expect.objectContaining({
          channel: PAGE_STATUS_CHANNEL,
          type: "paused",
          controlId: "pause-1",
        }),
        expect.objectContaining({
          channel: PAGE_STATUS_CHANNEL,
          type: "resumed",
          controlId: "resume-1",
        }),
        expect.objectContaining({
          channel: PAGE_STATUS_CHANNEL,
          type: "stopped",
          controlId: "stop-1",
        }),
      ]),
    );
    expect(recorderState.instances).toHaveLength(3);
    for (const recorder of recorderState.instances) {
      expect(recorder.start).toHaveBeenCalledOnce();
      expect(recorder.pause).toHaveBeenCalledOnce();
      expect(recorder.resume).toHaveBeenCalledOnce();
      expect(recorder.stop).toHaveBeenCalledOnce();
    }
  });

  it("rejects a control carrying a stale lease and does not claim it succeeded", () => {
    const before = posted.length;
    dispatchControl({
      channel: PAGE_CONTROL_CHANNEL,
      type: "pause",
      controlId: "pause-stale",
      sessionId: "session-1",
      leaseId: "old-lease",
    });

    expect(posted.slice(before)).toEqual([
      expect.objectContaining({
        channel: PAGE_STATUS_CHANNEL,
        type: "control-error",
        controlId: "pause-stale",
        message: "The page capture lease is stale.",
      }),
    ]);
  });
});
