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

  it("handles circular references without recursing forever", () => {
    const input: { self?: unknown; nested: { parent?: unknown }; token: string } = {
      nested: {},
      token: "secret-token",
    };
    input.self = input;
    input.nested.parent = input;

    expect(redactSensitiveValue(input)).toEqual({
      nested: { parent: "[Circular]" },
      token: "[REDACTED]",
      self: "[Circular]",
    });
  });

  it("does not treat repeated non-circular references as circular", () => {
    const shared = { symbol: "BTC", apiSecret: "secret" };

    expect(redactSensitiveValue({ first: shared, second: shared })).toEqual({
      first: { symbol: "BTC", apiSecret: "[REDACTED]" },
      second: { symbol: "BTC", apiSecret: "[REDACTED]" },
    });
  });
});
