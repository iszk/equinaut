import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

const nonEmptyLines = (value: string): string[] =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

describe("Compose runtime configuration", () => {
  it("excludes local secret files from Git and the Docker build context", () => {
    expect(nonEmptyLines(readProjectFile(".gitignore"))).toContain("secrets/");
    expect(nonEmptyLines(readProjectFile(".dockerignore"))).toContain("secrets/");
  });

  it("documents the file-mounted secret contract without secret values", () => {
    const envExample = readProjectFile(".env.example");

    expect(envExample).toContain("EQUINAUT_SECRETS_DIR=./secrets");
    expect(envExample).toContain("bitbank_api_key");
    expect(envExample).toContain("bitbank_api_secret");
    expect(envExample).toContain("bitflyer_api_key");
    expect(envExample).toContain("bitflyer_api_secret");
    expect(envExample).toContain("saxo_portfolio_api_secret");
  });
});
