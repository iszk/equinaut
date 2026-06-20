#!/usr/bin/env node
import { loadSchedulerConfigFromFile } from "../src/server/ingestion/scheduler-config.js";
import { runScheduledIngestion } from "../src/server/ingestion/scheduler.js";

const defaultConfigPath = "config/ingestion.yaml";

const configPathFromArgs = (args: string[]): string => {
  const configFlagIndex = args.findIndex((arg) => arg === "--config");
  if (configFlagIndex === -1) {
    return process.env.EQUINAUT_INGESTION_CONFIG ?? defaultConfigPath;
  }

  const value = args[configFlagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("usage: tsx scripts/ingest-scheduler.ts [--config path/to/ingestion.yaml]");
  }

  return value;
};

const abortController = new AbortController();
for (const signalName of ["SIGINT", "SIGTERM"] as const) {
  process.once(signalName, () => {
    console.info(`ingestion scheduler received ${signalName}; shutting down`);
    abortController.abort();
  });
}

try {
  const configPath = configPathFromArgs(process.argv.slice(2));
  const config = await loadSchedulerConfigFromFile(configPath);
  await runScheduledIngestion({ config, signal: abortController.signal });
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`ingestion scheduler failed: ${message}`);
  process.exit(1);
}
