import { runBitbankIngestion, runBitflyerIngestion, runSaxoIngestion } from "./run.js";
import type { IngestionRunResult } from "./run.js";

export const INGESTION_SOURCE_IDS: readonly ["bitbank", "bitflyer", "saxo"] = ["bitbank", "bitflyer", "saxo"];

export type IngestionSourceId = (typeof INGESTION_SOURCE_IDS)[number];

export type IngestionSourceRunner = () => Promise<IngestionRunResult>;

const ingestionSourceRunners = {
  bitbank: runBitbankIngestion,
  bitflyer: runBitflyerIngestion,
  saxo: runSaxoIngestion,
} satisfies Record<IngestionSourceId, IngestionSourceRunner>;

export const isIngestionSourceId = (value: string): value is IngestionSourceId =>
  INGESTION_SOURCE_IDS.some((sourceId) => sourceId === value);

export const runIngestionSource = async (sourceId: IngestionSourceId): Promise<IngestionRunResult> =>
  ingestionSourceRunners[sourceId]();
