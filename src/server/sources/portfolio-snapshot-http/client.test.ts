import { describe, expect, it, vi } from "vitest";
import { portfolioSnapshotV1Example } from "../../../contracts/portfolio-snapshot/v1.js";
import { PortfolioSnapshotHttpClientError, createPortfolioSnapshotHttpClient } from "./client.js";
import type { FetchLike } from "./client.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

describe("createPortfolioSnapshotHttpClient", () => {
  it("sends a Bearer GET request and parses portfolio-snapshot.v1 JSON", async () => {
    const fetchFn = vi.fn<FetchLike>(async () => jsonResponse(portfolioSnapshotV1Example));
    const client = createPortfolioSnapshotHttpClient({
      url: "https://portfolio.example/saxo",
      bearerToken: "secret-token",
      fetchFn,
    });

    await expect(client.getPortfolioSnapshot()).resolves.toEqual(portfolioSnapshotV1Example);
    expect(fetchFn).toHaveBeenCalledWith("https://portfolio.example/saxo", {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer secret-token",
      },
    });
  });

  it("classifies HTTP 429 as a retryable rate limit without retaining response bodies", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ secret: "response-token" }, 429);
    const client = createPortfolioSnapshotHttpClient({
      url: "https://portfolio.example/saxo",
      bearerToken: "secret-token",
      fetchFn,
    });

    try {
      await client.getPortfolioSnapshot();
      throw new Error("expected client.getPortfolioSnapshot to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PortfolioSnapshotHttpClientError);
      if (error instanceof PortfolioSnapshotHttpClientError) {
        expect(error.metadata).toEqual({
          endpoint: "GET portfolio snapshot",
          httpStatus: 429,
          normalizedErrorCode: "rate_limited",
          retryable: true,
          category: "api",
        });
        expect(JSON.stringify(error)).not.toContain("response-token");
        expect(JSON.stringify(error)).not.toContain("secret-token");
      }
    }
  });

  it("classifies successful non-JSON responses as contract errors", async () => {
    const fetchFn: FetchLike = async () => textResponse("<html>not json</html>");
    const client = createPortfolioSnapshotHttpClient({
      url: "https://portfolio.example/saxo",
      bearerToken: "secret-token",
      fetchFn,
    });

    await expect(client.getPortfolioSnapshot()).rejects.toMatchObject({
      metadata: {
        endpoint: "GET portfolio snapshot",
        httpStatus: 200,
        normalizedErrorCode: "portfolio_snapshot_non_json_response",
        retryable: false,
        category: "contract",
      },
    });
  });

  it("classifies schema mismatches with endpoint metadata and zod detail", async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ ...portfolioSnapshotV1Example, schemaVersion: "wrong" });
    const client = createPortfolioSnapshotHttpClient({
      url: "https://portfolio.example/saxo",
      bearerToken: "secret-token",
      fetchFn,
    });

    try {
      await client.getPortfolioSnapshot();
      throw new Error("expected client.getPortfolioSnapshot to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PortfolioSnapshotHttpClientError);
      if (error instanceof PortfolioSnapshotHttpClientError) {
        expect(error.metadata).toEqual({
          endpoint: "GET portfolio snapshot",
          httpStatus: 200,
          normalizedErrorCode: "portfolio_snapshot_response_contract_error",
          retryable: false,
          category: "contract",
        });
        expect(error.zodError).toBeDefined();
      }
    }
  });
});
