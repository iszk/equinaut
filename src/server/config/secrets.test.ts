import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadBitbankCredentials, loadBitflyerCredentials, loadSaxoPortfolioCredentials, readSecret } from "./secrets.js";

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

  it("falls back to env values when a configured secret file cannot be read", () => {
    const result = readSecret({
      filePath: "/path/to/missing/secret",
      envValue: "from-env",
      label: "BITBANK_API_KEY",
    });

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

describe("loadBitflyerCredentials", () => {
  it("returns available credentials when key and secret exist", () => {
    const result = loadBitflyerCredentials({
      BITFLYER_API_KEY: "key",
      BITFLYER_API_SECRET: "secret",
    });

    expect(result).toEqual({ status: "available", apiKey: "key", apiSecret: "secret" });
  });

  it("returns disabled when a credential is missing", () => {
    const result = loadBitflyerCredentials({ BITFLYER_API_KEY: "key" });

    expect(result).toEqual({
      status: "disabled",
      reason: "missing bitflyer credentials",
      missing: ["BITFLYER_API_SECRET"],
    });
  });
});

describe("loadSaxoPortfolioCredentials", () => {
  it("returns available credentials when URL and secret exist", () => {
    const result = loadSaxoPortfolioCredentials({
      SAXO_PORTFOLIO_API_URL: " https://portfolio.example/snapshot ",
      SAXO_PORTFOLIO_API_SECRET: "secret",
    });

    expect(result).toEqual({
      status: "available",
      apiUrl: "https://portfolio.example/snapshot",
      apiSecret: "secret",
    });
  });

  it("prefers file-mounted secrets over env values", () => {
    const result = loadSaxoPortfolioCredentials({
      SAXO_PORTFOLIO_API_URL: "https://portfolio.example/snapshot",
      SAXO_PORTFOLIO_API_SECRET_FILE: fileWith("from-file\n"),
      SAXO_PORTFOLIO_API_SECRET: "from-env",
    });

    expect(result).toEqual({
      status: "available",
      apiUrl: "https://portfolio.example/snapshot",
      apiSecret: "from-file",
    });
  });

  it("returns disabled when URL or secret is missing", () => {
    const result = loadSaxoPortfolioCredentials({});

    expect(result).toEqual({
      status: "disabled",
      reason: "missing saxo portfolio API configuration",
      missing: ["SAXO_PORTFOLIO_API_URL", "SAXO_PORTFOLIO_API_SECRET"],
    });
  });
});
