import { describe, expect, it, vi } from "vitest";
import { isTestDatabaseUrlConfigured, withTestDatabase } from "../db/test-database.js";
import { executeIngestionSource } from "./execution-lock.js";
import type { IngestionRunResult } from "./run.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = isTestDatabaseUrlConfigured(testDatabaseUrl) ? describe : describe.skip;

const requireTestDatabaseUrl = (): string => {
  if (!isTestDatabaseUrlConfigured(testDatabaseUrl)) {
    throw new Error("TEST_DATABASE_URL is not configured");
  }

  return testDatabaseUrl;
};

const createGate = () => {
  let openGate: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    openGate = resolve;
  });

  return {
    promise,
    open: (): void => {
      if (openGate === undefined) {
        throw new Error("gate is not initialized");
      }
      openGate();
    },
  };
};

maybeDescribe("source execution advisory lock integration", () => {
  it("skips the same source, permits a different source, and releases after completion", async () => {
    await withTestDatabase(async () => {
      const databaseUrl = requireTestDatabaseUrl();
      const runnerStarted = createGate();
      const allowRunnerToFinish = createGate();
      const firstRunner = vi.fn(async (): Promise<IngestionRunResult> => {
        runnerStarted.open();
        await allowRunnerToFinish.promise;
        return { status: "success", message: "first completed" };
      });
      const overlappingRunner = vi.fn(
        async (): Promise<IngestionRunResult> => ({ status: "success", message: "unexpected" }),
      );

      const firstExecution = executeIngestionSource("bitbank", { databaseUrl, runSource: firstRunner });
      await runnerStarted.promise;

      try {
        await expect(
          executeIngestionSource("bitbank", { databaseUrl, runSource: overlappingRunner }),
        ).resolves.toMatchObject({ status: "skipped_overlap" });
        expect(overlappingRunner).not.toHaveBeenCalled();

        await expect(
          executeIngestionSource("saxo", {
            databaseUrl,
            runSource: async () => ({ status: "success", message: "different source completed" }),
          }),
        ).resolves.toEqual({ status: "success", message: "different source completed" });
      } finally {
        allowRunnerToFinish.open();
      }

      await expect(firstExecution).resolves.toEqual({ status: "success", message: "first completed" });
      await expect(
        executeIngestionSource("bitbank", {
          databaseUrl,
          runSource: async () => ({ status: "success", message: "lock reacquired" }),
        }),
      ).resolves.toEqual({ status: "success", message: "lock reacquired" });
    });
  });

  it("releases the advisory lock when the runner throws", async () => {
    await withTestDatabase(async () => {
      const databaseUrl = requireTestDatabaseUrl();

      await expect(
        executeIngestionSource("bitflyer", {
          databaseUrl,
          runSource: async () => {
            throw new Error("runner failed");
          },
        }),
      ).rejects.toThrow("runner failed");

      await expect(
        executeIngestionSource("bitflyer", {
          databaseUrl,
          runSource: async () => ({ status: "success", message: "lock reacquired" }),
        }),
      ).resolves.toEqual({ status: "success", message: "lock reacquired" });
    });
  });
});
