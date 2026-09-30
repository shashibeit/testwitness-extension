import {
  DataSanitizer,
  type EvidenceCounts,
  type NoteRecord,
  type SessionMetadata,
  type SessionResultStatus,
  type ScreenshotRecord,
  type VideoRecord,
} from "@testwitness/core";

import type { ExtensionBrowserApi } from "../browser/ChromeExtensionApi";
import { VisibleTabScreenshotCapture } from "../capture/VisibleTabScreenshotCapture";
import { normalizeEvidenceCandidate } from "../evidence/normalize";
import {
  detectBrowser,
  detectOperatingSystem,
  pageSupport,
  urlOrigin,
} from "../shared/browser";
import { resolveExtensionConfig } from "../shared/config";
import { ExtensionError } from "../shared/errors";
import { createId, createSessionId } from "../shared/ids";
import {
  PROTOCOL_VERSION,
  type ContentRuntimeMessage,
  type OffscreenEventMessage,
  type PanelMessage,
  type StateChangedMessage,
} from "../shared/protocol";
import {
  type CapturePreferences,
  type ExtensionStateSnapshot,
  type ExtensionWarning,
  type PageContext,
  type StartSessionInput,
  type StoredSession,
  toPublicSession,
} from "../shared/types";
import type { IndexedDbEvidenceRepository } from "../storage/IndexedDbEvidenceRepository";

interface CoordinatorOptions {
  repository: IndexedDbEvidenceRepository;
  browser: ExtensionBrowserApi;
  screenshots?: VisibleTabScreenshotCapture;
  now?: () => Date;
}

interface ContentSender {
  tabId?: number;
  frameId?: number;
}

const ACTIVE_PHASES = new Set<StoredSession["phase"]>([
  "starting",
  "recording",
  "paused",
  "awaiting-page",
  "stopping",
]);
const MAX_WARNINGS = 50;

function emptyCounts(): EvidenceCounts {
  return {
    screenshots: 0,
    actions: 0,
    consoleLogs: 0,
    networkRequests: 0,
    successfulRequests: 0,
    networkErrors: 0,
    notes: 0,
    hasVideo: false,
  };
}

function encodedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  } catch {
    return 0;
  }
}

function boundedString(
  value: unknown,
  name: string,
  maximum: number,
  required = false,
): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new ExtensionError("INVALID_MESSAGE", `${name} must be a string.`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new ExtensionError("INVALID_MESSAGE", `${name} is required.`);
  }
  if (trimmed.length > maximum) {
    throw new ExtensionError(
      "INVALID_MESSAGE",
      `${name} must be ${maximum} characters or fewer.`,
    );
  }
  return trimmed;
}

function boundedStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 50) {
    throw new ExtensionError(
      "INVALID_MESSAGE",
      `${name} supports at most 50 entries.`,
    );
  }
  return value.map((entry, index) =>
    boundedString(entry, `${name}[${index}]`, 500, true),
  );
}

function normalizedPreferences(value: CapturePreferences): CapturePreferences {
  const duration = Number(value.maxVideoDurationMinutes);
  return {
    captureVideo: value.captureVideo === true,
    includeAudio: value.includeAudio === true,
    automaticScreenshots: value.automaticScreenshots === true,
    captureRequestBody: value.captureRequestBody === true,
    captureResponseBody: value.captureResponseBody === true,
    maxVideoDurationMinutes:
      Number.isFinite(duration) && duration >= 1 && duration <= 180
        ? Math.floor(duration)
        : 30,
    maskSelectors: boundedStringArray(value.maskSelectors, "Mask selectors"),
    excludeSelectors: boundedStringArray(
      value.excludeSelectors,
      "Exclude selectors",
    ),
    sensitiveQueryParameters: boundedStringArray(
      value.sensitiveQueryParameters,
      "Sensitive query parameters",
    ),
  };
}

