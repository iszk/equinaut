import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const knownSourceIdSchema = z.enum(["bitbank", "bitflyer", "saxo"]);

const rawSourceConfigSchema = z.object({
  id: knownSourceIdSchema,
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().positive().optional(),
});

const rawSchedulerConfigSchema = z
  .object({
    scheduler: z
      .object({
        runOnStart: z.boolean().default(true),
        defaultIntervalSeconds: z.number().int().positive(),
        minIntervalSeconds: z.number().int().positive().default(60),
      })
      .strict(),
    sources: z.array(rawSourceConfigSchema.strict()).min(1),
  })
  .strict();

export type IngestionSourceId = z.infer<typeof knownSourceIdSchema>;

export type SchedulerSourceConfig = {
  id: IngestionSourceId;
  enabled: true;
  intervalSeconds: number;
};

export type SchedulerConfig = {
  scheduler: {
    runOnStart: boolean;
    minIntervalSeconds: number;
  };
  sources: SchedulerSourceConfig[];
};

export class SchedulerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulerConfigError";
  }
}

export const parseSchedulerConfig = (content: string): SchedulerConfig => {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new SchedulerConfigError(`failed to parse ingestion scheduler config: ${message}`);
  }

  const rawResult = rawSchedulerConfigSchema.safeParse(parsed);
  if (!rawResult.success) {
    throw new SchedulerConfigError(`invalid ingestion scheduler config: ${rawResult.error.issues[0]?.message ?? "unknown error"}`);
  }

  const raw = rawResult.data;
  if (raw.scheduler.defaultIntervalSeconds < raw.scheduler.minIntervalSeconds) {
    throw new SchedulerConfigError("defaultIntervalSeconds must be greater than or equal to minIntervalSeconds");
  }
  const seenSourceIds = new Set<IngestionSourceId>();
  for (const source of raw.sources) {
    if (seenSourceIds.has(source.id)) {
      throw new SchedulerConfigError(`duplicate ingestion source id: ${source.id}`);
    }
    seenSourceIds.add(source.id);
  }

  const sources = raw.sources
    .filter((source) => source.enabled)
    .map((source) => ({
      id: source.id,
      enabled: true as const,
      intervalSeconds: source.intervalSeconds ?? raw.scheduler.defaultIntervalSeconds,
    }));

  for (const source of sources) {
    if (source.intervalSeconds < raw.scheduler.minIntervalSeconds) {
      throw new SchedulerConfigError("intervalSeconds must be greater than or equal to minIntervalSeconds");
    }
  }

  if (sources.length === 0) {
    throw new SchedulerConfigError("at least one ingestion source must be enabled");
  }

  return {
    scheduler: {
      runOnStart: raw.scheduler.runOnStart,
      minIntervalSeconds: raw.scheduler.minIntervalSeconds,
    },
    sources,
  };
};

export const loadSchedulerConfigFromFile = async (path: string): Promise<SchedulerConfig> => {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown read error";
    throw new SchedulerConfigError(`failed to read ingestion scheduler config at ${path}: ${message}`);
  }

  return parseSchedulerConfig(content);
};
