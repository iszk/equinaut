import { describe, expect, it, vi } from "vitest";

import type { SchedulerConfig } from "./scheduler-config.js";
import { runScheduledIngestion } from "./scheduler.js";

const config: SchedulerConfig = {
  scheduler: {
    runOnStart: true,
    minIntervalSeconds: 60,
  },
  sources: [
    {
      id: "bitbank",
      enabled: true,
      intervalSeconds: 60,
    },
  ],
};

describe("runScheduledIngestion", () => {
  it("runs enabled sources on start and logs the next run", async () => {
    const runSource = vi.fn().mockResolvedValue({ status: "success", message: "ok" });
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();

    await runScheduledIngestion({
      config,
      runSource,
      logger: { info, warn, error },
      maxSourceRuns: 1,
      now: () => new Date("2026-06-20T00:00:00.000Z"),
      sleep: vi.fn(),
    });

    expect(runSource).toHaveBeenCalledOnce();
    expect(runSource).toHaveBeenCalledWith("bitbank");
    expect(info).toHaveBeenCalledWith("ingestion scheduler source succeeded: source=bitbank message=ok");
    expect(info).toHaveBeenCalledWith("ingestion scheduler next run: source=bitbank at=2026-06-20T00:01:00.000Z");
  });

  it("continues running after a source failure", async () => {
    const runSource = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed", message: "temporary failure" })
      .mockResolvedValueOnce({ status: "success", message: "ok" });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const currentTimes = [
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:01:00.000Z"),
      new Date("2026-06-20T00:01:00.000Z"),
    ];
    const now = vi.fn(() => currentTimes.shift() ?? new Date("2026-06-20T00:01:00.000Z"));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await runScheduledIngestion({
      config,
      runSource,
      logger,
      maxSourceRuns: 2,
      now,
      sleep,
    });

    expect(runSource).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      "ingestion scheduler source failed: source=bitbank status=failed message=temporary failure",
    );
    expect(logger.info).toHaveBeenCalledWith("ingestion scheduler source succeeded: source=bitbank message=ok");
  });

  it("schedules the next run from completion time instead of start time", async () => {
    const runSource = vi.fn().mockResolvedValue({ status: "success", message: "ok" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const currentTimes = [
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-06-20T00:02:30.000Z"),
    ];
    const now = vi.fn(() => currentTimes.shift() ?? new Date("2026-06-20T00:02:30.000Z"));

    await runScheduledIngestion({
      config,
      runSource,
      logger,
      maxSourceRuns: 1,
      now,
      sleep: vi.fn(),
    });

    expect(logger.info).toHaveBeenCalledWith("ingestion scheduler next run: source=bitbank at=2026-06-20T00:03:30.000Z");
  });
});
