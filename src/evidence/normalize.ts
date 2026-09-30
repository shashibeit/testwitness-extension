import type {
  ActionRecord,
  ActionType,
  ConsoleLogRecord,
  DataSanitizer,
  NetworkBodyCaptureInfo,
  NetworkBodyCaptureState,
  NetworkErrorRecord,
  NetworkExchangeDetail,
  NetworkFailureType,
  NetworkRequestOutcome,
  NetworkRequestRecord,
  NetworkTransport,
  ResolvedTestWitnessConfig,
  SanitizedValue,
} from "@testwitness/core";

import { createId } from "../shared/ids";
import type { EvidenceCandidate } from "../shared/protocol";

const ACTION_TYPES = new Set<ActionType>([
  "click",
  "form-submit",
  "input-change",
  "navigation",
  "history-push",
  "history-replace",
  "popstate",
  "hashchange",
]);
const BODY_STATES = new Set<NetworkBodyCaptureState>([
  "disabled",
  "captured",
  "empty",
  "unavailable",
  "omitted-binary",
  "truncated",
]);
const OUTCOMES = new Set<NetworkRequestOutcome>([
  "success",
  "http-error",
  "network-error",
  "timeout",
  "abort",
]);
const FAILURES = new Set<NetworkFailureType>([
  "http-error",
  "network-error",
  "timeout",
  "abort",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: unknown,
  sanitizer: DataSanitizer,
  maximumLength = 1_000,
): string | undefined {
  return value === undefined || value === null
    ? undefined
    : sanitizer.sanitizeText(value, maximumLength);
}

function finiteNumber(value: unknown, minimum = 0): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, value)
    : undefined;
}

function safeTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function stringHeaders(value: unknown): HeadersInit | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value).slice(0, 100)) {
    if (typeof headerValue === "string") result[name] = headerValue;
  }
  return result;
}

function bodyCapture(value: unknown): NetworkBodyCaptureInfo | undefined {
  if (
    !isRecord(value) ||
    !BODY_STATES.has(value.state as NetworkBodyCaptureState)
  )
    return undefined;
  const capturedBytes = finiteNumber(value.capturedBytes);
  const originalBytes = finiteNumber(value.originalBytes);
  return {
    state: value.state as NetworkBodyCaptureState,
    ...(capturedBytes === undefined ? {} : { capturedBytes }),
    ...(originalBytes === undefined ? {} : { originalBytes }),
  };
}

function networkDetails(
  record: Record<string, unknown>,
  sanitizer: DataSanitizer,
  config: ResolvedTestWitnessConfig,
): NetworkExchangeDetail {
  const requestHeaders = config.network.captureRequestHeaders
    ? sanitizer.sanitizeHeaders(stringHeaders(record.requestHeaders))
    : undefined;
  const responseHeaders = config.network.captureResponseHeaders
    ? sanitizer.sanitizeHeaders(stringHeaders(record.responseHeaders))
    : undefined;
  const requestBody = config.network.captureRequestBody
    ? sanitizer.sanitizeBody(record.requestBody)
    : undefined;
  const responseBody = config.network.captureResponseBody
    ? sanitizer.sanitizeBody(record.responseBody)
    : undefined;

  return {
    startedAt: optionalString(record.startedAt, sanitizer, 64),
    completedAt: optionalString(record.completedAt, sanitizer, 64),
    documentUrl:
      typeof record.documentUrl === "string"
        ? sanitizer.sanitizeUrl(record.documentUrl)
        : undefined,
    responseUrl:
      typeof record.responseUrl === "string"
        ? sanitizer.sanitizeUrl(record.responseUrl)
        : undefined,
    statusText: optionalString(record.statusText, sanitizer, 200),
    redirected:
      typeof record.redirected === "boolean" ? record.redirected : undefined,
    responseType: optionalString(record.responseType, sanitizer, 100),
    requestMode: optionalString(record.requestMode, sanitizer, 100),
    credentialsMode: optionalString(record.credentialsMode, sanitizer, 100),
    cacheMode: optionalString(record.cacheMode, sanitizer, 100),
    redirectMode: optionalString(record.redirectMode, sanitizer, 100),
    timeoutMs: finiteNumber(record.timeoutMs),
    withCredentials:
      typeof record.withCredentials === "boolean"
        ? record.withCredentials
        : undefined,
    requestContentType: optionalString(
      record.requestContentType,
      sanitizer,
      300,
    ),
    responseContentType: optionalString(
      record.responseContentType,
      sanitizer,
      300,
    ),
    requestHeaders,
    responseHeaders,
    requestBodyCapture: bodyCapture(record.requestBodyCapture),
    responseBodyCapture: bodyCapture(record.responseBodyCapture),
    ...(requestBody === undefined ? {} : { requestBody }),
    ...(responseBody === undefined ? {} : { responseBody }),
  };
}

