import { createDbClient } from "../db/index.js";
import { loadBitbankCredentials } from "../config/secrets.js";
import { createBitbankHttpClient } from "../sources/bitbank/client.js";
import { collectBitbankSpotAccount } from "../sources/bitbank/adapter.js";
import { createDrizzleIngestionPersistenceDriver, persistBitbankSpotObservation } from "./persistence.js";

export type IngestionRunResult = {
  status: "success" | "partial" | "failed";
  message: string;
};

const redactUrlCredentials = (message: string): string =>
  message
    .replace(/(postgres(?:ql)?:\/\/)[^:\s/@]+:[^@\s]+@/g, "$1[REDACTED]@")
    .replace(/\b(password|token|api[_-]?key|api[_-]?secret)=([^\s,;]+)/gi, "$1=[REDACTED]");

const errorDetail = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return redactUrlCredentials(error.message);
  }

  return "unknown error";
};

export const runBitbankIngestion = async (): Promise<IngestionRunResult> => {
  const credentials = loadBitbankCredentials();
  if (credentials.status === "disabled") {
    return { status: "failed", message: "bitbank adapter disabled: missing credentials" };
  }

  const client = createBitbankHttpClient({ credentials });
  const result = await collectBitbankSpotAccount({ credentials, client });

  try {
    const dbClient = createDbClient();
    try {
      await persistBitbankSpotObservation({
        driver: createDrizzleIngestionPersistenceDriver(dbClient.db),
        observation: result,
      });
    } finally {
      await dbClient.close();
    }
  } catch (error) {
    return { status: "failed", message: `bitbank ingestion failed: persistence_error - ${errorDetail(error)}` };
  }

  if (result.status === "success") {
    return { status: "success", message: `bitbank ingestion succeeded: ${result.holdings.length} holdings collected` };
  }

  return { status: result.status, message: `bitbank ingestion ${result.status}: ${result.error.code} - ${result.error.message}` };
};
