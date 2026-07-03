import { runBitbankIngestion, runBitflyerIngestion } from "./run.js";
import type { IngestionRunResult } from "./run.js";
import { redactSensitiveMessage } from "./redaction.js";
import type { IngestionSourceId, SchedulerConfig, SchedulerSourceConfig } from "./scheduler-config.js";

export type SchedulerLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type ScheduledSource = SchedulerSourceConfig & {
  nextRunAt: Date;
};

export type SchedulerRunOptions = {
  config: SchedulerConfig;
  runSource?: (sourceId: IngestionSourceId) => Promise<IngestionRunResult>;
  logger?: SchedulerLogger;
  signal?: AbortSignal;
  now?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  maxSourceRuns?: number;
};

export const runIngestionSource = async (sourceId: IngestionSourceId): Promise<IngestionRunResult> => {
  switch (sourceId) {
    case "bitbank":
      return runBitbankIngestion();
    case "bitflyer":
      return runBitflyerIngestion();
  }
};

const defaultSleep = (milliseconds: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const formatTimestamp = (date: Date): string => date.toISOString();

const createInitialSchedule = (config: SchedulerConfig, now: Date): ScheduledSource[] =>
  config.sources.map((source) => ({
    ...source,
    nextRunAt: config.scheduler.runOnStart ? now : new Date(now.getTime() + source.intervalSeconds * 1000),
  }));

const nextDelayMilliseconds = (scheduledSources: ScheduledSource[], now: Date): number => {
  const nextRunAt = Math.min(...scheduledSources.map((source) => source.nextRunAt.getTime()));
  return Math.max(0, nextRunAt - now.getTime());
};

const dueSources = (scheduledSources: ScheduledSource[], now: Date): ScheduledSource[] =>
  scheduledSources.filter((source) => source.nextRunAt.getTime() <= now.getTime());

export const runScheduledIngestion = async ({
  config,
  runSource = runIngestionSource,
  logger = console,
  signal,
  now = () => new Date(),
  sleep = defaultSleep,
  maxSourceRuns,
}: SchedulerRunOptions): Promise<void> => {
  const scheduledSources = createInitialSchedule(config, now());
  let sourceRuns = 0;

  logger.info(
    `ingestion scheduler started: sources=${scheduledSources.map((source) => source.id).join(",")} runOnStart=${config.scheduler.runOnStart}`,
  );

  while (!signal?.aborted) {
    const currentTime = now();
    const sourcesToRun = dueSources(scheduledSources, currentTime);

    if (sourcesToRun.length === 0) {
      await sleep(nextDelayMilliseconds(scheduledSources, currentTime), signal);
      continue;
    }

    for (const source of sourcesToRun) {
      if (signal?.aborted) {
        break;
      }

      logger.info(`ingestion scheduler source started: source=${source.id}`);
      try {
        const result = await runSource(source.id);
        if (result.status === "success") {
          logger.info(`ingestion scheduler source succeeded: source=${source.id} message=${redactSensitiveMessage(result.message)}`);
        } else {
          logger.error(
            `ingestion scheduler source failed: source=${source.id} status=${result.status} message=${redactSensitiveMessage(result.message)}`,
          );
        }
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "unknown error";
        const message = redactSensitiveMessage(rawMessage);
        logger.error(`ingestion scheduler source crashed: source=${source.id} message=${message}`);
      } finally {
        sourceRuns += 1;
        const completedAt = now();
        const nextRunAt = new Date(completedAt.getTime() + source.intervalSeconds * 1000);
        source.nextRunAt = nextRunAt;
        logger.info(`ingestion scheduler next run: source=${source.id} at=${formatTimestamp(nextRunAt)}`);
      }

      if (maxSourceRuns !== undefined && sourceRuns >= maxSourceRuns) {
        logger.info("ingestion scheduler stopped: maxSourceRuns reached");
        return;
      }
    }
  }

  logger.info("ingestion scheduler stopped: shutdown signal received");
};
