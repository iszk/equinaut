import type { PortfolioSnapshotV1 } from "../../../contracts/portfolio-snapshot/v1.js";
import type {
  HoldingSnapshot,
  SourceErrorMetadata,
  SourceObservationError,
  SourceObservationErrorCategory,
} from "../../ingestion/source-types.js";

export type PortfolioSnapshotHttpEndpoint = "GET portfolio snapshot";

export type PortfolioSnapshotHttpErrorMetadata = SourceErrorMetadata & {
  endpoint: PortfolioSnapshotHttpEndpoint;
};

export type PortfolioSnapshotHttpClient = {
  getPortfolioSnapshot(): Promise<PortfolioSnapshotV1>;
};

export type PortfolioSnapshotMappingConfig = {
  assetKeyPrefix: string;
};

export type PortfolioSnapshotHttpSourceConfig = {
  sourceId: string;
  displayName: string;
  scopeId: string;
  scopeType: string;
  assetKeyPrefix: string;
};

export type PortfolioSnapshotMappingResult =
  | { status: "success"; holdings: HoldingSnapshot[]; metadata?: Record<string, unknown> }
  | { status: "failed"; error: SourceObservationError; holdings: [] };

export type {
  HoldingSnapshot,
  PortfolioSnapshotV1,
  SourceObservationError,
  SourceObservationErrorCategory,
};
