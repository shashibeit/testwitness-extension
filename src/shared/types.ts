import type {
  EvidenceCounts,
  ResolvedTestWitnessConfig,
  SessionMetadata,
  SessionResultStatus,
  SessionStartMetadata,
  SessionSummary,
  SessionWarning,
  VideoCaptureStatus,
} from "@testwitness/core";

export type ExtensionSessionPhase =
  | "starting"
  | "recording"
  | "paused"
  | "awaiting-page"
  | "stopping"
  | "stopped"
  | "failed";

export type PageAccessState =
  | "unknown"
  | "injecting"
  | "ready"
  | "permission-required"
  | "unsupported"
  | "degraded";

export type ExtensionWarningCode =
  | SessionWarning["code"]
  | "HOST_PERMISSION_REQUIRED"
  | "PAGE_ACCESS_LOST"
  | "CAPTURE_GAP"
  | "TARGET_TAB_INACTIVE"
  | "TARGET_TAB_CLOSED"
  | "SERVICE_WORKER_RECOVERED"
  | "VIDEO_INTERRUPTED"
  | "STORAGE_QUOTA_REACHED";

export interface ExtensionWarning {
  code: ExtensionWarningCode;
  message: string;
  timestamp: string;
  severity: "info" | "warning" | "error";
}

export interface CapturePreferences {
  captureVideo: boolean;
  includeAudio: boolean;
  automaticScreenshots: boolean;
  captureRequestBody: boolean;
  captureResponseBody: boolean;
  maxVideoDurationMinutes: number;
  maskSelectors: string[];
  excludeSelectors: string[];
  sensitiveQueryParameters: string[];
}

export interface StartSessionInput {
  applicationName: string;
  environment: string;
  releaseVersion?: string;
  metadata: SessionStartMetadata;
  preferences: CapturePreferences;
}

export interface PageContext {
  url: string;
  title: string;
  userAgent: string;
  platform: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
}

export interface StoredSession {
  schemaVersion: 1;
  revision: number;
  sessionId: string;
  phase: ExtensionSessionPhase;
  result: SessionResultStatus;
  targetTabId: number;
  targetWindowId: number;
  targetOrigin: string;
  leaseId: string;
  pageAccess: PageAccessState;
  metadata: SessionMetadata;
  config: ResolvedTestWitnessConfig;
  preferences: CapturePreferences;
  counts: EvidenceCounts;
  approximateSizeBytes: number;
  evidenceOrdinal: number;
  actionSequence: number;
  screenshotSequence: number;
  videoStatus: VideoCaptureStatus;
  warnings: ExtensionWarning[];
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
}

export interface TabContextSnapshot {
  tabId?: number;
  windowId?: number;
  title: string;
  url: string;
  origin: string;
  supported: boolean;
  reason?: string;
}

export interface ExtensionStateSnapshot {
  activeTab: TabContextSnapshot;
  session?: Omit<StoredSession, "leaseId" | "config">;
}

export function toPublicSession(
  session: StoredSession,
): ExtensionStateSnapshot["session"] {
  const { leaseId: _leaseId, config: _config, ...publicSession } = session;
  void _leaseId;
  void _config;
  return publicSession;
}

export function toCoreSummary(session: StoredSession): SessionSummary {
  return {
    sessionId: session.sessionId,
    status:
      session.phase === "paused"
        ? "paused"
        : session.phase === "stopped" || session.phase === "failed"
          ? "stopped"
          : "recording",
    result: session.result,
    startedAt: session.metadata.startedAt,
    endedAt: session.endedAt,
    durationMs: session.metadata.durationMs,
    evidence: { ...session.counts },
    approximateSizeBytes: session.approximateSizeBytes,
    memoryWarningReached: session.warnings.some(
      (warning) => warning.code === "MEMORY_THRESHOLD_REACHED",
    ),
    videoStatus: session.videoStatus,
    videoRecording:
      session.videoStatus === "recording" || session.videoStatus === "paused",
    warnings: session.warnings
      .filter(
        (
          warning,
        ): warning is ExtensionWarning & { code: SessionWarning["code"] } =>
          [
            "VIDEO_UNAVAILABLE",
            "VIDEO_ENDED",
            "CAPTURE_FAILED",
            "SCREENSHOT_LIMIT_REACHED",
            "MEMORY_THRESHOLD_REACHED",
            "RECORDER_ERROR",
          ].includes(warning.code),
      )
      .map(({ code, message, timestamp }) => ({ code, message, timestamp })),
  };
}
