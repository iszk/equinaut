import { afterEach, describe, expect, it, vi } from "vitest";
import { BitbankHttpClientError, createBitbankHttpClient } from "./client.js";
import type { FetchLike } from "./client.js";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

describe("createBitbankHttpClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a distinct timeout signal to private and public requests", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      signals.push(init?.signal ?? undefined);
      return input.includes("user/assets")
        ? jsonResponse({ success: 1, data: { assets: [] } })
        : jsonResponse({ success: 1, data: [] });
    };
    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
      requestTimeoutMs: 1000,
    });

    await client.getUserAssets();
    await client.getTickersJpy();

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("normalizes an aborted request as a retryable timeout without raw details", async () => {
    vi.useFakeTimers();
    const fetchFn: FetchLike = async (_input, init) => {
      if (init?.signal === undefined) {
        throw new Error("missing timeout signal");
      }

      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("raw fetch rejection secret-token")), {
          once: true,
        });
      });
    };
    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "api-key", apiSecret: "api-secret" },
      fetchFn,
      requestTimeoutMs: 1000,
    });
    const request = client.getTickersJpy();
    const settledRequest = request.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(1000);

    const error = await settledRequest;
    expect(error).toMatchObject({
      message: "bitbank request timed out",
      metadata: {
        endpoint: "GET /tickers_jpy",
        normalizedErrorCode: "bitbank_request_timeout",
        retryable: true,
        category: "network",
        requestTimeoutMs: 1000,
      },
    });
    expect(JSON.stringify(error)).not.toContain("secret-token");
  });

  it("keeps ordinary fetch rejection as a network error", async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error("ordinary network failure secret-token");
    };
    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "api-key", apiSecret: "api-secret" },
      fetchFn,
      requestTimeoutMs: 1000,
    });

    await expect(client.getTickersJpy()).rejects.toMatchObject({
      message: "bitbank request failed",
      metadata: {
        normalizedErrorCode: "bitbank_network_error",
        retryable: true,
        category: "network",
      },
    });
  });

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

    await expect(client.getTickersJpy()).resolves.toEqual({
      success: 0,
      data: { code: 10009 },
      metadata: {
        endpoint: "GET /tickers_jpy",
        httpStatus: 200,
        bitbankErrorCode: 10009,
        normalizedErrorCode: "rate_limited",
        retryable: true,
        category: "api",
      },
    });
  });

  it("classifies HTTP 429 as retryable rate limit without storing the raw body", async () => {
    const fetchFn: FetchLike = async () =>
      new Response("Authorization: Bearer secret-token", { status: 429, headers: { "content-type": "application/json" } });

    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    try {
      await client.getTickersJpy();
      throw new Error("expected client.getTickersJpy to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BitbankHttpClientError);
      if (error instanceof BitbankHttpClientError) {
        expect(error.message).toBe("bitbank API returned an HTTP error");
        expect(error.metadata).toEqual({
          endpoint: "GET /tickers_jpy",
          httpStatus: 429,
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

    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getTickersJpy()).rejects.toMatchObject({
      metadata: {
        endpoint: "GET /tickers_jpy",
        httpStatus: 200,
        normalizedErrorCode: "bitbank_non_json_response",
        retryable: false,
        category: "contract",
      },
    });
  });

  it("classifies schema mismatches with endpoint metadata", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ success: 1, data: [{ pair: "btc_jpy", last: null }] });

    const client = createBitbankHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getTickersJpy()).rejects.toMatchObject({
      metadata: {
        endpoint: "GET /tickers_jpy",
        httpStatus: 200,
        normalizedErrorCode: "bitbank_response_contract_error",
        retryable: false,
        category: "contract",
      },
    });
  });
});
