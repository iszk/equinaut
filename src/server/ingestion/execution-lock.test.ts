import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestionRunResult } from "./run.js";
import type { IngestionSourceId } from "./source-registry.js";
import type { SourceExecutionLockSession } from "./execution-lock.js";
import {
  executeIngestionSource,
  INGESTION_ADVISORY_LOCK_NAMESPACE,
  INGESTION_SOURCE_LOCK_KEYS,
} from "./execution-lock.js";

const tryAcquire = vi.fn<SourceExecutionLockSession["tryAcquire"]>();
const unlock = vi.fn<SourceExecutionLockSession["unlock"]>();
const close = vi.fn<SourceExecutionLockSession["close"]>();
const runSource = vi.fn<(sourceId: IngestionSourceId) => Promise<IngestionRunResult>>();

const createLockSession = vi.fn<() => Promise<SourceExecutionLockSession>>(async () => ({
  tryAcquire,
  unlock,
  close,
}));

describe("executeIngestionSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tryAcquire.mockResolvedValue(true);
    unlock.mockResolvedValue(true);
    close.mockResolvedValue(undefined);
    runSource.mockResolvedValue({ status: "success", message: "ok" });
  });

  it.each<IngestionSourceId>(["bitbank", "bitflyer", "saxo"])(
    "uses the fixed namespace and key for %s",
    async (sourceId) => {
      await executeIngestionSource(sourceId, { createLockSession, runSource });

      expect(tryAcquire).toHaveBeenCalledWith(
        INGESTION_ADVISORY_LOCK_NAMESPACE,
        INGESTION_SOURCE_LOCK_KEYS[sourceId],
      );
      expect(unlock).toHaveBeenCalledWith(
        INGESTION_ADVISORY_LOCK_NAMESPACE,
        INGESTION_SOURCE_LOCK_KEYS[sourceId],
      );
    },
  );

  it("assigns a distinct fixed key to every source", () => {
    expect(new Set(Object.values(INGESTION_SOURCE_LOCK_KEYS)).size).toBe(3);
  });

  it("returns skipped_overlap without running the source when the lock is contended", async () => {
    tryAcquire.mockResolvedValue(false);

    await expect(executeIngestionSource("bitbank", { createLockSession, runSource })).resolves.toEqual({
      status: "skipped_overlap",
      message: "bitbank ingestion skipped_overlap: another execution is already running",
    });
    expect(runSource).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each<IngestionRunResult>([
    { status: "success", message: "success" },
    { status: "partial", message: "partial" },
    { status: "failed", message: "failed" },
  ])("preserves the $status result and releases the lock", async (result) => {
    runSource.mockResolvedValue(result);

    await expect(executeIngestionSource("saxo", { createLockSession, runSource })).resolves.toEqual(result);
    expect(unlock).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("releases the lock and closes the session when the runner throws", async () => {
    runSource.mockRejectedValue(new Error("runner failed"));

    await expect(executeIngestionSource("bitflyer", { createLockSession, runSource })).rejects.toThrow("runner failed");
    expect(unlock).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("redacts lock acquisition errors and still closes the session", async () => {
    tryAcquire.mockRejectedValue(
      new Error("connect postgres://user:password@db/equinaut Authorization: Bearer SECRET token=SECRET"),
    );

    await expect(executeIngestionSource("bitbank", { createLockSession, runSource })).rejects.toThrow(
      "ingestion execution lock acquire failed: source=bitbank message=connect postgres://[REDACTED]@db/equinaut Authorization: [REDACTED] token=[REDACTED]",
    );
    expect(runSource).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("redacts lock session open errors", async () => {
    createLockSession.mockRejectedValueOnce(
      new Error("connect postgres://user:password@db/equinaut apiSecret=SECRET"),
    );

    await expect(executeIngestionSource("saxo", { createLockSession, runSource })).rejects.toThrow(
      "ingestion execution lock open failed: source=saxo message=connect postgres://[REDACTED]@db/equinaut apiSecret=[REDACTED]",
    );
    expect(runSource).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("reports an unlock ownership failure after closing the session", async () => {
    unlock.mockResolvedValue(false);

    await expect(executeIngestionSource("bitbank", { createLockSession, runSource })).rejects.toThrow(
      "ingestion execution lock release failed: source=bitbank message=reserved session did not hold the advisory lock",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("redacts lock session close errors", async () => {
    close.mockRejectedValueOnce(new Error("close failed token=SECRET"));

    await expect(executeIngestionSource("bitbank", { createLockSession, runSource })).rejects.toThrow(
      "ingestion execution lock close failed: source=bitbank message=close failed token=[REDACTED]",
    );
  });
});
