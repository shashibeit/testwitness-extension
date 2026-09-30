import type { VideoRecord } from "@testwitness/core";
import { describe, expect, it, vi } from "vitest";

import {
  TabVideoRecorder,
  type TabVideoEnvironment,
  type VideoEvidenceRepository,
  type VideoRecorderLike,
} from "../src/capture/TabVideoRecorder";

class MockTrack extends EventTarget {
  public stopped = false;

  public stop(): void {
    this.stopped = true;
  }

  public endSharing(): void {
    this.dispatchEvent(new Event("ended"));
  }
}

class MockRecorder extends EventTarget implements VideoRecorderLike {
  public readonly mimeType = "video/webm;codecs=vp9";
  public state: RecordingState = "inactive";

  public start(): void {
    this.state = "recording";
  }

  public pause(): void {
    this.state = "paused";
  }

  public resume(): void {
    this.state = "recording";
  }

  public stop(): void {
    const dataEvent = new Event("dataavailable");
    Object.defineProperty(dataEvent, "data", {
      value: new Blob(["video-data"], { type: this.mimeType }),
    });
    this.dispatchEvent(dataEvent);
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

function createHarness(): {
  recorder: TabVideoRecorder;
  mediaRecorder: MockRecorder;
  track: MockTrack;
  saved: VideoRecord[];
  timeout: { callback?: () => void };
  states: string[];
  environment: TabVideoEnvironment;
} {
  const mediaRecorder = new MockRecorder();
  const track = new MockTrack();
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  const saved: VideoRecord[] = [];
  const repository: VideoEvidenceRepository = {
    addEvidence: vi.fn(
      async (
        _sessionId: string,
        _kind: "video",
        _ordinal: number,
        record: VideoRecord,
      ) => {
        saved.push(record);
      },
    ),
  };
  const timeout: { callback?: () => void } = {};
  let clock = Date.parse("2026-09-26T12:00:00.000Z");
  const environment: TabVideoEnvironment = {
    acquireStream: vi.fn(async () => stream),
    createRecorder: vi.fn(() => mediaRecorder),
    isTypeSupported: (mimeType) => mimeType === "video/webm;codecs=vp9",
    createBlob: (chunks, mimeType) => new Blob(chunks, { type: mimeType }),
    now: () => new Date((clock += 1_000)),
    setTimeout: (callback) => {
      timeout.callback = callback;
      return 9;
    },
    clearTimeout: vi.fn(),
  };
  const states: string[] = [];
  const recorder = new TabVideoRecorder({
    repository,
    environment,
    onState: (event) => states.push(event.state),
  });
  return {
    recorder,
    mediaRecorder,
    track,
    saved,
    timeout,
    states,
    environment,
  };
}

describe("TabVideoRecorder", () => {
  it("records, pauses, resumes, finalizes, and persists a WebM Blob", async () => {
    const harness = createHarness();
    await harness.recorder.start({
      sessionId: "session-1",
      streamId: "stream-1",
      includeAudio: false,
      maxDurationMinutes: 30,
    });
    expect(harness.mediaRecorder.state).toBe("recording");
    harness.recorder.pause("session-1");
    expect(harness.mediaRecorder.state).toBe("paused");
    harness.recorder.resume("session-1");
    expect(harness.mediaRecorder.state).toBe("recording");

    const record = await harness.recorder.stop("session-1", "session-stopped");
    expect(record).toMatchObject({
      mimeType: "video/webm;codecs=vp9",
      fileName: "recording.webm",
      stopReason: "session-stopped",
    });
    expect(record?.blob.size).toBeGreaterThan(0);
    expect(harness.track.stopped).toBe(true);
    expect(harness.saved).toHaveLength(1);
    expect(harness.states).toEqual([
      "recording",
      "paused",
      "recording",
      "captured",
    ]);
  });

  it("finalizes when the user ends tab sharing", async () => {
    const harness = createHarness();
    await harness.recorder.start({
      sessionId: "session-2",
      streamId: "stream-2",
      includeAudio: false,
      maxDurationMinutes: 30,
    });
    harness.track.endSharing();
    await vi.waitFor(() => expect(harness.saved).toHaveLength(1));
    expect(harness.saved[0]?.stopReason).toBe("user-ended-sharing");
  });

  it("enforces the configured duration limit", async () => {
    const harness = createHarness();
    await harness.recorder.start({
      sessionId: "session-3",
      streamId: "stream-3",
      includeAudio: false,
      maxDurationMinutes: 1,
    });
    harness.timeout.callback?.();
    await vi.waitFor(() => expect(harness.saved).toHaveLength(1));
    expect(harness.saved[0]?.stopReason).toBe("duration-limit");
  });

  it("releases the acquired stream when MediaRecorder construction fails", async () => {
    const harness = createHarness();
    vi.mocked(harness.environment.createRecorder).mockImplementation(() => {
      throw new Error("MediaRecorder construction failed");
    });

    await expect(
      harness.recorder.start({
        sessionId: "session-construction-failure",
        streamId: "stream-construction-failure",
        includeAudio: false,
        maxDurationMinutes: 30,
      }),
    ).rejects.toThrow("MediaRecorder construction failed");

    expect(harness.track.stopped).toBe(true);
    expect(harness.environment.clearTimeout).not.toHaveBeenCalled();
    expect(harness.recorder.getState()).toBe("inactive");
    await expect(
      harness.recorder.stop("session-construction-failure", "session-stopped"),
    ).resolves.toBeUndefined();
  });

  it("clears the timer, active state, and stream when MediaRecorder.start fails", async () => {
    const harness = createHarness();
    vi.spyOn(harness.mediaRecorder, "start").mockImplementation(() => {
      harness.mediaRecorder.state = "recording";
      throw new Error("MediaRecorder start failed");
    });

    await expect(
      harness.recorder.start({
        sessionId: "session-start-failure",
        streamId: "stream-start-failure",
        includeAudio: false,
        maxDurationMinutes: 30,
      }),
    ).rejects.toThrow("MediaRecorder start failed");

    expect(harness.environment.clearTimeout).toHaveBeenCalledOnce();
    expect(harness.environment.clearTimeout).toHaveBeenCalledWith(9);
    expect(harness.track.stopped).toBe(true);
    expect(harness.recorder.getState()).toBe("inactive");
    expect(harness.saved).toHaveLength(0);
    expect(harness.states).toHaveLength(0);
    await expect(
      harness.recorder.stop("session-start-failure", "session-stopped"),
    ).resolves.toBeUndefined();
  });
});
