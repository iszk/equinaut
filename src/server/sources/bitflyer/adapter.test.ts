import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
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

  it("keeps a spot request timeout isolated from the CFD scope", async () => {
    const client: BitflyerHttpClient = {
      ...successfulClient,
      async getBalance() {
        throw new BitflyerHttpClientError("raw timeout secret-token", {
          endpoint: "GET /v1/me/getbalance",
          normalizedErrorCode: "bitflyer_request_timeout",
          retryable: true,
          category: "network",
          requestTimeoutMs: 1000,
        });
      },
    };

    const results = await collectBitflyerAccounts({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(results[0]).toMatchObject({
      scopeId: "bitflyer:spot_account",
      status: "failed",
      error: {
        code: "bitflyer_request_timeout",
        message: "bitflyer request timed out",
        retryable: true,
        category: "network",
        metadata: {
          endpoint: "GET /v1/me/getbalance",
          normalizedErrorCode: "bitflyer_request_timeout",
          retryable: true,
          category: "network",
          requestTimeoutMs: 1000,
        },
      },
    });
    expect(results[1]?.status).toBe("success");
    expect(JSON.stringify(results)).not.toContain("secret-token");
  });

  it("returns partial spot holdings when a ticker is unavailable with a non-retryable API error", async () => {
    const client: BitflyerHttpClient = {
      ...successfulClient,
      async getBalance() {
        return [
          { currency_code: "JPY", amount: "1000", available: "1000" },
          { currency_code: "ETH", amount: "0.5", available: "0.5" },
        ];
      },
      async getTicker(productCode) {
        if (productCode === "ETH_JPY") {
          throw new BitflyerHttpClientError("bitflyer API returned an error", {
            endpoint: "GET /v1/ticker",
            httpStatus: 400,
            rawErrorCode: "-100",
            normalizedErrorCode: "bitflyer_api_error",
            retryable: false,
            category: "api",
          });
        }

        return successfulClient.getTicker(productCode);
      },
    };

    const results = await collectBitflyerAccounts({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(results[0]?.status).toBe("partial");
    if (results[0]?.status === "partial") {
      expect(results[0].error).toMatchObject({ code: "missing_ticker", category: "valuation", retryable: false });
      expect(results[0].holdings.map((holding) => holding.assetKey)).toEqual(["bitflyer:spot_account:cash:JPY"]);
    }
    expect(results[1]?.status).toBe("success");
  });

  it("returns failed spot scope when ticker retrieval fails with a retryable error", async () => {
    const client: BitflyerHttpClient = {
      ...successfulClient,
      async getBalance() {
        return [{ currency_code: "BTC", amount: "0.1", available: "0.1" }];
      },
      async getTicker() {
        throw new BitflyerHttpClientError("bitflyer request failed", {
          endpoint: "GET /v1/ticker",
          normalizedErrorCode: "bitflyer_network_error",
          retryable: true,
          category: "network",
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
      expect(results[0].error).toMatchObject({
        code: "bitflyer_network_error",
        category: "network",
        retryable: true,
      });
    }
  });

  it("keeps invalid union messages when Zod does not include nested union errors", async () => {
    const client: BitflyerHttpClient = {
      ...successfulClient,
      async getBalance() {
        throw new ZodError([
          {
            code: "invalid_union",
            errors: [],
            path: ["currency_code"],
            message: "Invalid union",
          },
        ]);
      },
    };

    const results = await collectBitflyerAccounts({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
      now: new Date("2026-07-02T00:00:00.000Z"),
    });

    expect(results[0]?.status).toBe("failed");
    if (results[0]?.status === "failed") {
      expect(results[0].error.message).toBe(
        "bitflyer API response did not match the expected schema: currency_code: Invalid union",
      );
    }
    expect(results[1]?.status).toBe("success");
  });
});
