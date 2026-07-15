import { afterEach, describe, expect, it, vi } from "vitest";
import { BitflyerHttpClientError, createBitflyerHttpClient } from "./client.js";
import type { FetchLike } from "./client.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

describe("createBitflyerHttpClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a distinct timeout signal to private and public requests", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      signals.push(init?.signal ?? undefined);
      return input.includes("getbalance")
        ? jsonResponse([{ currency_code: "JPY", amount: 1000, available: 1000 }])
        : jsonResponse({ product_code: "BTC_JPY", timestamp: "2026-07-02T00:00:00.000", ltp: 10000000 });
    };
    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
      requestTimeoutMs: 1000,
    });

    await client.getBalance();
    await client.getTicker("BTC_JPY");

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
    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "api-key", apiSecret: "api-secret" },
      fetchFn,
      requestTimeoutMs: 1000,
    });
    const request = client.getTicker("BTC_JPY");
    const settledRequest = request.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(1000);

    const error = await settledRequest;
    expect(error).toMatchObject({
      message: "bitflyer request timed out",
      metadata: {
        endpoint: "GET /v1/ticker",
        normalizedErrorCode: "bitflyer_request_timeout",
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
    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "api-key", apiSecret: "api-secret" },
      fetchFn,
      requestTimeoutMs: 1000,
    });

    await expect(client.getBalance()).rejects.toMatchObject({
      message: "bitflyer request failed",
      metadata: {
        normalizedErrorCode: "bitflyer_network_error",
        retryable: true,
        category: "network",
      },
    });
  });

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

  it("accepts nullable margin call fields in collateral responses", async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({
        collateral: 30000,
        open_position_pnl: -10,
        require_collateral: 1000,
        keep_rate: 3,
        margin_call_amount: null,
        margin_call_due_date: null,
      });

    const client = createBitflyerHttpClient({
      credentials: { status: "available", apiKey: "key", apiSecret: "secret" },
      fetchFn,
    });

    await expect(client.getCollateral()).resolves.toEqual({
      collateral: "30000",
      open_position_pnl: "-10",
      require_collateral: "1000",
      keep_rate: "3",
      margin_call_amount: null,
      margin_call_due_date: null,
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
