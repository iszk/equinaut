import type { SaxoPortfolioCredentials } from "../../config/secrets.js";
import type { ScopeObservationResult } from "../../ingestion/source-types.js";
import { collectPortfolioSnapshotHttpSource } from "../portfolio-snapshot-http/adapter.js";
import { createPortfolioSnapshotHttpClient } from "../portfolio-snapshot-http/client.js";
import type { PortfolioSnapshotHttpClient, PortfolioSnapshotHttpSourceConfig } from "../portfolio-snapshot-http/types.js";

type CollectInput = {
  credentials: SaxoPortfolioCredentials;
  client?: PortfolioSnapshotHttpClient;
  now?: Date;
};

export const saxoPortfolioSourceConfig: PortfolioSnapshotHttpSourceConfig = {
  sourceId: "saxo",
  displayName: "Saxo Bank",
  scopeId: "saxo:portfolio",
  scopeType: "portfolio",
  assetKeyPrefix: "saxo:portfolio",
};

export const collectSaxoPortfolio = async ({ credentials, client, now = new Date() }: CollectInput): Promise<ScopeObservationResult> => {
  if (credentials.status === "disabled") {
    return {
      scopeId: saxoPortfolioSourceConfig.scopeId,
      observedAt: now,
      status: "failed",
      error: {
        code: "configuration_error",
        message: credentials.reason,
        retryable: false,
        category: "configuration",
      },
      holdings: [],
    };
  }

  return collectPortfolioSnapshotHttpSource({
    sourceConfig: saxoPortfolioSourceConfig,
    client: client ?? createPortfolioSnapshotHttpClient({ url: credentials.apiUrl, bearerToken: credentials.apiSecret }),
    now,
  });
};
