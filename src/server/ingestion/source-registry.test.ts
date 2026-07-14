import { describe, expect, it, vi } from "vitest";
import type { IngestionRunResult } from "./run.js";
import type { IngestionSourceId } from "./source-registry.js";

const runBitbankIngestion = vi.fn();
const runBitflyerIngestion = vi.fn();
const runSaxoIngestion = vi.fn();

vi.mock("./run.js", () => ({
  runBitbankIngestion,
  runBitflyerIngestion,
  runSaxoIngestion,
}));

const { INGESTION_SOURCE_IDS, isIngestionSourceId, runIngestionSource } = await import("./source-registry.js");

const dispatchCases: [IngestionSourceId, typeof runBitbankIngestion][] = [
  ["bitbank", runBitbankIngestion],
  ["bitflyer", runBitflyerIngestion],
  ["saxo", runSaxoIngestion],
];

describe("ingestion source registry", () => {
  it("defines the supported source IDs in one place", () => {
    expect(INGESTION_SOURCE_IDS).toEqual(["bitbank", "bitflyer", "saxo"]);
    expect(isIngestionSourceId("bitbank")).toBe(true);
    expect(isIngestionSourceId("bitflyer")).toBe(true);
    expect(isIngestionSourceId("saxo")).toBe(true);
    expect(isIngestionSourceId("unknown")).toBe(false);
  });

  it.each(dispatchCases)("dispatches %s to its registered runner", async (sourceId, runner) => {
    const result: IngestionRunResult = { status: "success", message: `${sourceId} ok` };
    runner.mockResolvedValueOnce(result);

    await expect(runIngestionSource(sourceId)).resolves.toEqual(result);
    expect(runner).toHaveBeenCalledOnce();
  });
});
