import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBitbankAuthHeaders, createGetSigningPayload } from "./signing.js";

describe("bitbank signing", () => {
  it("builds GET signing payload from request time, time window, and path", () => {
    expect(createGetSigningPayload("1700000000000", "1000", "/v1/user/assets?x=1")).toBe(
      "17000000000001000/v1/user/assets?x=1",
    );
  });

  it("creates HMAC-SHA256 auth headers without exposing the secret", () => {
    const headers = createBitbankAuthHeaders({
      apiKey: "key",
      apiSecret: "secret",
      requestPathWithQuery: "/v1/user/assets",
      requestTime: "1700000000000",
      timeWindow: "1000",
    });
    const expectedSignature = createHmac("sha256", "secret")
      .update("17000000000001000/v1/user/assets")
      .digest("hex");

    expect(headers).toEqual({
      "ACCESS-KEY": "key",
      "ACCESS-REQUEST-TIME": "1700000000000",
      "ACCESS-TIME-WINDOW": "1000",
      "ACCESS-SIGNATURE": expectedSignature,
    });
    expect(Object.values(headers)).not.toContain("secret");
  });
});
