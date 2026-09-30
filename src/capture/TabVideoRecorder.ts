import type { VideoRecord } from "@testwitness/core";

import { createId } from "../shared/ids";

export interface VideoEvidenceRepository {
  addEvidence(
    sessionId: string,
    kind: "video",
    ordinal: number,
    value: VideoRecord,
  ): Promise<void>;
}

export interface VideoRecorderLike extends EventTarget {
  readonly mimeType: string;
  readonly state: RecordingState;
  start(timeslice?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface TabVideoEnvironment {
  acquireStream(streamId: string, includeAudio: boolean): Promise<MediaStream>;
  createRecorder(stream: MediaStream, mimeType: string): VideoRecorderLike;
  isTypeSupported(mimeType: string): boolean;
  createBlob(chunks: Blob[], mimeType: string): Blob;
  now(): Date;
  setTimeout(callback: () => void, milliseconds: number): number;
  clearTimeout(timeoutId: number): void;
}

export interface TabVideoStateEvent {
  sessionId: string;
  state: "recording" | "paused" | "captured" | "unavailable";
  message?: string;
  sizeBytes?: number;
}

export interface StartTabVideoOptions {
  sessionId: string;
  streamId: string;
  includeAudio: boolean;
  maxDurationMinutes: number;
}

interface ActiveRecording {
  sessionId: string;
  stream: MediaStream;
  recorder: VideoRecorderLike;
  chunks: Blob[];
  startedAt: Date;
  timeoutId?: number;
  stopReason: VideoRecord["stopReason"];
  stopping: boolean;
  finishing?: Promise<VideoRecord>;
}

function browserEnvironment(): TabVideoEnvironment {
  return {
    async acquireStream(streamId, includeAudio) {
      const mandatory = {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      };
      return navigator.mediaDevices.getUserMedia({
        audio: includeAudio
          ? ({ mandatory } as unknown as MediaTrackConstraints)
          : false,
        video: { mandatory } as unknown as MediaTrackConstraints,
      });
    },
    createRecorder(stream, mimeType) {
      return mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    },
    isTypeSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
    createBlob: (chunks, mimeType) => new Blob(chunks, { type: mimeType }),
    now: () => new Date(),
    setTimeout: (callback, milliseconds) =>
      window.setTimeout(callback, milliseconds),
    clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  };
}

/** Owns one tab MediaRecorder and persists its final Blob without runtime-message serialization. */
export class TabVideoRecorder {
  readonly #repository: VideoEvidenceRepository;
  readonly #environment: TabVideoEnvironment;
  readonly #onState: (event: TabVideoStateEvent) => void;
  #active?: ActiveRecording;

  public constructor(options: {
    repository: VideoEvidenceRepository;
    environment?: TabVideoEnvironment;
    onState?: (event: TabVideoStateEvent) => void;
  }) {
    this.#repository = options.repository;
    this.#environment = options.environment ?? browserEnvironment();
    this.#onState = options.onState ?? (() => undefined);
  }

  public async start(options: StartTabVideoOptions): Promise<void> {
    if (this.#active) {
      if (this.#active.sessionId === options.sessionId) return;
      this.#active.stopReason = "destroyed";
      await this.finish(this.#active);
    }

    const stream = await this.#environment.acquireStream(
      options.streamId,
      options.includeAudio,
    );
    let recording: ActiveRecording | undefined;

    try {
      const mimeType = this.chooseMimeType(options.includeAudio);
      const recorder = this.#environment.createRecorder(stream, mimeType);
      recording = {
        sessionId: options.sessionId,
        stream,
        recorder,
        chunks: [],
        startedAt: this.#environment.now(),
        stopReason: "session-stopped",
        stopping: false,
      };
      this.#active = recording;

      recorder.addEventListener("dataavailable", (event) => {
        const data = (event as BlobEvent).data;
        if (data.size > 0) recording?.chunks.push(data);
      });
      recorder.addEventListener("error", () => {
        if (!recording || recording.stopping) return;
        recording.stopReason = "recorder-error";
        this.emit(recording.sessionId, "unavailable", {
          message:
            "The browser media recorder reported an error. Other evidence is still being captured.",
        });
        void this.finish(recording).catch(() => undefined);
      });
      for (const track of stream.getVideoTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (!recording || recording.stopping) return;
            recording.stopReason = "user-ended-sharing";
            void this.finish(recording).catch(() => undefined);
          },
          { once: true },
        );
      }

      const durationMs = Math.max(1, options.maxDurationMinutes) * 60_000;
      recording.timeoutId = this.#environment.setTimeout(() => {
        if (!recording || recording.stopping) return;
        recording.stopReason = "duration-limit";
        void this.finish(recording).catch(() => undefined);
      }, durationMs);
      recorder.start(1_000);
    } catch (error) {
      this.cleanupFailedStart(stream, recording);
      throw error;
    }