function normalizeAction(
  value: unknown,
  sanitizer: DataSanitizer,
  sequence: number,
): ActionRecord | undefined {
  if (!isRecord(value) || !ACTION_TYPES.has(value.type as ActionType))
    return undefined;
  return {
    sequence,
    timestamp: safeTimestamp(value.timestamp),
    type: value.type as ActionType,
    elementTag: optionalString(value.elementTag, sanitizer, 60),
    elementIdentifier: optionalString(value.elementIdentifier, sanitizer, 500),
    elementText: optionalString(value.elementText, sanitizer, 200),
    value: optionalString(value.value, sanitizer, 200),
    url: sanitizer.sanitizeUrl(typeof value.url === "string" ? value.url : ""),
  };
}

function normalizeConsole(
  value: unknown,
  sanitizer: DataSanitizer,
): ConsoleLogRecord | undefined {
  if (!isRecord(value) || (value.level !== "warn" && value.level !== "error"))
    return undefined;
  const argumentValues = Array.isArray(value.arguments)
    ? value.arguments.slice(0, 100)
    : [];
  return {
    id: createId("console"),
    timestamp: safeTimestamp(value.timestamp),
    level: value.level,
    message: sanitizer.sanitizeText(value.message ?? "", 4_000),
    arguments: argumentValues.map((entry): SanitizedValue =>
      sanitizer.sanitizeValue(entry),
    ),
    url: sanitizer.sanitizeUrl(typeof value.url === "string" ? value.url : ""),
  };
}

function transport(value: unknown): NetworkTransport {
  return value === "xhr" ? "xhr" : "fetch";
}

function normalizeNetworkRequest(
  value: unknown,
  sanitizer: DataSanitizer,
  config: ResolvedTestWitnessConfig,
): NetworkRequestRecord | undefined {
  if (!isRecord(value) || !OUTCOMES.has(value.outcome as NetworkRequestOutcome))
    return undefined;
  const status = finiteNumber(value.status);
  return {
    ...networkDetails(value, sanitizer, config),
    id: createId("request"),
    timestamp: safeTimestamp(value.timestamp),
    transport: transport(value.transport),
    method: sanitizer.sanitizeText(value.method ?? "GET", 32).toUpperCase(),
    url: sanitizer.sanitizeUrl(typeof value.url === "string" ? value.url : ""),
    ...(status === undefined ? {} : { status: Math.round(status) }),
    durationMs: finiteNumber(value.durationMs) ?? 0,
    outcome: value.outcome as NetworkRequestOutcome,
  };
}

function normalizeNetworkError(
  value: unknown,
  sanitizer: DataSanitizer,
  config: ResolvedTestWitnessConfig,
): NetworkErrorRecord | undefined {
  if (
    !isRecord(value) ||
    !FAILURES.has(value.failureType as NetworkFailureType)
  )
    return undefined;
  const status = finiteNumber(value.status);
  return {
    ...networkDetails(value, sanitizer, config),
    id: createId("network-error"),
    timestamp: safeTimestamp(value.timestamp),
    transport: transport(value.transport),
    method: sanitizer.sanitizeText(value.method ?? "GET", 32).toUpperCase(),
    url: sanitizer.sanitizeUrl(typeof value.url === "string" ? value.url : ""),
    ...(status === undefined ? {} : { status: Math.round(status) }),
    durationMs: finiteNumber(value.durationMs) ?? 0,
    failureType: value.failureType as NetworkFailureType,
  };
}

export type NormalizedEvidence =
  | { kind: "action"; record: ActionRecord }
  | { kind: "console"; record: ConsoleLogRecord }
  | { kind: "network-request"; record: NetworkRequestRecord }
  | { kind: "network-error"; record: NetworkErrorRecord };

export function normalizeEvidenceCandidate(
  candidate: EvidenceCandidate,
  sanitizer: DataSanitizer,
  config: ResolvedTestWitnessConfig,
  actionSequence: number,
): NormalizedEvidence | undefined {
  switch (candidate.kind) {
    case "action": {
      const record = normalizeAction(
        candidate.record,
        sanitizer,
        actionSequence,
      );
      return record ? { kind: "action", record } : undefined;
    }
    case "console": {
      const record = normalizeConsole(candidate.record, sanitizer);
      return record ? { kind: "console", record } : undefined;
    }
    case "network-request": {
      const record = normalizeNetworkRequest(
        candidate.record,
        sanitizer,
        config,
      );
      return record ? { kind: "network-request", record } : undefined;
    }
    case "network-error": {
      const record = normalizeNetworkError(candidate.record, sanitizer, config);
      return record ? { kind: "network-error", record } : undefined;
    }
  }
}
