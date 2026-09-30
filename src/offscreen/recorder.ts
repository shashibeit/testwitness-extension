import {
  TabVideoRecorder,
  type TabVideoStateEvent,
} from "../capture/TabVideoRecorder";
import {
  PROTOCOL_VERSION,
  type OffscreenCommandMessage,
  type OffscreenEventMessage,
  type RuntimeResponse,
} from "../shared/protocol";
import { IndexedDbEvidenceRepository } from "../storage/IndexedDbEvidenceRepository";

function emitState(event: TabVideoStateEvent): void {
  void chrome.runtime
    .sendMessage({
      version: PROTOCOL_VERSION,
      type: "offscreen:video-state",
      ...event,
    } satisfies OffscreenEventMessage)
    .catch(() => undefined);
}

const recorder = new TabVideoRecorder({
  repository: new IndexedDbEvidenceRepository(),
  onState: emitState,
});

async function handleMessage(
  message: OffscreenCommandMessage,
): Promise<RuntimeResponse> {
  try {
    switch (message.type) {
      case "offscreen:start-video":
        await recorder.start(message);
        return { ok: true, data: { state: "recording" } };
      case "offscreen:pause-video":
        recorder.pause(message.sessionId);
        return { ok: true, data: { state: recorder.getState() } };
      case "offscreen:resume-video":
        recorder.resume(message.sessionId);
        return { ok: true, data: { state: recorder.getState() } };
      case "offscreen:stop-video": {
        const record = await recorder.stop(message.sessionId, message.reason);
        return {
          ok: true,
          data: {
            state: record ? "captured" : "inactive",
            sizeBytes: record?.blob.size,
          },
        };
      }
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    emitState({
      sessionId: message.sessionId,
      state: "unavailable",
      message: messageText,
    });
    return {
      ok: false,
      error: { code: "VIDEO_FAILED", message: messageText, recoverable: true },
    };
  }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      sender.id !== chrome.runtime.id ||
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      !String(message.type).startsWith("offscreen:") ||
      message.type === "offscreen:video-state"
    ) {
      return false;
    }
    void handleMessage(message as OffscreenCommandMessage).then(sendResponse);
    return true;
  },
);