function normalizedStartInput(input: StartSessionInput): StartSessionInput {
  if (!input || typeof input !== "object") {
    throw new ExtensionError(
      "INVALID_MESSAGE",
      "Session settings are missing.",
    );
  }
  if (!input.preferences || typeof input.preferences !== "object") {
    throw new ExtensionError(
      "INVALID_MESSAGE",
      "Capture preferences are missing.",
    );
  }
  const metadata =
    input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  return {
    applicationName: boundedString(
      input.applicationName,
      "Application name",
      200,
      true,
    ),
    environment: boundedString(input.environment, "Environment", 100, true),
    releaseVersion:
      boundedString(input.releaseVersion, "Release version", 200) || undefined,
    metadata: {
      testCaseId:
        boundedString(metadata.testCaseId, "Test case ID", 200) || undefined,
      testCaseName:
        boundedString(metadata.testCaseName, "Test case name", 300) ||
        undefined,
      requirementId:
        boundedString(metadata.requirementId, "Requirement ID", 200) ||
        undefined,
      testerName:
        boundedString(metadata.testerName, "Tester name", 200) || undefined,
      testerEmployeeId:
        boundedString(metadata.testerEmployeeId, "Tester employee ID", 200) ||
        undefined,
      custom: {},
    },
    preferences: normalizedPreferences(input.preferences),
  };
}

function warning(
  code: ExtensionWarning["code"],
  message: string,
  severity: ExtensionWarning["severity"] = "warning",
): ExtensionWarning {
  return { code, message, severity, timestamp: new Date().toISOString() };
}

function addWarning(session: StoredSession, value: ExtensionWarning): void {
  session.warnings = [...session.warnings.slice(-(MAX_WARNINGS - 1)), value];
}

function touch(session: StoredSession, now: Date): void {
  session.revision += 1;
  session.updatedAt = now.toISOString();
}

/** Coordinates one persisted, tab-scoped evidence session across MV3 extension contexts. */
export class ExtensionSessionCoordinator {
  readonly #repository: IndexedDbEvidenceRepository;
  readonly #browser: ExtensionBrowserApi;
  readonly #screenshots: VisibleTabScreenshotCapture;
  readonly #now: () => Date;
  #activeTabId?: number;
  #mutationQueue: Promise<void> = Promise.resolve();

  public constructor(options: CoordinatorOptions) {
    this.#repository = options.repository;
    this.#browser = options.browser;
    this.#screenshots =
      options.screenshots ?? new VisibleTabScreenshotCapture();
    this.#now = options.now ?? (() => new Date());
  }

