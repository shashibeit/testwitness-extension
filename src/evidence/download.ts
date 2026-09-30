import { EvidenceExporter, InMemoryEvidenceStore } from "@testwitness/core";

import { ExtensionError } from "../shared/errors";
import { toCoreSummary } from "../shared/types";
import type { IndexedDbEvidenceRepository } from "../storage/IndexedDbEvidenceRepository";

export interface ExtensionDownloadResult {
  downloadId: number;
  fileName: string;
  sizeBytes: number;
}

/** Generates the existing TestWitness ZIP/report from durable extension evidence. */
export async function downloadEvidence(
  repository: IndexedDbEvidenceRepository,
  sessionId: string,
): Promise<ExtensionDownloadResult> {
  const session = await repository.getSession(sessionId);
  if (!session)
    throw new ExtensionError(
      "EXPORT_FAILED",
      "The evidence session was not found.",
    );
  if (session.phase !== "stopped") {
    throw new ExtensionError(
      "EXPORT_FAILED",
      "Stop the session before downloading its evidence.",
    );
  }

  const evidence = await repository.getEvidence(session);
  const store = new InMemoryEvidenceStore({
    warningThresholdBytes: Number.MAX_SAFE_INTEGER,
  });
  store.reset(evidence.metadata);
  for (const record of evidence.actions) store.addAction(record);
  for (const record of evidence.consoleLogs) store.addConsoleLog(record);
  for (const record of evidence.networkRequests)
    store.addNetworkRequest(record);
  for (const record of evidence.networkErrors) store.addNetworkError(record);
  for (const record of evidence.notes) store.addNote(record);
  for (const record of evidence.screenshots) store.addScreenshot(record);
  if (evidence.video) store.setVideo(evidence.video);

  const exporter = new EvidenceExporter(session.config.export);
  const result = await exporter.generate(
    store.getSnapshot(),
    toCoreSummary(session),
  );
  const objectUrl = URL.createObjectURL(result.blob);
  try {
    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename: result.fileName,
      saveAs: true,
      conflictAction: "uniquify",
    });
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return {
      downloadId,
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw new ExtensionError(
      "EXPORT_FAILED",
      `Evidence download could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
