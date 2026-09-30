import type {
  ActionRecord,
  ConsoleLogRecord,
  NetworkErrorRecord,
  NetworkRequestRecord,
  SessionResultStatus,
} from "@testwitness/core";

import type {
  ExtensionStateSnapshot,
  PageContext,
  StartSessionInput,
  StoredSession,
} from "./types";

export const PROTOCOL_VERSION = 1 as const;
export const PAGE_CONTROL_CHANNEL = "testwitness:page-control:v1";
export const PAGE_EVIDENCE_CHANNEL = "testwitness:page-evidence:v1";
export const PAGE_STATUS_CHANNEL = "testwitness:page-status:v1";

export type EvidenceKind =
  "action" | "console" | "network-request" | "network-error";

export type EvidenceCandidate =
  | { kind: "action"; record: ActionRecord }
  | { kind: "console"; record: ConsoleLogRecord }
  | { kind: "network-request"; record: NetworkRequestRecord }
  | { kind: "network-error"; record: NetworkErrorRecord };

export type PanelMessage =
  | { version: 1; type: "panel:get-state" }
  | { version: 1; type: "panel:start"; input: StartSessionInput }
  | { version: 1; type: "panel:pause"; sessionId: string }
  | { version: 1; type: "panel:resume"; sessionId: string }
  | {
      version: 1;
      type: "panel:capture-screenshot";
      sessionId: string;
      label: string;
    }
  | { version: 1; type: "panel:add-note"; sessionId: string; text: string }
  | {
      version: 1;
      type: "panel:set-result";
      sessionId: string;
      result: SessionResultStatus;
    }
  | { version: 1; type: "panel:stop"; sessionId: string };

export interface LauncherMessage {
  version: 1;
  type: "launcher:activate-tab";
  tabId: number;
}

export interface ContentEvidenceMessage {
  version: 1;
  type: "content:evidence";
  sessionId: string;
  leaseId: string;
  candidate: EvidenceCandidate;
}

export interface ContentWarningMessage {
  version: 1;
  type: "content:warning";
  sessionId: string;
  leaseId: string;
  message: string;
}

export type ContentRuntimeMessage =
  ContentEvidenceMessage | ContentWarningMessage;

export type RuntimeRequest =
  | LauncherMessage
  | PanelMessage
  | ContentRuntimeMessage
  | OffscreenEventMessage;

export type RuntimeResponse<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: string; message: string; recoverable: boolean };
    };

export type WorkerContentMessage =
  | {
      version: 1;
      type: "worker:configure";
      sessionId: string;
      leaseId: string;
      config: StoredSession["config"];
      paused: boolean;
    }
  | { version: 1; type: "worker:pause"; sessionId: string; leaseId: string }
  | { version: 1; type: "worker:resume"; sessionId: string; leaseId: string }
  | { version: 1; type: "worker:stop"; sessionId: string; leaseId: string }
  | { version: 1; type: "worker:get-context" }
  | {
      version: 1;
      type: "worker:prepare-screenshot";
      sessionId: string;
      leaseId: string;
      maskSelectors: string[];
      excludeSelectors: string[];
    }
  | {
      version: 1;
      type: "worker:restore-screenshot";
      sessionId: string;
      leaseId: string;
    };

export type ContentResponse =
  | { ok: true; type: "context"; context: PageContext }
  | {
      ok: true;
      type: "configured" | "paused" | "resumed" | "stopped" | "restored";
    }
  | {
      ok: true;
      type: "screenshot-ready";
      context: Pick<PageContext, "url" | "title">;
    }
  | { ok: false; message: string };

export type PageBridgeControlMessage =
  | {
      channel: typeof PAGE_CONTROL_CHANNEL;
      type: "configure";
      sessionId: string;
      leaseId: string;
      config: StoredSession["config"];
      paused: boolean;
    }
  | {
      channel: typeof PAGE_CONTROL_CHANNEL;
      type: "pause" | "resume" | "stop";
      sessionId: string;
      leaseId: string;
    };

