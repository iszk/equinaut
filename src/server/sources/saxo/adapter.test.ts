import { describe, expect, it } from "vitest";
import { portfolioSnapshotV1Example } from "../../../contracts/portfolio-snapshot/v1.js";
import { collectSaxoPortfolio } from "./adapter.js";

describe("collectSaxoPortfolio", () => {
  it("returns a configuration failure when Saxo API configuration is missing", async () => {
    await expect(
      collectSaxoPortfolio({
        credentials: {
          status: "disabled",
          reason: "missing saxo portfolio API configuration",
          missing: ["SAXO_PORTFOLIO_API_SECRET"],
        },
        now: new Date("2026-07-09T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
      scopeId: "saxo:portfolio",
      observedAt: new Date("2026-07-09T00:00:00.000Z"),
      status: "failed",
      error: {
        code: "configuration_error",
        message: "missing saxo portfolio API configuration",
        retryable: false,
        category: "configuration",
      },
      holdings: [],
    });
  });

  it("uses the generic portfolio-snapshot HTTP collector for available credentials", async () => {
    const result = await collectSaxoPortfolio({
      credentials: {
        status: "available",
        apiUrl: "https://portfolio.example/saxo",
        apiSecret: "secret-token",
      },
      client: { getPortfolioSnapshot: async () => portfolioSnapshotV1Example },
    });

    expect(result.status).toBe("success");
    expect(result.scopeId).toBe("saxo:portfolio");
    expect(result.holdings.map((holding) => holding.assetKey)).toContain("saxo:portfolio:stock:position-7203");
  });
});
