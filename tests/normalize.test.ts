import { DataSanitizer } from "@testwitness/core";
import { describe, expect, it } from "vitest";

import { normalizeEvidenceCandidate } from "../src/evidence/normalize";
import { createStoredSession } from "./fixtures";

describe("extension evidence boundary", () => {
  it("assigns canonical action sequences and drops sensitive input values", () => {
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
    expect(result.record.value).toBeUndefined();
    expect(result.record.url).not.toContain("secret");
  });

  it("drops forged text values when text-value capture is disabled", () => {
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
          elementIdentifier: '[name="displayName"]',
          value: "A private free-text value",
          url: "https://example.test/profile",
        },
      },
      sanitizer,
      session.config,
      5,
    );

    expect(result?.kind).toBe("action");
    if (result?.kind !== "action")
      throw new Error("Expected an action record.");
    expect(result.record.value).toBeUndefined();
  });

  it.each(["checked", "unchecked"])(
    "retains the non-text input state %s when text values are disabled",
    (value) => {
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
            elementIdentifier: '[name="acceptTerms"]',
            value,
            url: "https://example.test/profile",
          },
        },
        sanitizer,
        session.config,
        6,
      );

      expect(result?.kind).toBe("action");
      if (result?.kind !== "action")
        throw new Error("Expected an action record.");
      expect(result.record.value).toBe(value);
    },
  );

  it("retains sanitized ordinary text only after explicit opt-in", () => {
    const session = createStoredSession();
    session.config.actions.captureTextInputValues = true;
    const sanitizer = new DataSanitizer(session.config.privacy);
    const result = normalizeEvidenceCandidate(
      {
        kind: "action",
        record: {
          sequence: 99,
          timestamp: "2026-09-26T12:00:01.000Z",
          type: "input-change",
          elementTag: "textarea",
          elementIdentifier: '[name="summary"]',
          value: "Ordinary text; access_token=secret",
          url: "https://example.test/profile",
        },
      },
      sanitizer,
      session.config,
      7,
    );

    expect(result?.kind).toBe("action");
    if (result?.kind !== "action")
      throw new Error("Expected an action record.");
    expect(result.record.value).toContain("Ordinary text");
    expect(result.record.value).toContain("[REDACTED]");
    expect(result.record.value).not.toContain("secret");
  });

  it.each([
    ['input[type="password"]', "plain-password"],
    ['input[type="hidden"]', "hidden-value"],
    ['input[type="file"]', "/private/customer.csv"],
    ['[name="access_token"]', "opaque-token"],
    ['[name="employee-secret"]', "private-value"],
  ])(
    "drops values for sensitive target %s even after opt-in",
    (identifier, value) => {
      const session = createStoredSession();
      session.config.actions.captureTextInputValues = true;
      session.config.privacy.sensitiveFieldNames.push("employee-secret");
      const sanitizer = new DataSanitizer(session.config.privacy);
      const result = normalizeEvidenceCandidate(
        {
          kind: "action",
          record: {
            sequence: 99,
            timestamp: "2026-09-26T12:00:01.000Z",
            type: "input-change",
            elementTag: "input",
            elementIdentifier: identifier,
            value,
            url: "https://example.test/profile",
          },
        },
        sanitizer,
        session.config,
        8,
      );

      expect(result?.kind).toBe("action");
      if (result?.kind !== "action")
        throw new Error("Expected an action record.");
      expect(result.record.value).toBeUndefined();
    },
  );

  it("drops values attached to non-input actions and non-string forged values", () => {
    const session = createStoredSession();
    session.config.actions.captureTextInputValues = true;
    const sanitizer = new DataSanitizer(session.config.privacy);
    const click = normalizeEvidenceCandidate(
      {
        kind: "action",
        record: {
          sequence: 99,
          timestamp: "2026-09-26T12:00:01.000Z",
          type: "click",
          elementTag: "button",
          value: "forged-value",
          url: "https://example.test/profile",
        },
      },
      sanitizer,
      session.config,
      9,
    );
    const objectValue = normalizeEvidenceCandidate(
      {
        kind: "action",
        record: {
          sequence: 100,
          timestamp: "2026-09-26T12:00:02.000Z",
          type: "input-change",
          elementTag: "input",
          value: { password: "secret" } as unknown as string,
          url: "https://example.test/profile",
        },
      },
      sanitizer,
      session.config,
      10,
    );

    expect(click?.kind).toBe("action");
    expect(objectValue?.kind).toBe("action");
    if (click?.kind !== "action" || objectValue?.kind !== "action")
      throw new Error("Expected action records.");
    expect(click.record.value).toBeUndefined();
    expect(objectValue.record.value).toBeUndefined();
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
