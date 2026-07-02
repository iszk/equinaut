import { createDbClient } from "../db/index.js";
import { loadBitbankCredentials, loadBitflyerCredentials } from "../config/secrets.js";
import { createBitbankHttpClient } from "../sources/bitbank/client.js";
import { collectBitbankSpotAccount } from "../sources/bitbank/adapter.js";
import { collectBitflyerAccounts } from "../sources/bitflyer/adapter.js";
import { createBitflyerHttpClient } from "../sources/bitflyer/client.js";
import { createDrizzleIngestionPersistenceDriver, persistBitbankSpotObservation, persistSourceObservation } from "./persistence.js";
import { redactSensitiveMessage } from "./redaction.js";
import type { ScopeObservationResult } from "./source-types.js";

export type IngestionRunResult = {
  status: "success" | "partial" | "failed";
  message: string;
};

const errorDetail = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return redactSensitiveMessage(error.message);
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

  return {
    status: result.status,
    message: `bitbank ingestion ${result.status}: ${result.error.code} - ${redactSensitiveMessage(result.error.message)}`,
  };
};

const aggregateObservationsStatus = (observations: ScopeObservationResult[]): IngestionRunResult["status"] => {
  if (observations.every((observation) => observation.status === "success")) {
    return "success";
  }

  if (observations.every((observation) => observation.status === "failed")) {
    return "failed";
  }

  return "partial";
};

const summarizeObservation = (observation: ScopeObservationResult): string => {
  if (observation.status === "success") {
    return `${observation.scopeId}:success:${observation.holdings.length}`;
  }

  return `${observation.scopeId}:${observation.status}:${observation.error.code}`;
};

export const runBitflyerIngestion = async (): Promise<IngestionRunResult> => {
  const credentials = loadBitflyerCredentials();
  if (credentials.status === "disabled") {
    return { status: "failed", message: "bitflyer adapter disabled: missing credentials" };
  }

  const client = createBitflyerHttpClient({ credentials });
  const observations = await collectBitflyerAccounts({ credentials, client });

  try {
    const dbClient = createDbClient();
    try {
      const driver = createDrizzleIngestionPersistenceDriver(dbClient.db);
      for (const observation of observations) {
        await persistSourceObservation({
          driver,
          sourceId: "bitflyer",
          displayName: "bitFlyer",
          observation,
        });
      }
    } finally {
      await dbClient.close();
    }
  } catch (error) {
    return { status: "failed", message: `bitflyer ingestion failed: persistence_error - ${errorDetail(error)}` };
  }

  const status = aggregateObservationsStatus(observations);
  const summary = observations.map(summarizeObservation).join(", ");
  if (status === "success") {
    const holdingsCount = observations.reduce((total, observation) => total + observation.holdings.length, 0);
    return {
      status,
      message: `bitflyer ingestion succeeded: ${holdingsCount} holdings collected (${summary})`,
    };
  }

  return {
    status,
    message: `bitflyer ingestion ${status}: ${redactSensitiveMessage(summary)}`,
  };
};
