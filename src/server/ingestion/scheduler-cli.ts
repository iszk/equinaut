import { redactSensitiveMessage } from "./redaction.js";

export const formatSchedulerCliFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "unknown error";
  return `ingestion scheduler failed: ${redactSensitiveMessage(message)}`;
};
