import { describe, expect, it } from "vitest";
import { portfolioSnapshotV1Example } from "../../../contracts/portfolio-snapshot/v1.js";
import type { PortfolioSnapshotV1 } from "../../../contracts/portfolio-snapshot/v1.js";
import { PortfolioSnapshotHttpClientError } from "./client.js";
import { collectPortfolioSnapshotHttpSource } from "./adapter.js";
import type { PortfolioSnapshotHttpSourceConfig } from "./types.js";

const sourceConfig: PortfolioSnapshotHttpSourceConfig = {
  sourceId: "saxo",
  displayName: "Saxo Bank",
  scopeId: "saxo:portfolio",
  scopeType: "portfolio",
  assetKeyPrefix: "saxo:portfolio",
};

describe("collectPortfolioSnapshotHttpSource", () => {
  it("returns a successful complete observation with generatedAt and dataAsOf from the snapshot", async () => {
    const result = await collectPortfolioSnapshotHttpSource({
      sourceConfig,
      client: { getPortfolioSnapshot: async () => portfolioSnapshotV1Example },
      now: new Date("2026-07-09T00:00:00.000Z"),
    });

    expect(result.status).toBe("success");
    expect(result.scopeId).toBe("saxo:portfolio");
    expect(result.observedAt).toEqual(new Date(portfolioSnapshotV1Example.generatedAt));
    expect(result.dataAsOf).toEqual(new Date(portfolioSnapshotV1Example.dataAsOf));
    expect(result.holdings.some((holding) => holding.assetKey === "saxo:portfolio:cfd:position-cfd-btc")).toBe(true);
  });

  it("returns failed, not partial, when mapping cannot represent the snapshot", async () => {
    const snapshot: PortfolioSnapshotV1 = {
      ...portfolioSnapshotV1Example,
      positions: [
        {
          sourceAccountId: "account-1",
          sourcePositionId: "option-1",
          sourceInstrumentId: "Option:1",
          assetClass: "option",
          symbol: "OPT",
          quantity: "1",
          valueJpy: "1000",
        },
      ],
    };

    const result = await collectPortfolioSnapshotHttpSource({
      sourceConfig,
      client: { getPortfolioSnapshot: async () => snapshot },
    });

    expect(result).toMatchObject({
      scopeId: "saxo:portfolio",
      status: "failed",
      error: { code: "unsupported_asset_class" },
      holdings: [],
    });
    expect(result.dataAsOf).toEqual(new Date(snapshot.dataAsOf));
  });

  it("normalizes client HTTP errors with retry metadata", async () => {
    const result = await collectPortfolioSnapshotHttpSource({
      sourceConfig,
      client: {
        async getPortfolioSnapshot() {
          throw new PortfolioSnapshotHttpClientError("upstream failed", {
            endpoint: "GET portfolio snapshot",
            httpStatus: 500,
            normalizedErrorCode: "portfolio_snapshot_http_error",
            retryable: true,
            category: "api",
          });
        },
      },
      now: new Date("2026-07-09T00:00:00.000Z"),
    });

    expect(result).toEqual({
      scopeId: "saxo:portfolio",
      observedAt: new Date("2026-07-09T00:00:00.000Z"),
      status: "failed",
      error: {
        code: "portfolio_snapshot_http_error",
        message: "portfolio snapshot API returned an HTTP error (500)",
        retryable: true,
        category: "api",
        metadata: {
          endpoint: "GET portfolio snapshot",
          httpStatus: 500,
          normalizedErrorCode: "portfolio_snapshot_http_error",
          retryable: true,
          category: "api",
        },
      },
      holdings: [],
    });
  });
});
