import { describe, expect, it } from "vitest";

import {
  parseContentRuntimeMessage,
  parseLauncherMessage,
  parsePanelMessage,
  PROTOCOL_VERSION,
} from "../src/shared/protocol";

describe("runtime protocol validation", () => {
  it("accepts only valid launcher tab activation messages", () => {
    expect(
      parseLauncherMessage({
        version: PROTOCOL_VERSION,
        type: "launcher:activate-tab",
        tabId: 42,
      }),
    ).toBeDefined();
    expect(
      parseLauncherMessage({
        version: PROTOCOL_VERSION,
        type: "launcher:activate-tab",
        tabId: -1,
      }),
    ).toBeUndefined();
  });

  it("accepts supported panel commands", () => {
    expect(
      parsePanelMessage({
        version: PROTOCOL_VERSION,
        type: "panel:capture-screenshot",
        sessionId: "session-1",
        label: "Checkout complete",
      }),
    ).toBeDefined();
  });

  it("rejects unknown commands and oversized values", () => {
    expect(
      parsePanelMessage({ version: 1, type: "panel:delete-everything" }),
    ).toBeUndefined();
    expect(
      parsePanelMessage({
        version: 1,
        type: "panel:add-note",
        sessionId: "session-1",
        text: "x".repeat(4_001),
      }),
    ).toBeUndefined();
  });

  it("accepts bounded content evidence and rejects foreign shapes", () => {
    expect(
      parseContentRuntimeMessage({
        version: 1,
        type: "content:evidence",
        sessionId: "session-1",
        leaseId: "lease-1",
        candidate: {
          kind: "action",
          record: {
            sequence: 1,
            timestamp: new Date().toISOString(),
            type: "click",
            url: "https://example.test",
          },
        },
      }),
    ).toBeDefined();
    expect(
      parseContentRuntimeMessage({
        version: 1,
        type: "content:evidence",
        sessionId: "session-1",
        leaseId: "lease-1",
        candidate: { kind: "privileged-command", record: {} },
      }),
    ).toBeUndefined();
  });
});
