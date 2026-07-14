import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestionExecutionResult } from "./execution-lock.js";
import type { IngestionSourceId } from "./source-registry.js";
import { runIngestionCli } from "./ingest-cli.js";

const info = vi.fn<(message: string) => void>();
const warn = vi.fn<(message: string) => void>();
const error = vi.fn<(message: string) => void>();
const executeSource = vi.fn<(sourceId: IngestionSourceId) => Promise<IngestionExecutionResult>>();
const logger = { info, warn, error };

describe("runIngestionCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeSource.mockResolvedValue({ status: "success", message: "ok" });
  });

  it.each([
    { label: "missing", args: [] },
    { label: "unknown", args: ["unknown"] },
    { label: "extra", args: ["bitbank", "extra"] },
  ])("rejects $label arguments without opening an execution", async ({ args }) => {
    await expect(runIngestionCli(args, { executeSource, logger })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith("usage: npm run ingest -- <bitbank|bitflyer|saxo>");
    expect(executeSource).not.toHaveBeenCalled();
  });

  it("writes success to stdout and exits zero", async () => {
    executeSource.mockResolvedValue({ status: "success", message: "ingestion succeeded" });

    await expect(runIngestionCli(["bitbank"], { executeSource, logger })).resolves.toBe(0);
    expect(info).toHaveBeenCalledWith("ingestion succeeded");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<IngestionExecutionResult>([
    { status: "partial", message: "ingestion partial" },
    { status: "failed", message: "ingestion failed" },
  ])("writes $status to stderr and exits non-zero", async (result) => {
    executeSource.mockResolvedValue(result);

    await expect(runIngestionCli(["bitflyer"], { executeSource, logger })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(result.message);
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("writes skipped_overlap as a warning and exits zero", async () => {
    executeSource.mockResolvedValue({
      status: "skipped_overlap",
      message: "bitbank ingestion skipped_overlap: another execution is already running",
    });

    await expect(runIngestionCli(["bitbank"], { executeSource, logger })).resolves.toBe(0);
    expect(warn).toHaveBeenCalledWith("bitbank ingestion skipped_overlap: another execution is already running");
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("redacts result messages at the CLI boundary", async () => {
    executeSource.mockResolvedValue({
      status: "failed",
      message: "request failed Authorization: Bearer SECRET token=SECRET",
    });

    await runIngestionCli(["saxo"], { executeSource, logger });

    expect(error).toHaveBeenCalledWith("request failed Authorization: [REDACTED] token=[REDACTED]");
  });

  it("redacts unexpected errors and exits non-zero", async () => {
    executeSource.mockRejectedValue(
      new Error("connect postgres://user:password@db/equinaut apiSecret=SECRET token=SECRET"),
    );

    await expect(runIngestionCli(["saxo"], { executeSource, logger })).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(
      "ingestion command failed: connect postgres://[REDACTED]@db/equinaut apiSecret=[REDACTED] token=[REDACTED]",
    );
  });
});
