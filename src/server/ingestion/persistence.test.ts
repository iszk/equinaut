import { describe, expect, it } from "vitest";
import { persistBitbankSpotObservation } from "./persistence.js";
import type { IngestionPersistenceDriver, ScopeObservationInput } from "./persistence.js";
import type { HoldingSnapshot } from "../sources/bitbank/types.js";

const observedAt = new Date("2026-06-17T12:34:56.000Z");

const jpyHolding: HoldingSnapshot = {
  assetKey: "bitbank:spot_account:cash:JPY",
  assetType: "cash",
  symbol: "JPY",
  quantity: "1000",
  price: "1",
  priceCurrency: "JPY",
  fxToJpy: "1",
  valueJpy: "1000",
  raw: {
    source: "bitbank",
    endpoint: "GET /user/assets",
    asset: "jpy",
    amount_precision: 4,
    onhand_amount: "1000",
    stop_deposit: false,
    stop_withdrawal: false,
  },
};

const createRecordingDriver = () => {
  const calls: string[] = [];
  const scopeObservations: ScopeObservationInput[] = [];
  const driver: IngestionPersistenceDriver = {
    async transaction<T>(fn: (tx: IngestionPersistenceDriver) => Promise<T>): Promise<T> {
      calls.push("transaction");
      return fn(driver);
    },
    async upsertSourceAccount(input) {
      calls.push(`upsertSourceAccount:${input.sourceId}:${input.displayName}`);
      return { id: "source-account-id" };
    },
    async upsertObservationScope(input) {
      calls.push(`upsertObservationScope:${input.sourceAccountId}:${input.scopeId}:${input.scopeType}`);
      return { id: "scope-id" };
    },
    async createIngestionRun(input) {
      calls.push(`createIngestionRun:${input.sourceAccountId}:${input.status}:${input.errorCode ?? "none"}`);
      return { id: "run-id" };
    },
    async createScopeObservation(input) {
      scopeObservations.push(input);
      calls.push(
        `createScopeObservation:${input.ingestionRunId}:${input.observationScopeId}:${input.status}:${input.observedAt.toISOString()}:${input.errorCode ?? "none"}:${input.rawErrorCode ?? "none"}:${input.retryable ?? "none"}`,
      );
      return { id: "observation-id" };
    },
    async createAssetSnapshots(input) {
      calls.push(`createAssetSnapshots:${input.scopeObservationId}:${input.holdings.map((holding) => holding.assetKey).join(",")}`);
    },
  };
  return { calls, driver, scopeObservations };
};

describe("persistBitbankSpotObservation", () => {
  it("persists a successful observation and its holdings in one transaction", async () => {
    const { calls, driver } = createRecordingDriver();

    await persistBitbankSpotObservation({
      driver,
      observation: {
        scopeId: "bitbank:spot_account",
        observedAt,
        status: "success",
        holdings: [jpyHolding],
      },
    });

    expect(calls).toEqual([
      "transaction",
      "upsertSourceAccount:bitbank:bitbank",
      "upsertObservationScope:source-account-id:bitbank:spot_account:spot_account",
      "createIngestionRun:source-account-id:success:none",
      "createScopeObservation:run-id:scope-id:success:2026-06-17T12:34:56.000Z:none:none:none",
      "createAssetSnapshots:observation-id:bitbank:spot_account:cash:JPY",
    ]);
  });

  it("persists partial observation errors with successfully mapped asset snapshots", async () => {
    const { calls, driver } = createRecordingDriver();

    await persistBitbankSpotObservation({
      driver,
      observation: {
        scopeId: "bitbank:spot_account",
        observedAt,
        status: "partial",
        error: {
          code: "missing_ticker",
          rawErrorCode: "raw-1",
          message: "Missing JPY ticker for BTC",
          retryable: false,
          category: "valuation",
        },
        holdings: [jpyHolding],
      },
    });

    expect(calls).toEqual([
      "transaction",
      "upsertSourceAccount:bitbank:bitbank",
      "upsertObservationScope:source-account-id:bitbank:spot_account:spot_account",
      "createIngestionRun:source-account-id:partial:missing_ticker",
      "createScopeObservation:run-id:scope-id:partial:2026-06-17T12:34:56.000Z:missing_ticker:raw-1:false",
      "createAssetSnapshots:observation-id:bitbank:spot_account:cash:JPY",
    ]);
  });

  it("persists failed observation errors without asset snapshots", async () => {
    const { calls, driver } = createRecordingDriver();

    await persistBitbankSpotObservation({
      driver,
      observation: {
        scopeId: "bitbank:spot_account",
        observedAt,
        status: "failed",
        error: {
          code: "configuration_error",
          message: "missing bitbank credentials",
          retryable: false,
          category: "configuration",
        },
        holdings: [],
      },
    });

    expect(calls).toEqual([
      "transaction",
      "upsertSourceAccount:bitbank:bitbank",
      "upsertObservationScope:source-account-id:bitbank:spot_account:spot_account",
      "createIngestionRun:source-account-id:failed:configuration_error",
      "createScopeObservation:run-id:scope-id:failed:2026-06-17T12:34:56.000Z:configuration_error:none:false",
    ]);
  });

  it("persists only safe structured error metadata on failed observations", async () => {
    const { driver, scopeObservations } = createRecordingDriver();

    await persistBitbankSpotObservation({
      driver,
      observation: {
        scopeId: "bitbank:spot_account",
        observedAt,
        status: "failed",
        error: {
          code: "rate_limited",
          rawErrorCode: "10009",
          message: "bitbank rate limit exceeded",
          retryable: true,
          category: "api",
          metadata: {
            endpoint: "GET /v1/user/assets",
            httpStatus: 429,
            bitbankErrorCode: 10009,
            normalizedErrorCode: "rate_limited",
            retryable: true,
            category: "api",
          },
        },
        holdings: [],
      },
    });

    expect(scopeObservations[0]?.metadata).toEqual({
      endpoint: "GET /v1/user/assets",
      http_status: 429,
      bitbank_error_code: 10009,
      normalized_error_code: "rate_limited",
      retryable: true,
      category: "api",
    });
  });
});
