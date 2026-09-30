import type { NoteRecord, ScreenshotRecord } from "@testwitness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IndexedDbEvidenceRepository } from "../src/storage/IndexedDbEvidenceRepository";
import { createStoredSession } from "./fixtures";

const DATABASE_NAME = "testwitness-extension-standard";
let repository: IndexedDbEvidenceRepository;

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
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
});

describe("IndexedDbEvidenceRepository", () => {
  it("persists session metadata and binary evidence", async () => {
    const session = createStoredSession();
    const note: NoteRecord = {
      id: "note-1",
      timestamp: "2026-09-26T12:00:02.000Z",
      text: "Validated successful login.",
      url: "https://example.test/dashboard",
      actionSequence: 1,
    };
    const screenshot: ScreenshotRecord = {
      id: "shot-1",
      timestamp: "2026-09-26T12:00:03.000Z",
      label: "Dashboard",
      url: "https://example.test/dashboard",
      actionSequence: 1,
      blob: new Blob(["image-bytes"], { type: "image/png" }),
      fileName: "001-dashboard.png",
    };

    await repository.saveSession(session);
    await repository.addEvidence(session.sessionId, "note", 1, note);
    await repository.addEvidence(
      session.sessionId,
      "screenshot",
      2,
      screenshot,
    );

    const restored = await repository.getSession(session.sessionId);
    const evidence = await repository.getEvidence(session);
    expect(restored?.sessionId).toBe(session.sessionId);
    expect(evidence.notes).toEqual([note]);
    expect(evidence.screenshots[0]?.blob.size).toBe(11);
  });

  it("deletes the session and every related evidence row", async () => {
    const session = createStoredSession();
    await repository.saveSession(session);
    await repository.addEvidence(session.sessionId, "note", 1, {
      id: "note-1",
      timestamp: session.createdAt,
      text: "Temporary note",
      url: session.metadata.currentUrl,
      actionSequence: 0,
    });

    await repository.deleteSession(session.sessionId);
    expect(await repository.getSession(session.sessionId)).toBeUndefined();
    expect(await repository.listEvidence(session.sessionId, "note")).toEqual(
      [],
    );
  });
});
