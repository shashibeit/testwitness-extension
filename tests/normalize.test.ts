import { DataSanitizer } from "@testwitness/core";
import { describe, expect, it } from "vitest";

import { normalizeEvidenceCandidate } from "../src/evidence/normalize";
import { createStoredSession } from "./fixtures";

describe("extension evidence boundary", () => {
  it("assigns canonical action sequences and strips sensitive values", () => {
    const session = createStoredSession();
    const sanitizer = new DataSanitizer(session.config.privacy);
    const result = normalizeEvidenceCandidate(
      {
        kind: "action",
        record: {
          sequence: 99,
          timestamp: "2026-09-26T12:00:01.000Z",
          type: "input-change",
          elementTag: "input",
          elementIdentifier: '[name="password"]',
          value: "password=super-secret",
          url: "https://example.test/profile?access_token=secret",
        },
      },
      sanitizer,
      session.config,
      4,
    );

    expect(result?.kind).toBe("action");
    if (result?.kind !== "action")
      throw new Error("Expected an action record.");
    expect(result.record.sequence).toBe(4);
    expect(result.record.value).toContain("[REDACTED]");
    expect(result.record.url).not.toContain("secret");
  });

  it("redacts sensitive headers and keeps bodies disabled by default", () => {
    const session = createStoredSession();
    const sanitizer = new DataSanitizer(session.config.privacy);
    const result = normalizeEvidenceCandidate(
      {
        kind: "network-request",
        record: {
          id: "page-id",
          timestamp: "2026-09-26T12:00:02.000Z",
          transport: "fetch",
          method: "POST",
          url: "https://api.example.test/users?sessionId=abc",
          status: 201,
          durationMs: 42,
          outcome: "success",
          requestHeaders: {
            authorization: "Bearer secret",
            "content-type": "application/json",
          },
          responseHeaders: { "set-cookie": "session=secret" },
          requestBody: { password: "secret", displayName: "Test User" },
          responseBody: { accessToken: "secret" },
        },
      },
      sanitizer,
      session.config,
      1,
    );

    expect(result?.kind).toBe("network-request");
    if (result?.kind !== "network-request")
      throw new Error("Expected a network request.");
    expect(result.record.requestHeaders?.authorization).toBe("[REDACTED]");
    expect(result.record.responseHeaders?.["set-cookie"]).toBe("[REDACTED]");
    expect(result.record.requestBody).toBeUndefined();
    expect(result.record.responseBody).toBeUndefined();
    expect(result.record.url).not.toContain("abc");
  });
});
