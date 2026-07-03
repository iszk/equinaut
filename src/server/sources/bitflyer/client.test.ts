import { describe, expect, it } from "vitest";
import { BitflyerHttpClientError, createBitflyerHttpClient } from "./client.js";
import type { FetchLike } from "./client.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

describe("createBitflyerHttpClient", () => {
  it("signs private GET requests and parses balances", async () => {
    const seenHeaders: Headers[] = [];
    const fetchFn: FetchLike = async (_input, init) => {
      seenHeaders.push(new Headers(init?.headers));
      return jsonResponse([{ currency_code: "BTC", amount: 0.1, available: 0.05 }]);
    };

    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
      timestamp: () => "1700000000.123",
    });

    await expect(client.getBalance()).resolves.toEqual([
      { currency_code: "BTC", amount: "0.1", available: "0.05" },
    ]);
    expect(seenHeaders[0]?.get("ACCESS-KEY")).toBe("key");
    expect(seenHeaders[0]?.get("ACCESS-TIMESTAMP")).toBe("1700000000.123");
    expect(seenHeaders[0]?.get("ACCESS-SIGN")).toBeTruthy();
    expect(seenHeaders[0]?.get("ACCESS-SIGN")).not.toBe("secret");
  });

  it("parses ticker ltp as a decimal string", async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        product_code: "BTC_JPY",
        timestamp: "2026-07-02T00:00:00.000",
        ltp: 10000000,
      });

    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getTicker("BTC_JPY")).resolves.toEqual({
      product_code: "BTC_JPY",
      timestamp: "2026-07-02T00:00:00.000",
      ltp: "10000000",
    });
  });

  it("classifies HTTP 429 as retryable rate limit without storing the raw body", async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({ status: -500, error_message: "Authorization: Bearer secret-token" }, 429);

    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    try {
      await client.getBalance();
      throw new Error("expected client.getBalance to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BitflyerHttpClientError);
      if (error instanceof BitflyerHttpClientError) {
        expect(error.metadata).toEqual({
          endpoint: "GET /v1/me/getbalance",
          httpStatus: 429,
          rawErrorCode: "-500",
          normalizedErrorCode: "rate_limited",
          retryable: true,
          category: "api",
        });
        expect(JSON.stringify(error)).not.toContain("secret-token");
      }
    }
  });

  it("classifies successful non-JSON responses as contract errors", async () => {
    const fetchFn: FetchLike = async () => textResponse("<html>not json</html>");

    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getTicker("BTC_JPY")).rejects.toMatchObject({
      metadata: {
        endpoint: "GET /v1/ticker",
        httpStatus: 200,
        normalizedErrorCode: "bitflyer_non_json_response",
        retryable: false,
        category: "contract",
      },
    });
  });
});
