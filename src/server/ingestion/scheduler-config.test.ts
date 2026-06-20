import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadSchedulerConfigFromFile, parseSchedulerConfig } from "./scheduler-config.js";

const writeTempConfig = async (content: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "equinaut-scheduler-config-"));
  const path = join(dir, "ingestion.yaml");
  await writeFile(path, content, "utf8");
  return path;
};

describe("parseSchedulerConfig", () => {
  it("applies scheduler defaults and source interval defaults", () => {
    expect(
      parseSchedulerConfig(`
scheduler:
  defaultIntervalSeconds: 900
sources:
  - id: bitbank
`),
    ).toEqual({
      scheduler: {
        runOnStart: true,
        minIntervalSeconds: 60,
      },
      sources: [
        {
          id: "bitbank",
          enabled: true,
          intervalSeconds: 900,
        },
      ],
    });
  });

  it("rejects duplicate source ids", () => {
    expect(() =>
      parseSchedulerConfig(`
scheduler:
  defaultIntervalSeconds: 900
sources:
  - id: bitbank
  - id: bitbank
`),
    ).toThrow("duplicate ingestion source id: bitbank");
  });

  it("rejects source intervals shorter than the configured minimum", () => {
    expect(() =>
      parseSchedulerConfig(`
scheduler:
  defaultIntervalSeconds: 900
  minIntervalSeconds: 60
sources:
  - id: bitbank
    intervalSeconds: 30
`),
    ).toThrow("intervalSeconds must be greater than or equal to minIntervalSeconds");
  });

  it("rejects default intervals shorter than the configured minimum", () => {
    expect(() =>
      parseSchedulerConfig(`
scheduler:
  defaultIntervalSeconds: 30
  minIntervalSeconds: 60
sources:
  - id: bitbank
`),
    ).toThrow("defaultIntervalSeconds must be greater than or equal to minIntervalSeconds");
  });

  it("rejects unknown top-level keys so secrets are not silently accepted", () => {
    expect(() =>
      parseSchedulerConfig(`
scheduler:
  defaultIntervalSeconds: 900
sources:
  - id: bitbank
secrets:
  BITBANK_API_SECRET: should-not-be-here
`),
    ).toThrow("invalid ingestion scheduler config");
  });

  it("rejects configurations with no enabled sources", () => {
    expect(() =>
      parseSchedulerConfig(`
scheduler:
  defaultIntervalSeconds: 900
sources:
  - id: bitbank
    enabled: false
`),
    ).toThrow("at least one ingestion source must be enabled");
  });
});

describe("loadSchedulerConfigFromFile", () => {
  it("loads YAML config from disk", async () => {
    const path = await writeTempConfig(`
scheduler:
  runOnStart: false
  defaultIntervalSeconds: 120
sources:
  - id: bitbank
`);

    await expect(loadSchedulerConfigFromFile(path)).resolves.toEqual({
      scheduler: {
        runOnStart: false,
        minIntervalSeconds: 60,
      },
      sources: [
        {
          id: "bitbank",
          enabled: true,
          intervalSeconds: 120,
        },
      ],
    });
  });
});
