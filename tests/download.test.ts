import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadEvidence } from "../src/evidence/download";
import { IndexedDbEvidenceRepository } from "../src/storage/IndexedDbEvidenceRepository";
import { createStoredSession } from "./fixtures";

const DATABASE_NAME = "testwitness-extension-standard";
let repository: IndexedDbEvidenceRepository;

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => resolve(), { once: true });
    request.addEventListener("blocked", () => resolve(), { once: true });
  });
}

beforeEach(async () => {
  await deleteDatabase();
  repository = new IndexedDbEvidenceRepository();
});

afterEach(async () => {
  repository.close();
  await deleteDatabase();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extension evidence download", () => {
  it("generates the core ZIP report and starts a browser download", async () => {
    const session = createStoredSession({
      phase: "stopped",
      result: "passed",
      endedAt: "2026-09-26T12:05:00.000Z",
      metadata: {
        ...createStoredSession().metadata,
        endedAt: "2026-09-26T12:05:00.000Z",
        durationMs: 300_000,
        result: "passed",
      },
    });
    await repository.saveSession(session);
    await repository.addEvidence(session.sessionId, "note", 1, {
      id: "note-1",
      timestamp: session.createdAt,
      text: "Export integration test",
      url: session.metadata.currentUrl,
      actionSequence: 0,
    });

    const download = vi.fn(async () => 42);
    vi.stubGlobal("chrome", { downloads: { download } });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:testwitness-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const result = await downloadEvidence(repository, session.sessionId);
    expect(result.downloadId).toBe(42);
    expect(result.fileName).toMatch(/^TestWitness-TC-101-.*\.zip$/u);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "blob:testwitness-export",
        filename: result.fileName,
        saveAs: true,
      }),
    );
  });
});
