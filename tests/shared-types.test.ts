import { describe, expect, it } from "vitest";

import { createStoredSession } from "./fixtures";
import { toCoreSummary } from "../src/shared/types";

describe("toCoreSummary", () => {
  it("preserves extension-specific capture-health warnings for reports", () => {
    const session = createStoredSession({
      warnings: [
        {
          code: "CAPTURE_GAP",
          message: "Capture paused while the page bridge reconnected.",
          timestamp: "2026-09-26T12:01:00.000Z",
          severity: "warning",
        },
        {
          code: "TARGET_TAB_CLOSED",
          message: "The recorded tab was closed.",
          timestamp: "2026-09-26T12:02:00.000Z",
          severity: "error",
        },
      ],
    });

    expect(toCoreSummary(session).warnings).toEqual([
      {
        code: "CAPTURE_GAP",
        message: "Capture paused while the page bridge reconnected.",
        timestamp: "2026-09-26T12:01:00.000Z",
        severity: "warning",
        source: "extension",
      },
      {
        code: "TARGET_TAB_CLOSED",
        message: "The recorded tab was closed.",
        timestamp: "2026-09-26T12:02:00.000Z",
        severity: "error",
        source: "extension",
      },
    ]);
  });

  it("continues to map core warning codes without losing details", () => {
    const session = createStoredSession({
      warnings: [
        {
          code: "VIDEO_UNAVAILABLE",
          message: "Video capture is unavailable.",
          timestamp: "2026-09-26T12:01:00.000Z",
          severity: "info",
        },
      ],
    });

    expect(toCoreSummary(session).warnings).toEqual([
      expect.objectContaining({
        code: "VIDEO_UNAVAILABLE",
        severity: "info",
        source: "extension",
      }),
    ]);
  });
});
