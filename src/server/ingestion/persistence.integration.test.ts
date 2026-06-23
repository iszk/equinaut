import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTestDatabase, isTestDatabaseUrlConfigured } from "../db/test-database.js";
import {
  assetSnapshots,
  ingestionRuns,
  observationScopes,
  portfolioLatestAssets,
  scopeObservations,
  sourceAccounts,
} from "../db/schema.js";
import { createDrizzleIngestionPersistenceDriver, persistBitbankSpotObservation } from "./persistence.js";
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

const maybeDescribe = isTestDatabaseUrlConfigured(process.env.TEST_DATABASE_URL) ? describe : describe.skip;

maybeDescribe("persistBitbankSpotObservation integration", () => {
  it("persists successful bitbank observations into an isolated migrated test schema", async () => {
    await withTestDatabase(async ({ db, schemaName }) => {
      const driver = createDrizzleIngestionPersistenceDriver(db);

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt,
          status: "success",
          holdings: [jpyHolding],
        },
      });

      const [sourceAccount] = await db.select().from(sourceAccounts);
      expect(sourceAccount).toMatchObject({ sourceId: "bitbank", displayName: "bitbank", status: "active" });

      const [scope] = await db.select().from(observationScopes);
      expect(scope).toMatchObject({ scopeId: "bitbank:spot_account", scopeType: "spot_account", status: "active" });

      const [run] = await db.select().from(ingestionRuns);
      expect(run).toMatchObject({ status: "success", errorCode: null, errorMessage: null });

      const [observation] = await db.select().from(scopeObservations);
      expect(observation).toMatchObject({ status: "success", errorCode: null, retryable: null });
      expect(observation?.observedAt.toISOString()).toBe("2026-06-17T12:34:56.000Z");

      const [snapshot] = await db.select().from(assetSnapshots).where(eq(assetSnapshots.assetKey, jpyHolding.assetKey));
      expect(snapshot).toMatchObject({
        assetKey: "bitbank:spot_account:cash:JPY",
        assetType: "cash",
        symbol: "JPY",
        quantity: "1000.000000000000000000",
        price: "1.000000000000000000",
        priceCurrency: "JPY",
        fxToJpy: "1.000000000000000000",
        valueJpy: "1000.000000000000000000",
      });

      expect(schemaName).toMatch(/^test_[a-f0-9]{16}$/u);
    });
  });

  it("reuses source account and observation scope via unique constraints", async () => {
    await withTestDatabase(async ({ db }) => {
      const driver = createDrizzleIngestionPersistenceDriver(db);

      for (const quantity of ["1000", "2000"]) {
        await persistBitbankSpotObservation({
          driver,
          observation: {
            scopeId: "bitbank:spot_account",
            observedAt,
            status: "success",
            holdings: [{ ...jpyHolding, quantity, valueJpy: quantity }],
          },
        });
      }

      await expect(db.select().from(sourceAccounts)).resolves.toHaveLength(1);
      await expect(db.select().from(observationScopes)).resolves.toHaveLength(1);
      await expect(db.select().from(ingestionRuns)).resolves.toHaveLength(2);
      await expect(db.select().from(scopeObservations)).resolves.toHaveLength(2);
      await expect(db.select().from(assetSnapshots)).resolves.toHaveLength(2);
    });
  });

  it("persists partial observation snapshots without exposing them as latest portfolio assets", async () => {
    await withTestDatabase(async ({ db }) => {
      const driver = createDrizzleIngestionPersistenceDriver(db);

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt,
          status: "success",
          holdings: [jpyHolding],
        },
      });

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-17T12:35:56.000Z"),
          status: "partial",
          error: {
            code: "missing_ticker",
            message: "Missing JPY ticker for BTC",
            retryable: false,
            category: "valuation",
          },
          holdings: [{ ...jpyHolding, quantity: "2000", valueJpy: "2000" }],
        },
      });

      const runs = await db.select().from(ingestionRuns);
      expect(runs.map((run) => run.status)).toEqual(["success", "partial"]);
      expect(runs[1]).toMatchObject({ status: "partial", errorCode: "missing_ticker" });

      const observations = await db.select().from(scopeObservations);
      expect(observations.map((observation) => observation.status)).toEqual(["success", "partial"]);
      expect(observations[1]).toMatchObject({ status: "partial", errorCode: "missing_ticker", retryable: false });

      await expect(db.select().from(assetSnapshots)).resolves.toHaveLength(2);

      const [latestAsset] = await db.select().from(portfolioLatestAssets);
      expect(latestAsset).toMatchObject({ assetKey: jpyHolding.assetKey, symbol: "JPY", valueJpy: "1000.000000000000000000" });
    });
  });
});
