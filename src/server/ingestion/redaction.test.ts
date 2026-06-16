import { describe, expect, it } from "vitest";
import { redactSensitiveValue } from "./redaction.js";

describe("redactSensitiveValue", () => {
  it("redacts nested credential and signature fields without mutating input", () => {
    const input = {
      headers: {
        "ACCESS-KEY": "key",
        "ACCESS-SIGNATURE": "sig",
        "ACCESS-REQUEST-TIME": "123",
        ok: "visible",
      },
      apiKey: "key",
      apiSecret: "secret",
      signaturePayload: "payload",
      nested: [{ token: "token", symbol: "BTC" }],
    };

    const output = redactSensitiveValue(input);

    expect(output).toEqual({
      headers: {
        "ACCESS-KEY": "[REDACTED]",
        "ACCESS-SIGNATURE": "[REDACTED]",
        "ACCESS-REQUEST-TIME": "[REDACTED]",
        ok: "visible",
      },
      apiKey: "[REDACTED]",
      apiSecret: "[REDACTED]",
      signaturePayload: "[REDACTED]",
      nested: [{ token: "[REDACTED]", symbol: "BTC" }],
    });
    expect(input.apiSecret).toBe("secret");
  });
});
