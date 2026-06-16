import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectBitbankSpotAccount } from "./adapter.js";
import type { BitbankHttpClient } from "./client.js";

const successfulClient: BitbankHttpClient = {
  async getUserAssets() {
    return {
      success: 1,
      data: {
        assets: [
          {
            asset: "jpy",
            amount_precision: 4,
            onhand_amount: "1000",
            free_amount: "1000",
            locked_amount: "0",
            withdrawing_amount: "0",
            stop_deposit: false,
            stop_withdrawal: false,
          },
        ],
      },
    };
  },
  async getTickersJpy() {
    return { success: 1, data: {} };
  },
};

describe("collectBitbankSpotAccount", () => {
  it("returns failed configuration result when credentials are missing", async () => {
    const result = await collectBitbankSpotAccount({
      credentials: { status: "disabled", reason: "missing bitbank credentials", missing: ["BITBANK_API_SECRET"] },
      client: successfulClient,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error.code).toBe("configuration_error");
      expect(result.holdings).toEqual([]);
    }
  });

  it("returns success holdings for successful API responses", async () => {
    const result = await collectBitbankSpotAccount({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client: successfulClient,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.scopeId).toBe("bitbank:spot_account");
      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0]?.symbol).toBe("JPY");
    }
  });

  it("normalizes API errors without storing raw body", async () => {
    const client: BitbankHttpClient = {
      async getUserAssets() {
        return { success: 0, data: { code: 10009 } };
      },
      async getTickersJpy() {
        return { success: 1, data: {} };
      },
    };

    const result = await collectBitbankSpotAccount({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toMatchObject({ code: "rate_limited", rawErrorCode: "10009", retryable: true });
      expect(result).not.toHaveProperty("raw");
    }
  });

  it("returns a structured failed result when the HTTP client throws", async () => {
    const client: BitbankHttpClient = {
      async getUserAssets() {
        throw new Error("network unavailable");
      },
      async getTickersJpy() {
        return { success: 1, data: {} };
      },
    };

    const result = await collectBitbankSpotAccount({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toEqual({
        code: "bitbank_request_failed",
        message: "network unavailable",
        retryable: true,
        category: "network",
      });
      expect(result.holdings).toEqual([]);
    }
  });

  it("returns a non-retryable contract error when the HTTP client throws a ZodError", async () => {
    const client: BitbankHttpClient = {
      async getUserAssets() {
        z.object({ success: z.literal(1) }).parse({ success: "unexpected" });
        return successfulClient.getUserAssets();
      },
      async getTickersJpy() {
        return { success: 1, data: {} };
      },
    };

    const result = await collectBitbankSpotAccount({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      client,
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toEqual({
        code: "bitbank_response_contract_error",
        message: "bitbank API response did not match the expected schema",
        retryable: false,
        category: "contract",
      });
      expect(result.holdings).toEqual([]);
    }
  });
});
