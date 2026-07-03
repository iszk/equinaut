import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBitflyerAuthHeaders, createSigningPayload } from "./signing.js";

describe("bitflyer signing", () => {
  it("builds signing payload from timestamp, method, path, and body", () => {
    expect(
      createSigningPayload({
        timestamp: "1700000000.123",
        method: "GET",
        requestPathWithQuery: "/v1/me/getbalance",
      }),
    ).toBe("1700000000.123GET/v1/me/getbalance");
  });

  it("creates HMAC-SHA256 auth headers without exposing the secret", () => {
    const headers = createBitflyerAuthHeaders({
      apiKey: "key",
      apiSecret: "secret",
      method: "GET",
      requestPathWithQuery: "/v1/me/getpositions?product_code=FX_BTC_JPY",
      timestamp: "1700000000.123",
    });
    const expectedSignature = createHmac("sha256", "secret")
      .update("1700000000.123GET/v1/me/getpositions?product_code=FX_BTC_JPY")
      .digest("hex");

    expect(headers).toEqual({
      "ACCESS-KEY": "key",
      "ACCESS-TIMESTAMP": "1700000000.123",
      "ACCESS-SIGN": expectedSignature,
    });
    expect(Object.values(headers)).not.toContain("secret");
  });
});
