import {
  resolveTestWitnessConfig,
  type ResolvedTestWitnessConfig,
} from "@testwitness/core";

import type { StartSessionInput } from "./types";

export function resolveExtensionConfig(
  input: StartSessionInput,
): ResolvedTestWitnessConfig {
  return resolveTestWitnessConfig({
    applicationName: input.applicationName,
    environment: input.environment,
    releaseVersion: input.releaseVersion,
    tester: {
      name: input.metadata.testerName,
      employeeId: input.metadata.testerEmployeeId,
    },
    session: {
      testCaseId: input.metadata.testCaseId,
      testCaseName: input.metadata.testCaseName,
      requirementId: input.metadata.requirementId,
    },
    screenshot: {
      enabled: true,
      captureOnStart: input.preferences.automaticScreenshots,
      captureOnNavigation: input.preferences.automaticScreenshots,
      autoCaptureIntervalSeconds: 0,
    },
    video: {
      enabled: true,
      includeAudio: input.preferences.includeAudio,
      maxDurationMinutes: input.preferences.maxVideoDurationMinutes,
    },
    actions: {
      enabled: true,
      captureClicks: true,
      captureFormSubmissions: true,
      captureInputChanges: true,
      captureNavigation: true,
      captureTextInputValues: false,
    },
    console: { enabled: true, levels: ["warn", "error"] },
    network: {
      enabled: true,
      captureSuccessfulRequests: true,
      captureFailedFetch: true,
      captureFailedXhr: true,
      captureRequestHeaders: true,
      captureResponseHeaders: true,
      captureRequestBody: input.preferences.captureRequestBody,
      captureResponseBody: input.preferences.captureResponseBody,
    },
    privacy: {
      maskSelectors: input.preferences.maskSelectors,
      excludeSelectors: input.preferences.excludeSelectors,
      sensitiveQueryParameters: input.preferences.sensitiveQueryParameters,
    },
    toolbar: { enabled: false },
    export: {
      fileNamePattern: "TestWitness-{testCaseId}-{timestamp}.zip",
      includeHtmlReport: true,
      includeJsonReport: true,
    },
  });
}
