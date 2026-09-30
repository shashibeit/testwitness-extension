import type {
  ActionRecord,
  ConsoleLogRecord,
  NetworkErrorRecord,
  NetworkRequestRecord,
  NoteRecord,
  ScreenshotRecord,
  SessionEvidence,
  VideoRecord,
} from "@testwitness/core";

import { ExtensionError } from "../shared/errors";
import type { StoredSession } from "../shared/types";

const DATABASE_NAME = "testwitness-extension-standard";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";
const EVIDENCE_STORE = "evidence";

export type StoredEvidenceKind =
  | "action"
  | "console"
  | "network-request"
  | "network-error"
  | "note"
  | "screenshot"
  | "video";

type StoredEvidenceValue =
  | ActionRecord
  | ConsoleLogRecord
  | NetworkRequestRecord
  | NetworkErrorRecord
  | NoteRecord
  | ScreenshotRecord
  | VideoRecord;

interface EvidenceRow {
  key: string;
  sessionId: string;
  kind: StoredEvidenceKind;
  ordinal: number;
  value: StoredEvidenceValue;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("IndexedDB transaction was aborted."),
        ),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true },
    );
  });
}

function evidenceIdentity(value: StoredEvidenceValue): string {
  if ("id" in value && typeof value.id === "string") return value.id;
  if ("sequence" in value && typeof value.sequence === "number")
    return `action-${value.sequence}`;
  return `evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Durable, extension-origin evidence storage shared by the worker, panel, and offscreen page. */
export class IndexedDbEvidenceRepository {
  readonly #indexedDb: IDBFactory;
  #databasePromise?: Promise<IDBDatabase>;

  public constructor(indexedDb: IDBFactory = globalThis.indexedDB) {
    if (!indexedDb) {
      throw new ExtensionError(
        "STORAGE_FAILED",
        "IndexedDB is unavailable in this browser.",
        false,
      );
    }
    this.#indexedDb = indexedDb;
  }

  public async saveSession(session: StoredSession): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    transaction.objectStore(SESSION_STORE).put(session);
    await transactionComplete(transaction);
  }

  public async getSession(
    sessionId: string,
  ): Promise<StoredSession | undefined> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const result = await requestResult(
      transaction.objectStore(SESSION_STORE).get(sessionId) as IDBRequest<
        StoredSession | undefined
      >,
    );
    await transactionComplete(transaction);
    return result;
  }

  public async getLatestSession(): Promise<StoredSession | undefined> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const sessions = await requestResult(
      transaction.objectStore(SESSION_STORE).getAll() as IDBRequest<
        StoredSession[]
      >,
    );
    await transactionComplete(transaction);
    return sessions.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  }

  public async getActiveSessionForTab(
    tabId: number,
  ): Promise<StoredSession | undefined> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const sessions = await requestResult(
      transaction.objectStore(SESSION_STORE).getAll() as IDBRequest<
        StoredSession[]
      >,
    );
    await transactionComplete(transaction);
    return sessions
      .filter(
        (session) =>
          session.targetTabId === tabId &&
          session.phase !== "stopped" &&
          session.phase !== "failed",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  public async addEvidence(
    sessionId: string,
    kind: StoredEvidenceKind,
    ordinal: number,
    value: StoredEvidenceValue,
  ): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(EVIDENCE_STORE, "readwrite");
    const identity = kind === "video" ? "recording" : evidenceIdentity(value);
    const row: EvidenceRow = {
      key: `${sessionId}:${kind}:${identity}`,
      sessionId,
      kind,
      ordinal,
      value,
    };
    transaction.objectStore(EVIDENCE_STORE).put(row);
    await transactionComplete(transaction);
  }

  public async listEvidence<T extends StoredEvidenceValue>(
    sessionId: string,
    kind: StoredEvidenceKind,
  ): Promise<T[]> {
    const database = await this.open();
    const transaction = database.transaction(EVIDENCE_STORE, "readonly");
    const index = transaction.objectStore(EVIDENCE_STORE).index("session-kind");
    const rows = await requestResult(
      index.getAll(IDBKeyRange.only([sessionId, kind])) as IDBRequest<
        EvidenceRow[]
      >,
    );
    await transactionComplete(transaction);
    return rows
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row) => row.value as T);
  }

  public async getEvidence(session: StoredSession): Promise<SessionEvidence> {
    const [
      screenshots,
      actions,
      consoleLogs,
      networkRequests,
      networkErrors,
      notes,
      videos,
    ] = await Promise.all([
      this.listEvidence<ScreenshotRecord>(session.sessionId, "screenshot"),
      this.listEvidence<ActionRecord>(session.sessionId, "action"),
      this.listEvidence<ConsoleLogRecord>(session.sessionId, "console"),
      this.listEvidence<NetworkRequestRecord>(
        session.sessionId,
        "network-request",
      ),
      this.listEvidence<NetworkErrorRecord>(session.sessionId, "network-error"),
      this.listEvidence<NoteRecord>(session.sessionId, "note"),
      this.listEvidence<VideoRecord>(session.sessionId, "video"),
    ]);

    return {
      metadata: { ...session.metadata },
      screenshots,
      actions,
      consoleLogs,
      networkRequests,
      networkErrors,
      notes,
      video: videos[0],
    };
  }

  public async deleteSession(sessionId: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(
      [SESSION_STORE, EVIDENCE_STORE],
      "readwrite",
    );
    transaction.objectStore(SESSION_STORE).delete(sessionId);
    const evidenceStore = transaction.objectStore(EVIDENCE_STORE);
    const index = evidenceStore.index("session-id");
    const keys = await requestResult(
      index.getAllKeys(IDBKeyRange.only(sessionId)),
    );
    for (const key of keys) evidenceStore.delete(key);
    await transactionComplete(transaction);
  }

  public async pruneCompletedSessions(maximumSessions: number): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const sessions = await requestResult(
      transaction.objectStore(SESSION_STORE).getAll() as IDBRequest<
        StoredSession[]
      >,
    );
    await transactionComplete(transaction);

    const completed = sessions
      .filter(
        (session) => session.phase === "stopped" || session.phase === "failed",
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const session of completed.slice(Math.max(0, maximumSessions))) {
      await this.deleteSession(session.sessionId);
    }
  }

  public close(): void {
    if (!this.#databasePromise) return;
    void this.#databasePromise.then((database) => database.close());
    this.#databasePromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    this.#databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const sessionStore = database.createObjectStore(SESSION_STORE, {
            keyPath: "sessionId",
          });
          sessionStore.createIndex("updated-at", "updatedAt");
        }
        if (!database.objectStoreNames.contains(EVIDENCE_STORE)) {
          const evidenceStore = database.createObjectStore(EVIDENCE_STORE, {
            keyPath: "key",
          });
          evidenceStore.createIndex("session-id", "sessionId");
          evidenceStore.createIndex("session-kind", ["sessionId", "kind"]);
        }
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () =>
          reject(
            request.error ??
              new Error("Could not open the TestWitness evidence database."),
          ),
        { once: true },
      );
      request.addEventListener("blocked", () => {
        reject(
          new Error(
            "A previous TestWitness database connection is blocking an upgrade.",
          ),
        );
      });
    });
    return this.#databasePromise;
  }
}
