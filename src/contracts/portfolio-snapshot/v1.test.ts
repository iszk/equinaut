import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  portfolioSnapshotV1DecimalStringPattern,
  portfolioSnapshotV1Example,
  portfolioSnapshotV1Schema,
  portfolioSnapshotV1SchemaVersion,
} from "./v1.js";

const readJsonArtifact = async (relativePath: string): Promise<unknown> => {
  const filePath = fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
  return JSON.parse(await readFile(filePath, "utf8"));
};

describe("portfolio-snapshot.v1 contract", () => {
  it("accepts the bundled example", () => {
    expect(portfolioSnapshotV1Schema.parse(portfolioSnapshotV1Example)).toEqual(portfolioSnapshotV1Example);
  });

  it("rejects unknown top-level fields", () => {
    const result = portfolioSnapshotV1Schema.safeParse({
      ...portfolioSnapshotV1Example,
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it("rejects exponent decimal notation", () => {
    const [firstCashBalance, ...remainingCashBalances] = portfolioSnapshotV1Example.cashBalances;

    if (firstCashBalance === undefined) {
      throw new Error("portfolio snapshot example must include at least one cash balance");
    }

    const result = portfolioSnapshotV1Schema.safeParse({
      ...portfolioSnapshotV1Example,
      cashBalances: [
        {
          ...firstCashBalance,
          amount: "1e3",
        },
        ...remainingCashBalances,
      ],
    });

    expect(result.success).toBe(false);
  });

  it("requires UTC ISO 8601 timestamps", () => {
    const result = portfolioSnapshotV1Schema.safeParse({
      ...portfolioSnapshotV1Example,
      generatedAt: "2026-07-06T12:00:00+09:00",
    });

    expect(result.success).toBe(false);
  });

  it("keeps checked-in artifacts in sync with the TypeScript source", async () => {
    const exampleArtifact = await readJsonArtifact("docs/contracts/portfolio-snapshot.v1.example.json");
    const schemaArtifact = await readJsonArtifact("docs/contracts/portfolio-snapshot.v1.schema.json");

    expect(exampleArtifact).toEqual(portfolioSnapshotV1Example);
    expect(schemaArtifact).toEqual(z.toJSONSchema(portfolioSnapshotV1Schema, { target: "draft-2020-12" }));
  });

  it("exports the contract constants", () => {
    expect(portfolioSnapshotV1SchemaVersion).toBe("portfolio-snapshot.v1");
    expect(portfolioSnapshotV1DecimalStringPattern).toBe("^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$");
  });
});
