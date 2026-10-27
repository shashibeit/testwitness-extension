import {
  ActionRecorder,
  ConsoleRecorder,
  DataSanitizer,
  NetworkRecorder,
  type ResolvedTestWitnessConfig,
} from "@testwitness/core";

import {
  PAGE_CONTROL_CHANNEL,
  PAGE_EVIDENCE_CHANNEL,
  PAGE_STATUS_CHANNEL,
  type EvidenceCandidate,
  type PageBridgeControlMessage,
  type PageBridgeEvidenceMessage,
  type PageBridgeStatusMessage,
} from "../shared/protocol";

const BRIDGE_KEY = "__testWitnessPageBridgeV1__";

interface ActiveBridge {
  sessionId: string;
  leaseId: string;
  actionRecorder: ActionRecorder;
  consoleRecorder: ConsoleRecorder;
  networkRecorder: NetworkRecorder;
}

interface PageBridgeController {
  configure(
    sessionId: string,
    leaseId: string,
    config: ResolvedTestWitnessConfig,
    paused: boolean,
  ): void;
  pause(sessionId: string, leaseId: string): boolean;
  resume(sessionId: string, leaseId: string): boolean;
  stop(sessionId: string, leaseId: string): boolean;
}

interface PageGlobal extends Window {
  [BRIDGE_KEY]?: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isControlMessage(value: unknown): value is PageBridgeControlMessage {
  if (!isRecord(value) || value.channel !== PAGE_CONTROL_CHANNEL) return false;
  if (!["configure", "pause", "resume", "stop"].includes(String(value.type)))
    return false;
  return (
    typeof value.controlId === "string" &&
    value.controlId.length <= 160 &&
    typeof value.sessionId === "string" &&
    typeof value.leaseId === "string"
  );
}

function installBridge(): PageBridgeController {
  let active: ActiveBridge | undefined;

  function emitStatus(
    sessionId: string,
    leaseId: string,
    controlId: string,
    type: PageBridgeStatusMessage["type"],
    message?: string,
  ): void {
    const status: PageBridgeStatusMessage = {
      channel: PAGE_STATUS_CHANNEL,
      type,
      controlId,
      sessionId,
      leaseId,
      ...(message ? { message: message.slice(0, 1_000) } : {}),
    };
    window.postMessage(status, window.location.origin);
  }

  function matches(sessionId: string, leaseId: string): boolean {
    return active?.sessionId === sessionId && active.leaseId === leaseId;
  }

  function emit(
    sessionId: string,
    leaseId: string,
    candidate: EvidenceCandidate,
  ): void {
    const message: PageBridgeEvidenceMessage = {
      channel: PAGE_EVIDENCE_CHANNEL,
      sessionId,
      leaseId,
      candidate,
    };
    window.postMessage(message, window.location.origin);
  }

  function stopActive(): void {
    active?.actionRecorder.stop();
    active?.consoleRecorder.stop();
    active?.networkRecorder.stop();
    active = undefined;
  }

  const controller: PageBridgeController = {
    configure(sessionId, leaseId, config, paused) {
      stopActive();
      const sanitizer = new DataSanitizer(config.privacy);
      const onRecorderError = (error: unknown): void => {
        const message = sanitizer.sanitizeText(
          error instanceof Error ? error.message : String(error),
          1_000,
        );
        window.postMessage(
          {
            channel: PAGE_EVIDENCE_CHANNEL,
            sessionId,
            leaseId,
            warning: message,
          },
          window.location.origin,
        );
      };

      const actionRecorder = new ActionRecorder({
        config: config.actions,
        sanitizer,
        onRecord: (record) =>
          emit(sessionId, leaseId, { kind: "action", record }),
        onError: onRecorderError,
      });
      const consoleRecorder = new ConsoleRecorder({
        sanitizer,
        levels: config.console.levels,
        onRecord: (record) =>
          emit(sessionId, leaseId, { kind: "console", record }),
        onError: onRecorderError,
      });
      const networkRecorder = new NetworkRecorder({
        config: config.network,
        sanitizer,
        onRecord: (record) =>
          emit(sessionId, leaseId, { kind: "network-error", record }),
        onRequest: (record) =>
          emit(sessionId, leaseId, { kind: "network-request", record }),
        onError: onRecorderError,
      });

      active = {
        sessionId,
        leaseId,
        actionRecorder,
        consoleRecorder,
        networkRecorder,
      };
      try {
        actionRecorder.start();
        if (config.console.enabled) consoleRecorder.start();
        if (config.network.enabled) networkRecorder.start();
        if (paused) {
          actionRecorder.pause();
          consoleRecorder.pause();
          networkRecorder.pause();
        }
      } catch (error) {
        stopActive();
        throw error;
      }
    },
    pause(sessionId, leaseId) {
      if (!matches(sessionId, leaseId)) return false;
      active?.actionRecorder.pause();
      active?.consoleRecorder.pause();
      active?.networkRecorder.pause();
      return true;
    },
    resume(sessionId, leaseId) {
      if (!matches(sessionId, leaseId)) return false;
      active?.actionRecorder.resume();
      active?.consoleRecorder.resume();
      active?.networkRecorder.resume();
      return true;
    },
    stop(sessionId, leaseId) {
      if (!matches(sessionId, leaseId)) return false;
      stopActive();
      return true;
    },
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isControlMessage(event.data)) return;
    const message = event.data;
    if (message.type === "configure") {
      try {
        controller.configure(
          message.sessionId,
          message.leaseId,
          message.config,
          message.paused,
        );
        emitStatus(
          message.sessionId,
          message.leaseId,
          message.controlId,
          "configured",
        );
      } catch (error) {
        emitStatus(
          message.sessionId,
          message.leaseId,
          message.controlId,
          "configuration-error",
          error instanceof Error
            ? error.message
            : "Page instrumentation failed to start.",
        );
      }
    } else {
      try {
        const applied = controller[message.type](
          message.sessionId,
          message.leaseId,
        );
        if (!applied) {
          emitStatus(
            message.sessionId,
            message.leaseId,
            message.controlId,
            "control-error",
            "The page capture lease is stale.",
          );
          return;
        }
        const statusType =
          message.type === "pause"
            ? "paused"
            : message.type === "resume"
              ? "resumed"
              : "stopped";
        emitStatus(
          message.sessionId,
          message.leaseId,
          message.controlId,
          statusType,
        );
      } catch (error) {
        emitStatus(
          message.sessionId,
          message.leaseId,
          message.controlId,
          "control-error",
          error instanceof Error
            ? error.message
            : `Page instrumentation could not ${message.type}.`,
        );
      }
    }
  });

  return controller;
}

const pageGlobal = window as PageGlobal;
if (!pageGlobal[BRIDGE_KEY]) {
  Object.defineProperty(pageGlobal, BRIDGE_KEY, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  installBridge();
}