  public async initialize(): Promise<void> {
    await this.enqueue(async () => {
      const latest = await this.#repository.getLatestSession();
      if (!latest || !ACTIVE_PHASES.has(latest.phase)) return;
      addWarning(
        latest,
        warning(
          "SERVICE_WORKER_RECOVERED",
          "The extension worker restarted and restored the active session.",
          "info",
        ),
      );
      touch(latest, this.#now());
      await this.#repository.saveSession(latest);
      await this.updateBadge(latest);
      await this.broadcastState();
    });
  }

  public async getState(): Promise<ExtensionStateSnapshot> {
    const [tab, latest] = await Promise.all([
      this.resolveActiveTab(),
      this.#repository.getLatestSession(),
    ]);
    const support = pageSupport(tab?.url);
    const sanitizer = new DataSanitizer(latest?.config.privacy);
    return {
      activeTab: {
        tabId: tab?.id,
        windowId: tab?.windowId,
        title: sanitizer.sanitizeText(
          tab?.title ?? (tab ? "Site access needed" : "No active tab"),
          300,
        ),
        url: tab?.url ? sanitizer.sanitizeUrl(tab.url) : "",
        origin: urlOrigin(tab?.url),
        supported: support.supported,
        reason: support.reason,
      },
      session: latest ? toPublicSession(latest) : undefined,
    };
  }

  public async handleActiveTabChanged(tabId?: number): Promise<void> {
    if (tabId !== undefined) this.#activeTabId = tabId;
    await this.broadcastState();
  }

  public async handlePanel(message: PanelMessage): Promise<unknown> {
    if (message.type === "panel:get-state") return this.getState();
    return this.enqueue(async () => {
      switch (message.type) {
        case "panel:start":
          return this.startSession(message.input);
        case "panel:pause":
          return this.pauseSession(message.sessionId);
        case "panel:resume":
          return this.resumeSession(message.sessionId);
        case "panel:capture-screenshot":
          return this.captureScreenshot(
            message.sessionId,
            message.label,
            false,
          );
        case "panel:add-note":
          return this.addNote(message.sessionId, message.text);
        case "panel:set-result":
          return this.setResult(message.sessionId, message.result);
        case "panel:stop":
          return this.stopSession(message.sessionId);
      }
    });
  }

  public async handleContent(
    message: ContentRuntimeMessage,
    sender: ContentSender,
  ): Promise<unknown> {
    return this.enqueue(async () => {
      const session = await this.requireSession(message.sessionId);
      if (
        sender.tabId !== session.targetTabId ||
        (sender.frameId !== undefined && sender.frameId !== 0) ||
        message.leaseId !== session.leaseId
      ) {
        throw new ExtensionError(
          "INVALID_MESSAGE",
          "Rejected evidence from a stale or foreign page.",
        );
      }
      if (message.type === "content:warning") {
        addWarning(session, warning("RECORDER_ERROR", message.message));
        touch(session, this.#now());
        await this.#repository.saveSession(session);
        await this.broadcastState();
        return { accepted: true };
      }
      if (session.phase !== "recording")
        return { accepted: false, reason: "session-not-recording" };

      const sanitizer = new DataSanitizer(session.config.privacy);
      const normalized = normalizeEvidenceCandidate(
        message.candidate,
        sanitizer,
        session.config,
        session.actionSequence + 1,
      );
      if (!normalized) {
        throw new ExtensionError(
          "INVALID_MESSAGE",
          "The page supplied an invalid evidence record.",
        );
      }

      const evidenceOrdinal = session.evidenceOrdinal + 1;
      try {
        await this.#repository.addEvidence(
          session.sessionId,
          normalized.kind,
          evidenceOrdinal,
          normalized.record,
        );
      } catch (error) {
        addWarning(
          session,
          warning(
            "STORAGE_QUOTA_REACHED",
            "Evidence could not be stored. Check available browser storage before continuing.",
            "error",
          ),
        );
        touch(session, this.#now());
        await this.#repository.saveSession(session).catch(() => undefined);
        await this.broadcastState().catch(() => undefined);
        throw new ExtensionError(
          "STORAGE_FAILED",
          error instanceof Error
            ? `Evidence storage failed: ${error.message}`
            : "Evidence storage failed.",
        );
      }

      session.evidenceOrdinal = evidenceOrdinal;
      if (normalized.kind === "action") {
        session.actionSequence = normalized.record.sequence;
        session.counts.actions += 1;
      } else if (normalized.kind === "console") {
        session.counts.consoleLogs += 1;
      } else if (normalized.kind === "network-request") {
        session.counts.networkRequests += 1;
        if (normalized.record.outcome === "success")
          session.counts.successfulRequests += 1;
      } else {
        session.counts.networkErrors += 1;
      }
      session.approximateSizeBytes += encodedSize(normalized.record);
      touch(session, this.#now());
      await this.#repository.saveSession(session);
      await this.broadcastState();

      if (
        normalized.kind === "action" &&
        session.preferences.automaticScreenshots &&
        [
          "navigation",
          "history-push",
          "history-replace",
          "popstate",
          "hashchange",
        ].includes(normalized.record.type)
      ) {
        await this.captureScreenshot(
          session.sessionId,
          "Navigation checkpoint",
          true,
        );
      }
      return { accepted: true };
    });
  }

  public async handleVideoEvent(message: OffscreenEventMessage): Promise<void> {
    await this.enqueue(async () => {
      const session = await this.#repository.getSession(message.sessionId);
      if (!session) return;
      if (
        (session.phase === "stopped" || session.phase === "failed") &&
        (message.state === "recording" || message.state === "paused")
      ) {
        return;
      }
      session.videoStatus = message.state;
      if (message.state === "captured") {
        const videos = await this.#repository.listEvidence<VideoRecord>(
          session.sessionId,
          "video",
        );
        const video = videos[0];
        const previouslyHadVideo = session.counts.hasVideo;
        session.counts.hasVideo = Boolean(video);
        if (video && !previouslyHadVideo)
          session.approximateSizeBytes += video.blob.size;
        if (
          video &&
          session.phase !== "stopping" &&
          session.phase !== "stopped" &&
          (video.stopReason === "user-ended-sharing" ||
            video.stopReason === "duration-limit")
        ) {
          addWarning(
            session,
            warning(
              "VIDEO_ENDED",
              video.stopReason === "duration-limit"
                ? "Video reached its duration limit. Other evidence capture is continuing."
                : "Tab video sharing ended. Other evidence capture is continuing.",
            ),
          );
        }
      } else if (message.state === "unavailable") {
        addWarning(
          session,
          warning(
            "VIDEO_UNAVAILABLE",
            message.message ??
              "Video is unavailable. Other evidence capture is continuing.",
          ),
        );
      }
      touch(session, this.#now());
      await this.#repository.saveSession(session);
      await this.broadcastState();
    });
  }

  public async handleTabUpdated(tabId: number, status?: string): Promise<void> {
    if (status !== "complete") return;
    await this.enqueue(async () => {
      const session = await this.#repository.getActiveSessionForTab(tabId);
      if (
        !session ||
        (session.phase !== "recording" && session.phase !== "paused")
      ) {
        await this.broadcastState();
        return;
      }
      session.leaseId = createId("lease");
      session.pageAccess = "injecting";
      touch(session, this.#now());
      await this.#repository.saveSession(session);
      try {
        const context = await this.attachPage(session);
        const sanitizer = new DataSanitizer(session.config.privacy);
        session.metadata.currentUrl = sanitizer.sanitizeUrl(context.url);
        session.metadata.pageTitle = sanitizer.sanitizeText(context.title, 300);
        session.metadata.viewport = { ...context.viewport };
        session.metadata.screen = { ...context.screen };
        session.targetOrigin = urlOrigin(context.url);
        session.pageAccess = "ready";
      } catch {
        session.pageAccess = "permission-required";
        addWarning(
          session,
          warning(
            "HOST_PERMISSION_REQUIRED",
            "Page capture could not reconnect after navigation. Click the TestWitness extension icon on this page to grant access again.",
          ),
        );
      }
      touch(session, this.#now());
      await this.#repository.saveSession(session);
      await this.broadcastState();
      if (
        session.phase === "recording" &&
        session.pageAccess === "ready" &&
        session.preferences.automaticScreenshots
      ) {
        await this.captureScreenshot(session.sessionId, "Page loaded", true);
      }
    });
  }

  public async handleTabRemoved(tabId: number): Promise<void> {
    if (this.#activeTabId === tabId) this.#activeTabId = undefined;
    await this.enqueue(async () => {
      const session = await this.#repository.getActiveSessionForTab(tabId);
      if (!session) return;
      addWarning(
        session,
        warning(
          "TARGET_TAB_CLOSED",
          "The recorded tab was closed, so the session was finalized.",
        ),
      );
      if (
        session.videoStatus === "recording" ||
        session.videoStatus === "paused"
      ) {
        await this.#browser
          .sendOffscreen({
            version: PROTOCOL_VERSION,
            type: "offscreen:stop-video",
            sessionId: session.sessionId,
            reason: "destroyed",
          })
          .catch(() => undefined);
      }
      this.finalizeMetadata(session, undefined);
      session.phase = "stopped";
      const videos = await this.#repository.listEvidence<VideoRecord>(
        session.sessionId,
        "video",
      );
      session.counts.hasVideo = videos.length > 0;
      session.videoStatus = videos.length > 0 ? "captured" : "unavailable";
      touch(session, this.#now());
      await this.#repository.saveSession(session);
      await this.broadcastState();
    });
  }

  private async startSession(
    rawInput: StartSessionInput,
  ): Promise<ExtensionStateSnapshot> {
    const existing = await this.#repository.getLatestSession();
    if (existing && ACTIVE_PHASES.has(existing.phase)) {
      throw new ExtensionError(
        "SESSION_ALREADY_ACTIVE",
        "Stop the current TestWitness session before starting another one.",
      );
    }

    const input = normalizedStartInput(rawInput);
    const config = resolveExtensionConfig(input);
    const tab = await this.resolveActiveTab();
    const support = pageSupport(tab?.url);
    if (typeof tab?.id !== "number" || tab.windowId === undefined) {
      throw new ExtensionError(
        "TAB_NOT_FOUND",
        "No active browser tab is available.",
      );
    }
    if (!support.supported) {
      throw new ExtensionError(
        "UNSUPPORTED_PAGE",
        support.reason ?? "This page is unsupported.",
      );
    }

    await this.#browser.injectScript(tab.id, "content-script.js", "ISOLATED");
    await this.#browser.injectScript(tab.id, "page-bridge.js", "MAIN");
    const context = await this.getPageContext(tab.id);
    const sanitizer = new DataSanitizer(config.privacy);
    const startedAt = this.#now();
    const sessionId = createSessionId();
    const metadata: SessionMetadata = {
      sessionId,
      applicationName: sanitizer.sanitizeText(config.applicationName, 200),
      environment: sanitizer.sanitizeText(config.environment, 100),
      releaseVersion: config.releaseVersion
        ? sanitizer.sanitizeText(config.releaseVersion, 200)
        : undefined,
      testerName: input.metadata.testerName
        ? sanitizer.sanitizeText(input.metadata.testerName, 200)
        : undefined,
      testerEmployeeId: input.metadata.testerEmployeeId
        ? sanitizer.sanitizeText(input.metadata.testerEmployeeId, 200)
        : undefined,
      testCaseId: input.metadata.testCaseId
        ? sanitizer.sanitizeText(input.metadata.testCaseId, 200)
        : undefined,
      testCaseName: input.metadata.testCaseName
        ? sanitizer.sanitizeText(input.metadata.testCaseName, 300)
        : undefined,
      requirementId: input.metadata.requirementId
        ? sanitizer.sanitizeText(input.metadata.requirementId, 200)
        : undefined,
      startedAt: startedAt.toISOString(),
      durationMs: 0,
      currentUrl: sanitizer.sanitizeUrl(context.url),
      pageTitle: sanitizer.sanitizeText(context.title, 300),
      browser: detectBrowser(context.userAgent),
      operatingSystem: detectOperatingSystem(
        context.userAgent,
        context.platform,
      ),
      viewport: { ...context.viewport },
      screen: { ...context.screen },
      libraryVersion: `@testwitness/extension-standard/${__TEST_WITNESS_EXTENSION_VERSION__}`,
      result: "not-set",
      custom: {},
    };
    const session: StoredSession = {
      schemaVersion: 1,
      revision: 1,
      sessionId,
      phase: "starting",
      result: "not-set",
      targetTabId: tab.id,
      targetWindowId: tab.windowId,
      targetOrigin: urlOrigin(context.url),
      leaseId: createId("lease"),
      pageAccess: "ready",
      metadata,
      config,
      preferences: input.preferences,
      counts: emptyCounts(),
      approximateSizeBytes: encodedSize(metadata),
      evidenceOrdinal: 0,
      actionSequence: 0,
      screenshotSequence: 0,
      videoStatus: input.preferences.captureVideo
        ? "requesting-permission"
        : "off",
      warnings: [],
      createdAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString(),
    };
    await this.#repository.saveSession(session);
    await this.configurePage(session);
    session.phase = "recording";
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.updateBadge(session);
    await this.broadcastState();

    if (input.preferences.captureVideo) await this.startVideo(session);
    if (input.preferences.automaticScreenshots) {
      await this.captureScreenshot(session.sessionId, "Session started", true);
    }
    await this.#repository.pruneCompletedSessions(5);
    return this.getState();
  }

  private async pauseSession(
    sessionId: string,
  ): Promise<ExtensionStateSnapshot> {
    const session = await this.requireSession(sessionId);
    if (session.phase !== "recording") {
      throw new ExtensionError(
        "INVALID_STATE",
        "Only a recording session can be paused.",
      );
    }
    await this.#browser
      .sendToTab(session.targetTabId, {
        version: PROTOCOL_VERSION,
        type: "worker:pause",
        sessionId,
        leaseId: session.leaseId,
      })
      .catch(() => undefined);
    if (session.videoStatus === "recording") {
      await this.#browser.sendOffscreen({
        version: PROTOCOL_VERSION,
        type: "offscreen:pause-video",
        sessionId,
      });
      session.videoStatus = "paused";
    }
    session.phase = "paused";
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.updateBadge(session);
    await this.broadcastState();
    return this.getState();
  }

  private async resumeSession(
    sessionId: string,
  ): Promise<ExtensionStateSnapshot> {
    const session = await this.requireSession(sessionId);
    if (session.phase !== "paused") {
      throw new ExtensionError(
        "INVALID_STATE",
        "Only a paused session can be resumed.",
      );
    }
    await this.#browser
      .sendToTab(session.targetTabId, {
        version: PROTOCOL_VERSION,
        type: "worker:resume",
        sessionId,
        leaseId: session.leaseId,
      })
      .catch(() => undefined);
    if (session.videoStatus === "paused") {
      await this.#browser.sendOffscreen({
        version: PROTOCOL_VERSION,
        type: "offscreen:resume-video",
        sessionId,
      });
      session.videoStatus = "recording";
    }
    session.phase = "recording";
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.updateBadge(session);
    await this.broadcastState();
    return this.getState();
  }

  private async captureScreenshot(
    sessionId: string,
    label: string,
    automatic: boolean,
  ): Promise<ExtensionStateSnapshot> {
    const session = await this.requireSession(sessionId);
    if (session.phase !== "recording") {
      if (automatic) return this.getState();
      throw new ExtensionError(
        "INVALID_STATE",
        "Resume the session before taking a screenshot.",
      );
    }
    try {
      const record = await this.#screenshots.capture(
        session,
        label,
        session.actionSequence,
      );
      await this.persistScreenshot(session, record);
      await this.broadcastState();
      return this.getState();
    } catch (error) {
      if (!automatic) throw error;
      const message = error instanceof Error ? error.message : String(error);
      addWarning(session, warning("CAPTURE_FAILED", message));
      touch(session, this.#now());
      await this.#repository.saveSession(session);
      await this.broadcastState();
      return this.getState();
    }
  }

  private async persistScreenshot(
    session: StoredSession,
    record: ScreenshotRecord,
  ): Promise<void> {
    session.evidenceOrdinal += 1;
    await this.#repository.addEvidence(
      session.sessionId,
      "screenshot",
      session.evidenceOrdinal,
      record,
    );
    session.screenshotSequence += 1;
    session.counts.screenshots += 1;
    session.approximateSizeBytes +=
      record.blob.size + encodedSize({ ...record, blob: undefined });
    touch(session, this.#now());
    await this.#repository.saveSession(session);
  }

  private async addNote(
    sessionId: string,
    rawText: string,
  ): Promise<ExtensionStateSnapshot> {
    const session = await this.requireSession(sessionId);
    if (
      !ACTIVE_PHASES.has(session.phase) ||
      session.phase === "starting" ||
      session.phase === "stopping"
    ) {
      throw new ExtensionError(
        "INVALID_STATE",
        "Notes can only be added to an active session.",
      );
    }
    const sanitizer = new DataSanitizer(session.config.privacy);
    const text = sanitizer.sanitizeText(
      boundedString(rawText, "Note", 4_000, true),
      4_000,
    );
    const note: NoteRecord = {
      id: createId("note"),
      timestamp: this.#now().toISOString(),
      text,
      url: sanitizer.sanitizeUrl(session.metadata.currentUrl),
      actionSequence: session.actionSequence,
    };
    session.evidenceOrdinal += 1;
    await this.#repository.addEvidence(
      sessionId,
      "note",
      session.evidenceOrdinal,
      note,
    );
    session.counts.notes += 1;
    session.approximateSizeBytes += encodedSize(note);
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.broadcastState();
    return this.getState();
  }

  private async setResult(
    sessionId: string,
    result: SessionResultStatus,
  ): Promise<ExtensionStateSnapshot> {
    const session = await this.requireSession(sessionId);
    session.result = result;
    session.metadata.result = result;
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.broadcastState();
    return this.getState();
  }

  private async stopSession(
    sessionId: string,
  ): Promise<ExtensionStateSnapshot> {
    const session = await this.requireSession(sessionId);
    if (session.phase === "stopped") return this.getState();
    session.phase = "stopping";
    if (
      session.videoStatus === "recording" ||
      session.videoStatus === "paused"
    ) {
      session.videoStatus = "finalizing";
    }
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.broadcastState();

    await this.#browser
      .sendToTab(session.targetTabId, {
        version: PROTOCOL_VERSION,
        type: "worker:stop",
        sessionId,
        leaseId: session.leaseId,
      })
      .catch(() => undefined);
    if (
      session.videoStatus === "finalizing" ||
      session.videoStatus === "requesting-permission"
    ) {
      const response = await this.#browser
        .sendOffscreen({
          version: PROTOCOL_VERSION,
          type: "offscreen:stop-video",
          sessionId,
          reason: "session-stopped",
        })
        .catch(() => undefined);
      if (response && !response.ok) {
        addWarning(
          session,
          warning("VIDEO_UNAVAILABLE", response.error.message),
        );
      }
    }

    const context = await this.getPageContext(session.targetTabId).catch(
      () => undefined,
    );
    this.finalizeMetadata(session, context);
    const videos = await this.#repository.listEvidence<VideoRecord>(
      session.sessionId,
      "video",
    );
    const video = videos[0];
    const previouslyHadVideo = session.counts.hasVideo;
    session.videoStatus = video
      ? "captured"
      : session.preferences.captureVideo
        ? "unavailable"
        : "off";
    if (video && !previouslyHadVideo)
      session.approximateSizeBytes += video.blob.size;
    session.counts.hasVideo = Boolean(video);
    session.phase = "stopped";
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.updateBadge(session);
    await this.broadcastState();
    return this.getState();
  }

