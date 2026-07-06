import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { portfolioSnapshotV1Example, portfolioSnapshotV1Schema } from "../src/contracts/portfolio-snapshot/v1.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractsDirectory = path.join(repositoryRoot, "docs", "contracts");

const writeJson = async (fileName: string, value: unknown): Promise<void> => {
  await writeFile(path.join(contractsDirectory, fileName), `${JSON.stringify(value, null, 2)}\n`);
};

await mkdir(contractsDirectory, { recursive: true });

await writeJson("portfolio-snapshot.v1.schema.json", z.toJSONSchema(portfolioSnapshotV1Schema, { target: "draft-2020-12" }));
await writeJson("portfolio-snapshot.v1.example.json", portfolioSnapshotV1Example);
