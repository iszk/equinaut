import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("uses the default request timeout when it is not configured", () => {
    expect(parseEnv({}).INGESTION_HTTP_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it.each(["1000", "30000", "120000"])("accepts a decimal timeout in range: %s", (value) => {
    expect(parseEnv({ INGESTION_HTTP_REQUEST_TIMEOUT_MS: value }).INGESTION_HTTP_REQUEST_TIMEOUT_MS).toBe(Number(value));
  });

  it.each([
    "",
    " ",
    "999",
    "120001",
    "1.5",
    "-1",
    "1e3",
    "timeout",
  ])("rejects an invalid request timeout: %s", (value) => {
    expect(() => parseEnv({ INGESTION_HTTP_REQUEST_TIMEOUT_MS: value })).toThrow();
  });
});
