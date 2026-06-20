import { describe, expect, it } from "vitest";
import { redactSensitiveMessage, redactSensitiveValue } from "./redaction.js";

describe("redactSensitiveValue", () => {
  it("redacts nested credential and signature fields without mutating input", () => {
    const input = {
      headers: {
        "ACCESS-KEY": "key",
        "ACCESS-SIGNATURE": "sig",
        "ACCESS-REQUEST-TIME": "123",
        Authorization: "Bearer token",
        "Set-Cookie": "sid=session",
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
        Authorization: "[REDACTED]",
        "Set-Cookie": "[REDACTED]",
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

describe("redactSensitiveMessage", () => {
  it("redacts database URLs and common secret key-value fragments", () => {
    expect(
      redactSensitiveMessage(
        "connect failed postgres://user:***@db.example/equinaut password=secret token=abc api_key=key api-secret=secret",
      ),
    ).toBe(
      "connect failed postgres://[REDACTED]@db.example/equinaut password=[REDACTED] token=[REDACTED] api_key=[REDACTED] api-secret=[REDACTED]",
    );
  });

  it("redacts prefixed secret key-value fragments", () => {
    expect(
      redactSensitiveMessage(
        "DB_PASSWORD=secret SERVICE_TOKEN=abc EXCHANGE_API_KEY=key BITBANK_API_SECRET=secret",
      ),
    ).toBe(
      "DB_PASSWORD=[REDACTED] SERVICE_TOKEN=[REDACTED] EXCHANGE_API_KEY=[REDACTED] BITBANK_API_SECRET=[REDACTED]",
    );
  });

  it("redacts common credential header fragments", () => {
    expect(
      redactSensitiveMessage(
        "Authorization: Bearer *** Cookie=session=secret Set-Cookie: sid=secret ACCESS-KEY=key ACCESS-SIGNATURE=sig ACCESS-REQUEST-TIME=123",
      ),
    ).toBe(
      "Authorization: [REDACTED] Cookie=[REDACTED] Set-Cookie: [REDACTED] ACCESS-KEY=[REDACTED] ACCESS-SIGNATURE=[REDACTED] ACCESS-REQUEST-TIME=[REDACTED]",
    );
  });

  it("redacts non-Bearer authorization schemes without leaking the credential", () => {
    expect(redactSensitiveMessage("Authorization: Basic abc123 Cookie=session=secret")).toBe(
      "Authorization: [REDACTED] Cookie=[REDACTED]",
    );
  });

  it("leaves non-secret message fragments untouched", () => {
    expect(redactSensitiveMessage("insert failed source=bitbank status=failed")).toBe(
      "insert failed source=bitbank status=failed",
    );
  });
});
