import { describe, expect, it } from "vitest";
import { collectBitflyerAccounts } from "./adapter.js";
import { BitflyerHttpClientError } from "./client.js";
import type { BitflyerHttpClient } from "./client.js";

const successfulClient: BitflyerHttpClient = {
  async getBalance() {
    return [{ currency_code: "JPY", amount: "1000", available: "1000" }];
  },
  async getCollateral() {
    return { collateral: "2000", open_position_pnl: "0", require_collateral: "0", keep_rate: "0" };
  },
  async getCollateralAccounts() {
    return [{ currency_code: "JPY", amount: "2000" }];
  },
  async getPositions() {
    return [];
  },
  async getTicker(productCode) {
    return { product_code: productCode, timestamp: "2026-07-02T00:00:00.000", ltp: "10000000" };
  },
};

describe("collectBitflyerAccounts", () => {
  it("returns failed configuration results for both scopes when credentials are missing", async () => {
    const results = await collectBitflyerAccounts({
      credentials: { status: "disabled", reason: "missing bitflyer credentials", missing: ["BITFLYER_API_SECRET"] },
      client: successfulClient,
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.scopeId)).toEqual(["bitflyer:spot_account", "bitflyer:cfd_account"]);
    expect(results.every((result) => result.status === "failed")).toBe(true);
  });

  it("collects spot and CFD scopes independently", async () => {
    const results = await collectBitflyerAccounts({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client: successfulClient,
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(results.map((result) => result.status)).toEqual(["success", "success"]);
    expect(results[0]?.holdings[0]?.assetKey).toBe("bitflyer:spot_account:cash:JPY");
    expect(results[1]?.holdings[0]?.assetKey).toBe("bitflyer:cfd_account:cash:JPY");
  });

  it("returns a failed spot scope without failing CFD collection", async () => {
    const client: BitflyerHttpClient = {
      ...successfulClient,
      async getBalance() {
        throw new BitflyerHttpClientError("bitflyer API returned an HTTP error", {
          endpoint: "GET /v1/me/getbalance",
          httpStatus: 500,
          normalizedErrorCode: "bitflyer_http_error",
          retryable: true,
          category: "api",
        });
      },
    };

    const results = await collectBitflyerAccounts({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(results[0]?.status).toBe("failed");
    if (results[0]?.status === "failed") {
      expect(results[0].error.code).toBe("bitflyer_http_error");
    }
    expect(results[1]?.status).toBe("success");
  });
});