export interface PageBridgeEvidenceMessage {
  channel: typeof PAGE_EVIDENCE_CHANNEL;
  sessionId: string;
  leaseId: string;
  candidate: EvidenceCandidate;
}

export interface PageBridgeStatusMessage {
  channel: typeof PAGE_STATUS_CHANNEL;
  type: "configured" | "configuration-error";
  sessionId: string;
  leaseId: string;
  message?: string;
}

export type OffscreenCommandMessage =
  | {
      version: 1;
      type: "offscreen:start-video";
      sessionId: string;
      streamId: string;
      includeAudio: boolean;
      maxDurationMinutes: number;
    }
  | { version: 1; type: "offscreen:pause-video"; sessionId: string }
  | { version: 1; type: "offscreen:resume-video"; sessionId: string }
  | {
      version: 1;
      type: "offscreen:stop-video";
      sessionId: string;
      reason: "session-stopped" | "destroyed";
    };

export interface OffscreenEventMessage {
  version: 1;
  type: "offscreen:video-state";
  sessionId: string;
  state: "recording" | "paused" | "captured" | "unavailable";
  message?: string;
  sizeBytes?: number;
}

export interface StateChangedMessage {
  version: 1;
  type: "background:state-changed";
  state: ExtensionStateSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown, maximum = 4_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isResult(value: unknown): value is SessionResultStatus {
  return (
    value === "passed" ||
    value === "failed" ||
    value === "blocked" ||
    value === "not-set"
  );
}

export function parsePanelMessage(value: unknown): PanelMessage | undefined {
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    typeof value.type !== "string"
  ) {
    return undefined;
  }

  if (value.type === "panel:get-state") return value as PanelMessage;
  if (value.type === "panel:start" && isRecord(value.input))
    return value as PanelMessage;
  if (!isShortString(value.sessionId, 160)) return undefined;

  switch (value.type) {
    case "panel:pause":
    case "panel:resume":
    case "panel:stop":
      return value as PanelMessage;
    case "panel:capture-screenshot":
      return isShortString(value.label, 200)
        ? (value as PanelMessage)
        : undefined;
    case "panel:add-note":
      return isShortString(value.text, 4_000)
        ? (value as PanelMessage)
        : undefined;
    case "panel:set-result":
      return isResult(value.result) ? (value as PanelMessage) : undefined;
    default:
      return undefined;
  }
}

export function parseLauncherMessage(
  value: unknown,
): LauncherMessage | undefined {
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    value.type !== "launcher:activate-tab" ||
    typeof value.tabId !== "number" ||
    !Number.isSafeInteger(value.tabId) ||
    value.tabId < 0
  ) {
    return undefined;
  }
  return value as unknown as LauncherMessage;
}

export function parseContentRuntimeMessage(
  value: unknown,
): ContentRuntimeMessage | undefined {
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    !isShortString(value.sessionId, 160) ||
    !isShortString(value.leaseId, 160)
  ) {
    return undefined;
  }

  if (value.type === "content:warning" && isShortString(value.message, 1_000)) {
    return value as unknown as ContentWarningMessage;
  }
  if (value.type !== "content:evidence" || !isRecord(value.candidate))
    return undefined;
  if (
    !["action", "console", "network-request", "network-error"].includes(
      String(value.candidate.kind),
    ) ||
    !isRecord(value.candidate.record)
  ) {
    return undefined;
  }

  try {
    if (JSON.stringify(value.candidate).length > 256 * 1024) return undefined;
  } catch {
    return undefined;
  }
  return value as unknown as ContentEvidenceMessage;
}

export function isOffscreenEvent(
  value: unknown,
): value is OffscreenEventMessage {
  return (
    isRecord(value) &&
    value.version === PROTOCOL_VERSION &&
    value.type === "offscreen:video-state" &&
    isShortString(value.sessionId, 160) &&
    ["recording", "paused", "captured", "unavailable"].includes(
      String(value.state),
    )
  );
}
