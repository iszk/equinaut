import { type InferInsertModel } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
  assetSnapshots,
  ingestionRuns,
  observationScopes,
  scopeObservations,
  sourceAccounts,
} from "../db/schema.js";
import type { HoldingSnapshot, ScopeObservationResult, SourceObservationError, SourceErrorMetadata } from "./source-types.js";

export type PersistedId = { id: string };

export type SourceAccountInput = {
  sourceId: string;
  displayName: string;
};

export type ObservationScopeInput = {
  sourceAccountId: string;
  scopeId: string;
  scopeType: string;
};

export type IngestionRunInput = {
  sourceAccountId: string;
  status: "success" | "partial" | "failed";
  errorCode?: string;
  errorMessage?: string;
};

export type ScopeObservationInput = {
  ingestionRunId: string;
  observationScopeId: string;
  status: "success" | "partial" | "failed";
  observedAt: Date;
  dataAsOf?: Date;
  errorCode?: string;
  rawErrorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
};

export type AssetSnapshotsInput = {
  scopeObservationId: string;
  observedAt: Date;
  holdings: HoldingSnapshot[];
};

export type IngestionPersistenceDriver = {
  transaction<T>(fn: (tx: IngestionPersistenceDriver) => Promise<T>): Promise<T>;
  upsertSourceAccount(input: SourceAccountInput): Promise<PersistedId>;
  upsertObservationScope(input: ObservationScopeInput): Promise<PersistedId>;
  createIngestionRun(input: IngestionRunInput): Promise<PersistedId>;
  createScopeObservation(input: ScopeObservationInput): Promise<PersistedId>;
  createAssetSnapshots(input: AssetSnapshotsInput): Promise<void>;
};

export type ScopeObservationErrorMetadata = {
  endpoint: string;
  http_status?: number;
  bitbank_error_code?: number;
  raw_error_code?: string;
  normalized_error_code: string;
  retryable: boolean;
  category: SourceObservationError["category"];
  request_timeout_ms?: number;
};

type DrizzleTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DrizzleExecutor = Db | DrizzleTransaction;

export type PersistSourceObservationInput = {
  sourceId: string;
  displayName: string;
  scopeType?: string;
  observation: ScopeObservationResult;
};

const scopeTypeFor = (scopeId: string): string => {
  if (scopeId === "bitbank:spot_account") {
    return "spot_account";
  }

  if (scopeId === "bitflyer:spot_account") {
    return "spot_account";
  }

  if (scopeId === "bitflyer:cfd_account") {
    return "cfd_account";
  }

  return scopeId;
};

const errorFor = (observation: ScopeObservationResult): SourceObservationError | undefined => {
  if (observation.status === "success") {
    return undefined;
  }

  return observation.error;
};

const bitbankErrorCodeFrom = (metadata: SourceErrorMetadata): number | undefined => {
  if (!("bitbankErrorCode" in metadata)) {
    return undefined;
  }

  const value = metadata.bitbankErrorCode;
  return typeof value === "number" ? value : undefined;
};

const metadataFor = (error: SourceObservationError): ScopeObservationErrorMetadata | undefined => {
  if (error.metadata === undefined) {
    return undefined;
  }

  const bitbankErrorCode = bitbankErrorCodeFrom(error.metadata);
  return {
    endpoint: error.metadata.endpoint,
    ...(error.metadata.httpStatus === undefined ? {} : { http_status: error.metadata.httpStatus }),
    ...(bitbankErrorCode === undefined ? {} : { bitbank_error_code: bitbankErrorCode }),
    ...(error.metadata.rawErrorCode === undefined ? {} : { raw_error_code: error.metadata.rawErrorCode }),
    normalized_error_code: error.code,
    retryable: error.retryable,
    category: error.category,
    ...(error.metadata.requestTimeoutMs === undefined ? {} : { request_timeout_ms: error.metadata.requestTimeoutMs }),
  };
};

const scopeObservationMetadataFor = ({
  errorMetadata,
  observationMetadata,
}: {
  errorMetadata: ScopeObservationErrorMetadata | undefined;
  observationMetadata: Record<string, unknown> | undefined;
}): Record<string, unknown> | undefined => {
  if (errorMetadata === undefined) {
    return observationMetadata;
  }

  if (observationMetadata === undefined) {
    return { ...errorMetadata };
  }

  return {
    ...observationMetadata,
    ...errorMetadata,
  };
};

