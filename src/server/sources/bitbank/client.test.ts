import { describe, expect, it } from "vitest";
import { createBitbankHttpClient } from "./client.js";
import type { FetchLike } from "./client.js";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

describe("createBitbankHttpClient", () => {
  it("parses current tickers_jpy array responses into a pair-keyed record", async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        success: 1,
        data: [
          {
            pair: "btc_jpy",
            sell: "10000001",
            buy: "9999999",
            high: "11000000",
            low: "9000000",
            last: "10000000",
            vol: "12.34",
            timestamp: 1700000000000,
          },
          {
            pair: "eth_jpy",
            sell: null,
            buy: null,
            high: "550000",
            low: "450000",
            last: "500000",
            vol: "56.78",
            timestamp: 1700000000001,
          },
        ],
      });

    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getTickersJpy()).resolves.toEqual({
      success: 1,
      data: {
        btc_jpy: {
          sell: "10000001",
          buy: "9999999",
          high: "11000000",
          low: "9000000",
          last: "10000000",
          vol: "12.34",
          timestamp: 1700000000000,
        },
        eth_jpy: {
          sell: null,
          buy: null,
          high: "550000",
          low: "450000",
          last: "500000",
          vol: "56.78",
          timestamp: 1700000000001,
        },
      },
    });
  });

  it("preserves bitbank API error responses from tickers_jpy", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ success: 0, data: { code: 10009 } });

    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getTickersJpy()).resolves.toEqual({ success: 0, data: { code: 10009 } });
  });
});