  private async startVideo(session: StoredSession): Promise<void> {
    session.videoStatus = "requesting-permission";
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.broadcastState();
    try {
      await this.#browser.ensureOffscreenDocument();
      const streamId = await this.#browser.getTabMediaStreamId(
        session.targetTabId,
      );
      const response = await this.#browser.sendOffscreen({
        version: PROTOCOL_VERSION,
        type: "offscreen:start-video",
        sessionId: session.sessionId,
        streamId,
        includeAudio: session.preferences.includeAudio,
        maxDurationMinutes: session.preferences.maxVideoDurationMinutes,
      });
      if (!response.ok) throw new Error(response.error.message);
      session.videoStatus = "recording";
    } catch (error) {
      session.videoStatus = "unavailable";
      addWarning(
        session,
        warning(
          "VIDEO_UNAVAILABLE",
          `${error instanceof Error ? error.message : String(error)} Other evidence capture remains active.`,
        ),
      );
    }
    touch(session, this.#now());
    await this.#repository.saveSession(session);
    await this.broadcastState();
  }

  private async attachPage(session: StoredSession): Promise<PageContext> {
    await this.#browser.injectScript(
      session.targetTabId,
      "content-script.js",
      "ISOLATED",
    );
    await this.#browser.injectScript(
      session.targetTabId,
      "page-bridge.js",
      "MAIN",
    );
    const context = await this.getPageContext(session.targetTabId);
    await this.configurePage(session);
    return context;
  }

  private async configurePage(session: StoredSession): Promise<void> {
    const response = await this.#browser.sendToTab(session.targetTabId, {
      version: PROTOCOL_VERSION,
      type: "worker:configure",
      sessionId: session.sessionId,
      leaseId: session.leaseId,
      config: session.config,
      paused: session.phase === "paused",
    });
    if (!response.ok || response.type !== "configured") {
      throw new ExtensionError(
        "INSTRUMENTATION_FAILED",
        response.ok
          ? "The page did not confirm instrumentation."
          : response.message,
      );
    }
  }

  private async getPageContext(tabId: number): Promise<PageContext> {
    const response = await this.#browser.sendToTab(tabId, {
      version: PROTOCOL_VERSION,
      type: "worker:get-context",
    });
    if (!response.ok || response.type !== "context") {
      throw new ExtensionError(
        "INSTRUMENTATION_FAILED",
        response.ok ? "The page did not return its context." : response.message,
      );
    }
    return response.context;
  }

  private finalizeMetadata(
    session: StoredSession,
    context: PageContext | undefined,
  ): void {
    const endedAt = this.#now();
    const startedAt = new Date(session.metadata.startedAt);
    const sanitizer = new DataSanitizer(session.config.privacy);
    session.endedAt = endedAt.toISOString();
    session.metadata = {
      ...session.metadata,
      endedAt: session.endedAt,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
      currentUrl: context
        ? sanitizer.sanitizeUrl(context.url)
        : sanitizer.sanitizeUrl(session.metadata.currentUrl),
      pageTitle: context
        ? sanitizer.sanitizeText(context.title, 300)
        : session.metadata.pageTitle,
      viewport: context ? { ...context.viewport } : session.metadata.viewport,
      screen: context ? { ...context.screen } : session.metadata.screen,
      result: session.result,
      custom: { ...session.metadata.custom },
    };
  }

  private async requireSession(sessionId: string): Promise<StoredSession> {
    const session = await this.#repository.getSession(sessionId);
    if (!session)
      throw new ExtensionError(
        "NO_ACTIVE_SESSION",
        "The TestWitness session was not found.",
      );
    return session;
  }

  private async updateBadge(session: StoredSession): Promise<void> {
    const presentation =
      session.phase === "recording"
        ? { text: "REC", color: "#a51d2d" }
        : session.phase === "paused"
          ? { text: "II", color: "#805000" }
          : session.phase === "stopped"
            ? { text: "OK", color: "#176b3a" }
            : { text: "…", color: "#1769aa" };
    await this.#browser
      .setBadge(session.targetTabId, presentation.text, presentation.color)
      .catch(() => undefined);
  }

  private async resolveActiveTab(): Promise<
    Awaited<ReturnType<ExtensionBrowserApi["getActiveTab"]>>
  > {
    if (this.#activeTabId !== undefined) {
      const cached = await this.#browser
        .getTab(this.#activeTabId)
        .catch(() => undefined);
      if (cached?.active) return cached;
      this.#activeTabId = undefined;
    }
    const tab = await this.#browser.getActiveTab().catch(() => undefined);
    if (typeof tab?.id === "number") this.#activeTabId = tab.id;
    return tab;
  }

  private async broadcastState(): Promise<void> {
    const message: StateChangedMessage = {
      version: PROTOCOL_VERSION,
      type: "background:state-changed",
      state: await this.getState(),
    };
    await this.#browser.broadcast(message);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