    this.emit(options.sessionId, "recording");
  }

  public pause(sessionId: string): void {
    if (
      this.#active?.sessionId !== sessionId ||
      this.#active.recorder.state !== "recording"
    ) {
      return;
    }
    this.#active.recorder.pause();
    this.emit(sessionId, "paused");
  }

  public resume(sessionId: string): void {
    if (
      this.#active?.sessionId !== sessionId ||
      this.#active.recorder.state !== "paused"
    ) {
      return;
    }
    this.#active.recorder.resume();
    this.emit(sessionId, "recording");
  }

  public async stop(
    sessionId: string,
    reason: Extract<VideoRecord["stopReason"], "session-stopped" | "destroyed">,
  ): Promise<VideoRecord | undefined> {
    if (this.#active?.sessionId !== sessionId) return undefined;
    this.#active.stopReason = reason;
    return this.finish(this.#active);
  }

  public getState(): RecordingState {
    return this.#active?.recorder.state ?? "inactive";
  }

  private chooseMimeType(includeAudio: boolean): string {
    const candidates = includeAudio
      ? [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm",
        ]
      : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return (
      candidates.find((candidate) =>
        this.#environment.isTypeSupported(candidate),
      ) ?? ""
    );
  }

  private finish(recording: ActiveRecording): Promise<VideoRecord> {
    if (recording.finishing) return recording.finishing;
    recording.stopping = true;
    recording.finishing = new Promise<VideoRecord>((resolve, reject) => {
      const finalize = async (): Promise<void> => {
        try {
          if (recording.timeoutId !== undefined) {
            this.#environment.clearTimeout(recording.timeoutId);
            recording.timeoutId = undefined;
          }
          for (const track of recording.stream.getTracks()) track.stop();
          const endedAt = this.#environment.now();
          const mimeType = recording.recorder.mimeType || "video/webm";
          const blob = this.#environment.createBlob(recording.chunks, mimeType);
          const record: VideoRecord = {
            id: createId("video"),
            startedAt: recording.startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: Math.max(
              0,
              endedAt.getTime() - recording.startedAt.getTime(),
            ),
            mimeType,
            blob,
            fileName: "recording.webm",
            stopReason: recording.stopReason,
          };
          await this.#repository.addEvidence(
            recording.sessionId,
            "video",
            Number.MAX_SAFE_INTEGER,
            record,
          );
          if (this.#active === recording) this.#active = undefined;
          this.emit(recording.sessionId, "captured", { sizeBytes: blob.size });
          resolve(record);
        } catch (error) {
          if (this.#active === recording) this.#active = undefined;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      if (recording.recorder.state === "inactive") {
        void finalize();
        return;
      }
      recording.recorder.addEventListener("stop", () => void finalize(), {
        once: true,
      });
      recording.recorder.stop();
    });
    return recording.finishing;
  }

  private cleanupFailedStart(
    stream: MediaStream,
    recording?: ActiveRecording,
  ): void {
    if (recording) {
      recording.stopping = true;
      if (recording.timeoutId !== undefined) {
        this.#environment.clearTimeout(recording.timeoutId);
        recording.timeoutId = undefined;
      }
      if (this.#active === recording) this.#active = undefined;
    }
    for (const track of stream.getTracks()) track.stop();
  }

  private emit(
    sessionId: string,
    state: TabVideoStateEvent["state"],
    details: Pick<TabVideoStateEvent, "message" | "sizeBytes"> = {},
  ): void {
    this.#onState({ sessionId, state, ...details });
  }
}
