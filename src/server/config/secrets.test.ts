import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBitbankCredentials, readSecret } from "./secrets.js";

const fileWith = (value: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "equinaut-secret-"));
  const path = join(dir, "secret");
  writeFileSync(path, value, "utf8");
  return path;
};

describe("readSecret", () => {
  it("prefers file-mounted secrets over env values and trims trailing whitespace", () => {
    const result = readSecret({
      filePath: fileWith("from-file\n"),
      envValue: "from-env",
      label: "BITBANK_API_KEY",
    });

    expect(result).toEqual({ status: "available", value: "from-file" });
  });

  it("falls back to env values", () => {
    const result = readSecret({ envValue: "from-env", label: "BITBANK_API_KEY" });

    expect(result).toEqual({ status: "available", value: "from-env" });
  });

  it("returns missing when neither file nor env is set", () => {
    const result = readSecret({ label: "BITBANK_API_KEY" });

    expect(result.status).toBe("missing");
  });
});

describe("loadBitbankCredentials", () => {
  it("returns available credentials when key and secret exist", () => {
    const result = loadBitbankCredentials({
      BITBANK_API_KEY: "key",
      BITBANK_API_SECRET: "secret",
    });

    expect(result).toEqual({ status: "available", apiKey: "key", apiSecret: "secret" });
  });

  it("returns disabled when a credential is missing", () => {
    const result = loadBitbankCredentials({ BITBANK_API_KEY: "key" });

    expect(result).toEqual({
      status: "disabled",
      reason: "missing bitbank credentials",
      missing: ["BITBANK_API_SECRET"],
    });
  });
});
