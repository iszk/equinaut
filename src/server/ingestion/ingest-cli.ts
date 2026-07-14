import { executeIngestionSource } from "./execution-lock.js";
import type { IngestionExecutionResult } from "./execution-lock.js";
import { redactSensitiveMessage } from "./redaction.js";
import { isIngestionSourceId } from "./source-registry.js";
import type { IngestionSourceId } from "./source-registry.js";

export type IngestionCliLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type IngestionCliOptions = {
  executeSource?: (sourceId: IngestionSourceId) => Promise<IngestionExecutionResult>;
  logger?: IngestionCliLogger;
};

const usage = "usage: npm run ingest -- <bitbank|bitflyer|saxo>";

const defaultLogger: IngestionCliLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

const errorDetail = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return redactSensitiveMessage(error.message);
  }

  return "unknown error";
};

export const runIngestionCli = async (args: string[], options: IngestionCliOptions = {}): Promise<number> => {
  const logger = options.logger ?? defaultLogger;
  const source = args[0];
  if (args.length !== 1 || source === undefined || !isIngestionSourceId(source)) {
    logger.error(usage);
    return 1;
  }

  const executeSource = options.executeSource ?? executeIngestionSource;
  let result: IngestionExecutionResult;
  try {
    result = await executeSource(source);
  } catch (error) {
    logger.error(`ingestion command failed: ${errorDetail(error)}`);
    return 1;
  }

  const message = redactSensitiveMessage(result.message);
  if (result.status === "success") {
    logger.info(message);
    return 0;
  }

  if (result.status === "skipped_overlap") {
    logger.warn(message);
    return 0;
  }

  logger.error(message);
  return 1;
};
