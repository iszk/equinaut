import type postgres from "postgres";
import { createPostgresClient } from "../db/index.js";
import { redactSensitiveMessage } from "./redaction.js";
import type { IngestionRunResult } from "./run.js";
import { runIngestionSource } from "./source-registry.js";
import type { IngestionSourceId } from "./source-registry.js";

// ASCII の "EQNT" を int32 namespace として固定し、他用途の advisory lock と分離する。
export const INGESTION_ADVISORY_LOCK_NAMESPACE = 0x45514e54;

export const INGESTION_SOURCE_LOCK_KEYS: Readonly<Record<IngestionSourceId, number>> = Object.freeze({
  bitbank: 1,
  bitflyer: 2,
  saxo: 3,
});

export type SkippedOverlapResult = {
  status: "skipped_overlap";
  message: string;
};

export type IngestionExecutionResult = IngestionRunResult | SkippedOverlapResult;

export type SourceExecutionLockSession = {
  tryAcquire(namespace: number, sourceKey: number): Promise<boolean>;
  unlock(namespace: number, sourceKey: number): Promise<boolean>;
  close(): Promise<void>;
};

type SourceExecutionOptions = {
  databaseUrl?: string;
  createLockSession?: (databaseUrl?: string) => Promise<SourceExecutionLockSession>;
  runSource?: (sourceId: IngestionSourceId) => Promise<IngestionRunResult>;
};

type AdvisoryLockRow = {
  acquired: boolean;
};

type AdvisoryUnlockRow = {
  unlocked: boolean;
};

type LockOperation = "open" | "acquire" | "release" | "close";

export class IngestionExecutionLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestionExecutionLockError";
  }
}

const errorDetail = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return redactSensitiveMessage(error.message);
  }

  return "unknown error";
};

const lockError = (
  operation: LockOperation,
  sourceId: IngestionSourceId,
  error: unknown,
): IngestionExecutionLockError =>
  new IngestionExecutionLockError(
    `ingestion execution lock ${operation} failed: source=${sourceId} message=${errorDetail(error)}`,
  );

export class IngestionSourceExecutionError extends AggregateError {
  readonly primaryError: unknown;
  readonly secondaryErrors: readonly IngestionExecutionLockError[];

  constructor(primaryError: unknown, secondaryErrors: readonly IngestionExecutionLockError[]) {
    const frozenSecondaryErrors = Object.freeze([...secondaryErrors]);
    super(
      [primaryError, ...frozenSecondaryErrors],
      `ingestion source execution failed: primary=${errorDetail(primaryError)}; secondary=${frozenSecondaryErrors
        .map((error) => errorDetail(error))
        .join(" | ")}`,
    );
    this.name = "IngestionSourceExecutionError";
    this.primaryError = primaryError;
    this.secondaryErrors = frozenSecondaryErrors;
  }
}

type SourceExecutionOutcome =
  | { kind: "result"; result: IngestionExecutionResult }
  | { kind: "error"; error: unknown };

const firstBoolean = <Key extends "acquired" | "unlocked">(
  rows: readonly Record<Key, boolean>[],
  key: Key,
): boolean => {
  const row = rows[0];
  if (row === undefined || typeof row[key] !== "boolean") {
    throw new Error(`PostgreSQL advisory lock query did not return ${key}`);
  }

  return row[key];
};

const closeReservedConnection = async (
  pool: postgres.Sql,
  connection: postgres.ReservedSql,
): Promise<void> => {
  let releaseError: unknown;
  try {
    connection.release();
  } catch (error) {
    releaseError = error;
  }

  try {
    await pool.end();
  } catch (error) {
    if (releaseError === undefined) {
      releaseError = error;
    }
  }

  if (releaseError !== undefined) {
    throw releaseError;
  }
};

const createPostgresLockSession = async (databaseUrl?: string): Promise<SourceExecutionLockSession> => {
  const pool = databaseUrl === undefined ? createPostgresClient() : createPostgresClient(databaseUrl);
  let connection: postgres.ReservedSql;
  try {
    connection = await pool.reserve();
  } catch (error) {
    try {
      await pool.end();
    } catch {
      // 接続確保の失敗を優先し、この段階の pool cleanup は best effort とする。
    }
    throw error;
  }

  return {
    async tryAcquire(namespace, sourceKey) {
      const rows = await connection<AdvisoryLockRow[]>`
        SELECT pg_try_advisory_lock(${namespace}, ${sourceKey}) AS acquired
      `;
      return firstBoolean(rows, "acquired");
    },
    async unlock(namespace, sourceKey) {
      const rows = await connection<AdvisoryUnlockRow[]>`
        SELECT pg_advisory_unlock(${namespace}, ${sourceKey}) AS unlocked
      `;
      return firstBoolean(rows, "unlocked");
    },
    close: async () => closeReservedConnection(pool, connection),
  };
};

export const executeIngestionSource = async (
  sourceId: IngestionSourceId,
  options: SourceExecutionOptions = {},
): Promise<IngestionExecutionResult> => {
  const createLockSession = options.createLockSession ?? createPostgresLockSession;
  const runSource = options.runSource ?? runIngestionSource;
  let session: SourceExecutionLockSession;

  try {
    session = await createLockSession(options.databaseUrl);
  } catch (error) {
    throw lockError("open", sourceId, error);
  }

  const namespace = INGESTION_ADVISORY_LOCK_NAMESPACE;
  const sourceKey = INGESTION_SOURCE_LOCK_KEYS[sourceId];
  let acquired = false;
  let outcome: SourceExecutionOutcome;

  try {
    try {
      acquired = await session.tryAcquire(namespace, sourceKey);
    } catch (error) {
      throw lockError("acquire", sourceId, error);
    }

    if (!acquired) {
      outcome = {
        kind: "result",
        result: {
          status: "skipped_overlap",
          message: `${sourceId} ingestion skipped_overlap: another execution is already running`,
        },
      };
    } else {
      try {
        outcome = { kind: "result", result: await runSource(sourceId) };
      } catch (error) {
        outcome = { kind: "error", error };
      }
    }
  } catch (error) {
    outcome = { kind: "error", error };
  }

  const cleanupErrors: IngestionExecutionLockError[] = [];
  if (acquired) {
    try {
      const unlocked = await session.unlock(namespace, sourceKey);
      if (!unlocked) {
        throw new Error("reserved session did not hold the advisory lock");
      }
    } catch (error) {
      cleanupErrors.push(lockError("release", sourceId, error));
    }
  }

  try {
    await session.close();
  } catch (error) {
    cleanupErrors.push(lockError("close", sourceId, error));
  }

  // 一次 error を先頭に保ち、cleanup error は原因を失わない secondary error として付加する。
  if (outcome.kind === "error") {
    if (cleanupErrors.length === 0) {
      throw outcome.error;
    }
    throw new IngestionSourceExecutionError(outcome.error, cleanupErrors);
  }

  const [cleanupPrimaryError, ...secondaryCleanupErrors] = cleanupErrors;
  if (cleanupPrimaryError !== undefined) {
    if (secondaryCleanupErrors.length === 0) {
      throw cleanupPrimaryError;
    }
    throw new IngestionSourceExecutionError(cleanupPrimaryError, secondaryCleanupErrors);
  }

  return outcome.result;
};