export const persistSourceObservation = async ({
  driver,
  sourceId,
  displayName,
  scopeType,
  observation,
}: {
  driver: IngestionPersistenceDriver;
} & PersistSourceObservationInput): Promise<void> => {
  await driver.transaction(async (tx) => {
    const sourceAccount = await tx.upsertSourceAccount({ sourceId, displayName });
    const observationScope = await tx.upsertObservationScope({
      sourceAccountId: sourceAccount.id,
      scopeId: observation.scopeId,
      scopeType: scopeType ?? scopeTypeFor(observation.scopeId),
    });
    const error = errorFor(observation);
    const errorMetadata = error === undefined ? undefined : metadataFor(error);
    const scopeObservationMetadata = scopeObservationMetadataFor({
      errorMetadata,
      observationMetadata: observation.metadata,
    });
    const ingestionRun = await tx.createIngestionRun({
      sourceAccountId: sourceAccount.id,
      status: observation.status,
      ...(error === undefined ? {} : { errorCode: error.code, errorMessage: error.message }),
    });
    const scopeObservation = await tx.createScopeObservation({
      ingestionRunId: ingestionRun.id,
      observationScopeId: observationScope.id,
      status: observation.status,
      observedAt: observation.observedAt,
      ...(observation.dataAsOf === undefined ? {} : { dataAsOf: observation.dataAsOf }),
      ...(error === undefined
        ? {}
        : {
            errorCode: error.code,
            ...(error.rawErrorCode === undefined ? {} : { rawErrorCode: error.rawErrorCode }),
            errorMessage: error.message,
            retryable: error.retryable,
          }),
      ...(scopeObservationMetadata === undefined ? {} : { metadata: scopeObservationMetadata }),
    });

    if (observation.status !== "failed" && observation.holdings.length > 0) {
      await tx.createAssetSnapshots({
        scopeObservationId: scopeObservation.id,
        observedAt: observation.observedAt,
        holdings: observation.holdings,
      });
    }
  });
};

export const persistBitbankSpotObservation = async ({
  driver,
  observation,
}: {
  driver: IngestionPersistenceDriver;
  observation: ScopeObservationResult;
}): Promise<void> => {
  await persistSourceObservation({
    driver,
    sourceId: "bitbank",
    displayName: "bitbank",
    observation,
  });
};

const firstId = (rows: PersistedId[], operation: string): PersistedId => {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`${operation} did not return an id`);
  }
  return row;
};

const createDriverForExecutor = (executor: DrizzleExecutor): IngestionPersistenceDriver => ({
  async transaction<T>(fn: (tx: IngestionPersistenceDriver) => Promise<T>): Promise<T> {
    if (!("transaction" in executor)) {
      return fn(createDriverForExecutor(executor));
    }

    return executor.transaction(async (tx) => fn(createDriverForExecutor(tx)));
  },

  async upsertSourceAccount(input: SourceAccountInput): Promise<PersistedId> {
    const rows = await executor
      .insert(sourceAccounts)
      .values({ sourceId: input.sourceId, displayName: input.displayName })
      .onConflictDoUpdate({
        target: sourceAccounts.sourceId,
        set: { displayName: input.displayName, status: "active", updatedAt: new Date() },
      })
      .returning({ id: sourceAccounts.id });

    return firstId(rows, "upsertSourceAccount");
  },

  async upsertObservationScope(input: ObservationScopeInput): Promise<PersistedId> {
    const rows = await executor
      .insert(observationScopes)
      .values({
        sourceAccountId: input.sourceAccountId,
        scopeId: input.scopeId,
        scopeType: input.scopeType,
      })
      .onConflictDoUpdate({
        target: [observationScopes.sourceAccountId, observationScopes.scopeId],
        set: { scopeType: input.scopeType, status: "active" },
      })
      .returning({ id: observationScopes.id });

    return firstId(rows, "upsertObservationScope");
  },

  async createIngestionRun(input: IngestionRunInput): Promise<PersistedId> {
    const rows = await executor
      .insert(ingestionRuns)
      .values({
        sourceAccountId: input.sourceAccountId,
        status: input.status,
        finishedAt: new Date(),
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
      })
      .returning({ id: ingestionRuns.id });

    return firstId(rows, "createIngestionRun");
  },

  async createScopeObservation(input: ScopeObservationInput): Promise<PersistedId> {
    const rows = await executor
      .insert(scopeObservations)
      .values({
        ingestionRunId: input.ingestionRunId,
        observationScopeId: input.observationScopeId,
        status: input.status,
        observedAt: input.observedAt,
        ...(input.dataAsOf === undefined ? {} : { dataAsOf: input.dataAsOf }),
        ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
        ...(input.rawErrorCode === undefined ? {} : { rawErrorCode: input.rawErrorCode }),
        ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
        ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      })
      .returning({ id: scopeObservations.id });

    return firstId(rows, "createScopeObservation");
  },

  async createAssetSnapshots(input: AssetSnapshotsInput): Promise<void> {
    if (input.holdings.length === 0) {
      return;
    }

    const rows: InferInsertModel<typeof assetSnapshots>[] = input.holdings.map((holding) => ({
      scopeObservationId: input.scopeObservationId,
      observedAt: input.observedAt,
      assetKey: holding.assetKey,
      assetType: holding.assetType,
      symbol: holding.symbol,
      ...(holding.name === undefined ? {} : { name: holding.name }),
      quantity: holding.quantity,
      price: holding.price,
      priceCurrency: holding.priceCurrency,
      fxToJpy: holding.fxToJpy,
      valueJpy: holding.valueJpy,
      raw: holding.raw,
    }));

    await executor.insert(assetSnapshots).values(rows);
  },
});

export const createDrizzleIngestionPersistenceDriver = (db: Db): IngestionPersistenceDriver =>
  createDriverForExecutor(db);
