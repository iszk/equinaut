import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDrizzleIngestionPersistenceDriver, persistBitbankSpotObservation } from "../ingestion/persistence.js";
import type { HoldingSnapshot } from "../sources/bitbank/types.js";
import { isTestDatabaseUrlConfigured, withTestDatabase } from "./test-database.js";
import {
  assetSnapshots,
  ingestionRuns,
  observationScopes,
  portfolioAssetAllocation,
  portfolioLatestAssets,
  portfolioScopeFreshness,
  portfolioValueTimeseries,
  scopeObservations,
  sourceAccounts,
} from "./schema.js";

const maybeDescribe = isTestDatabaseUrlConfigured(process.env.TEST_DATABASE_URL) ? describe : describe.skip;

const holding = (symbol: string, valueJpy: string): HoldingSnapshot => ({
  assetKey: `bitbank:spot_account:crypto:${symbol}`,
  assetType: "crypto",
  symbol,
  quantity: "1",
  price: valueJpy,
  priceCurrency: "JPY",
  fxToJpy: "1",
  valueJpy,
  raw: {
    source: "bitbank",
    endpoint: "GET /user/assets",
    asset: symbol.toLowerCase(),
    amount_precision: 8,
    onhand_amount: "1",
    stop_deposit: false,
    stop_withdrawal: false,
  },
});

maybeDescribe("portfolio dashboard views integration", () => {
  it("creates a partial index for latest successful observation lookups", async () => {
    await withTestDatabase(async ({ db, schemaName }) => {
      const result = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = ${schemaName}
          AND indexname = 'scope_observations_latest_success_idx'
      `);

      expect(result).toHaveLength(1);
      expect(result[0]?.indexdef).toContain("status = 'success'::text");
      expect(result[0]?.indexdef).toContain("voided_at IS NULL");
    });
  });

  it("exposes latest assets, value timeseries, and latest allocation for Grafana queries", async () => {
    await withTestDatabase(async ({ db }) => {
      const driver = createDrizzleIngestionPersistenceDriver(db);

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-17T00:00:00.000Z"),
          status: "success",
          holdings: [holding("BTC", "2000"), holding("ETH", "1000")],
        },
      });

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-18T00:00:00.000Z"),
          status: "success",
          holdings: [holding("BTC", "3000"), holding("ETH", "7000")],
        },
      });

      const latestAssets = await db.select().from(portfolioLatestAssets).orderBy(asc(portfolioLatestAssets.assetKey));
      expect(latestAssets).toMatchObject([
        {
          sourceId: "bitbank",
          scopeId: "bitbank:spot_account",
          scopeType: "spot_account",
          assetKey: "bitbank:spot_account:crypto:BTC",
          symbol: "BTC",
          valueJpy: "3000.000000000000000000",
        },
        {
          sourceId: "bitbank",
          scopeId: "bitbank:spot_account",
          scopeType: "spot_account",
          assetKey: "bitbank:spot_account:crypto:ETH",
          symbol: "ETH",
          valueJpy: "7000.000000000000000000",
        },
      ]);
      expect(latestAssets.map((asset) => asset.observedAt.toISOString())).toEqual([
        "2026-06-18T00:00:00.000Z",
        "2026-06-18T00:00:00.000Z",
      ]);

      const timeseries = await db
        .select()
        .from(portfolioValueTimeseries)
        .orderBy(asc(portfolioValueTimeseries.observedAt));
      expect(timeseries.map((point) => ({ observedAt: point.observedAt.toISOString(), totalValueJpy: point.totalValueJpy }))).toEqual([
        { observedAt: "2026-06-17T00:00:00.000Z", totalValueJpy: "3000.000000000000000000" },
        { observedAt: "2026-06-18T00:00:00.000Z", totalValueJpy: "10000.000000000000000000" },
      ]);

      const allocation = await db.select().from(portfolioAssetAllocation).orderBy(asc(portfolioAssetAllocation.assetKey));
      expect(
        allocation.map((asset) => ({
          sourceId: asset.sourceId,
          scopeId: asset.scopeId,
          scopeType: asset.scopeType,
          assetKey: asset.assetKey,
          valueJpy: asset.valueJpy,
          portfolioWeight: asset.portfolioWeight,
        })),
      ).toEqual([
        {
          sourceId: "bitbank",
          scopeId: "bitbank:spot_account",
          scopeType: "spot_account",
          assetKey: "bitbank:spot_account:crypto:BTC",
          valueJpy: "3000.000000000000000000",
          portfolioWeight: "0.300000000000000000",
        },
        {
          sourceId: "bitbank",
          scopeId: "bitbank:spot_account",
          scopeType: "spot_account",
          assetKey: "bitbank:spot_account:crypto:ETH",
          valueJpy: "7000.000000000000000000",
          portfolioWeight: "0.700000000000000000",
        },
      ]);
    });
  });

  it("excludes voided successful observations from latest assets, timeseries, and allocation", async () => {
    await withTestDatabase(async ({ db }) => {
      const driver = createDrizzleIngestionPersistenceDriver(db);
      const voidedObservedAt = new Date("2026-06-18T00:00:00.000Z");

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-17T00:00:00.000Z"),
          status: "success",
          holdings: [holding("BTC", "2000"), holding("ETH", "1000")],
        },
      });

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: voidedObservedAt,
          status: "success",
          holdings: [holding("BTC", "9000"), holding("ETH", "1000")],
        },
      });

      const [observationScope] = await db
        .select({ id: observationScopes.id })
        .from(observationScopes)
        .where(sql`${observationScopes.scopeId} = ${"bitbank:spot_account"}`);
      if (observationScope === undefined) {
        throw new Error("observation scope insert did not return an id");
      }

      const voidedObservations = await db
        .update(scopeObservations)
        .set({
          voidedAt: new Date("2026-06-19T00:00:00.000Z"),
          voidReason: "誤投入データのため除外",
        })
        .where(
          and(
            eq(scopeObservations.observedAt, voidedObservedAt),
            eq(scopeObservations.observationScopeId, observationScope.id),
          ),
        )
        .returning({ id: scopeObservations.id });
      expect(voidedObservations).toHaveLength(1);

      const latestAssets = await db.select().from(portfolioLatestAssets).orderBy(asc(portfolioLatestAssets.assetKey));
      expect(latestAssets.map((asset) => ({ assetKey: asset.assetKey, valueJpy: asset.valueJpy }))).toEqual([
        { assetKey: "bitbank:spot_account:crypto:BTC", valueJpy: "2000.000000000000000000" },
        { assetKey: "bitbank:spot_account:crypto:ETH", valueJpy: "1000.000000000000000000" },
      ]);
      expect(latestAssets.map((asset) => asset.observedAt.toISOString())).toEqual([
        "2026-06-17T00:00:00.000Z",
        "2026-06-17T00:00:00.000Z",
      ]);

      const timeseries = await db
        .select()
        .from(portfolioValueTimeseries)
        .orderBy(asc(portfolioValueTimeseries.observedAt));
      expect(timeseries.map((point) => ({ observedAt: point.observedAt.toISOString(), totalValueJpy: point.totalValueJpy }))).toEqual([
        { observedAt: "2026-06-17T00:00:00.000Z", totalValueJpy: "3000.000000000000000000" },
      ]);

      const allocation = await db.select().from(portfolioAssetAllocation).orderBy(asc(portfolioAssetAllocation.assetKey));
      expect(allocation.map((asset) => ({ assetKey: asset.assetKey, portfolioWeight: asset.portfolioWeight }))).toEqual([
        { assetKey: "bitbank:spot_account:crypto:BTC", portfolioWeight: "0.666666666666666667" },
        { assetKey: "bitbank:spot_account:crypto:ETH", portfolioWeight: "0.333333333333333333" },
      ]);

      const [freshness] = await db
        .select()
        .from(portfolioScopeFreshness)
        .where(eq(portfolioScopeFreshness.scopeId, "bitbank:spot_account"));
      expect(freshness).toMatchObject({
        latestObservationStatus: "success",
        isLatestSuccess: true,
        usesFallback: false,
      });
      expect(freshness?.latestObservedAt.toISOString()).toBe("2026-06-17T00:00:00.000Z");
      expect(freshness?.latestSuccessObservedAt?.toISOString()).toBe("2026-06-17T00:00:00.000Z");
    });
  });

  it("exposes latest observation status and latest success fallback per source scope", async () => {
    await withTestDatabase(async ({ db }) => {
      const driver = createDrizzleIngestionPersistenceDriver(db);

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-17T00:00:00.000Z"),
          status: "success",
          holdings: [holding("BTC", "2000"), holding("ETH", "1000")],
        },
      });

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-18T00:00:00.000Z"),
          status: "partial",
          error: {
            code: "missing_ticker",
            rawErrorCode: "ticker-1",
            message: "JPY ticker is missing",
            retryable: false,
            category: "valuation",
          },
          holdings: [holding("BTC", "3000")],
        },
      });

      await persistBitbankSpotObservation({
        driver,
        observation: {
          scopeId: "bitbank:spot_account",
          observedAt: new Date("2026-06-19T00:00:00.000Z"),
          status: "failed",
          error: {
            code: "network_failed",
            rawErrorCode: "503",
            message: "network failure",
            retryable: true,
            category: "network",
          },
          holdings: [],
        },
      });

      const [freshness] = await db
        .select()
        .from(portfolioScopeFreshness)
        .where(eq(portfolioScopeFreshness.scopeId, "bitbank:spot_account"));
      expect(freshness).toMatchObject({
        sourceId: "bitbank",
        scopeId: "bitbank:spot_account",
        scopeType: "spot_account",
        latestObservationStatus: "failed",
        latestErrorCode: "network_failed",
        latestRawErrorCode: "503",
        latestRetryable: true,
        isLatestSuccess: false,
        usesFallback: true,
      });
      expect(freshness?.latestObservedAt.toISOString()).toBe("2026-06-19T00:00:00.000Z");
      expect(freshness?.latestSuccessObservedAt?.toISOString()).toBe("2026-06-17T00:00:00.000Z");

      const latestAssets = await db.select().from(portfolioLatestAssets).orderBy(asc(portfolioLatestAssets.assetKey));
      expect(latestAssets.map((asset) => ({ assetKey: asset.assetKey, valueJpy: asset.valueJpy }))).toEqual([
        { assetKey: "bitbank:spot_account:crypto:BTC", valueJpy: "2000.000000000000000000" },
        { assetKey: "bitbank:spot_account:crypto:ETH", valueJpy: "1000.000000000000000000" },
      ]);

      const timeseries = await db
        .select()
        .from(portfolioValueTimeseries)
        .orderBy(asc(portfolioValueTimeseries.observedAt));
      expect(timeseries.map((point) => ({ observedAt: point.observedAt.toISOString(), totalValueJpy: point.totalValueJpy }))).toEqual([
        { observedAt: "2026-06-17T00:00:00.000Z", totalValueJpy: "3000.000000000000000000" },
      ]);
    });
  });

  it("keeps value timeseries and allocation rows scoped when multiple observation scopes exist", async () => {
    await withTestDatabase(async ({ db }) => {
      const observedAt = new Date("2026-06-18T00:00:00.000Z");
      const [sourceAccount] = await db
        .insert(sourceAccounts)
        .values({ sourceId: "bitbank", displayName: "bitbank" })
        .returning({ id: sourceAccounts.id });
      if (sourceAccount === undefined) {
        throw new Error("source account insert did not return an id");
      }

      const scopes: { scopeId: string; symbol: string; valueJpy: string }[] = [
        { scopeId: "bitbank:spot_account", symbol: "BTC", valueJpy: "3000" },
        { scopeId: "bitbank:spot_account:secondary", symbol: "ETH", valueJpy: "7000" },
      ];

      for (const scope of scopes) {
        const [observationScope] = await db
          .insert(observationScopes)
          .values({ sourceAccountId: sourceAccount.id, scopeId: scope.scopeId, scopeType: "spot_account" })
          .returning({ id: observationScopes.id });
        const [ingestionRun] = await db
          .insert(ingestionRuns)
          .values({ sourceAccountId: sourceAccount.id, status: "success", finishedAt: observedAt })
          .returning({ id: ingestionRuns.id });

        if (observationScope === undefined || ingestionRun === undefined) {
          throw new Error("observation setup insert did not return an id");
        }

        const [scopeObservation] = await db
          .insert(scopeObservations)
          .values({
            ingestionRunId: ingestionRun.id,
            observationScopeId: observationScope.id,
            status: "success",
            observedAt,
          })
          .returning({ id: scopeObservations.id });
        if (scopeObservation === undefined) {
          throw new Error("scope observation insert did not return an id");
        }

        await db.insert(assetSnapshots).values({
          scopeObservationId: scopeObservation.id,
          assetKey: `bitbank:spot_account:crypto:${scope.symbol}`,
          assetType: "crypto",
          symbol: scope.symbol,
          quantity: "1",
          price: scope.valueJpy,
          priceCurrency: "JPY",
          fxToJpy: "1",
          valueJpy: scope.valueJpy,
        });
      }

      const timeseries = await db
        .select()
        .from(portfolioValueTimeseries)
        .orderBy(asc(portfolioValueTimeseries.scopeId));

      expect(timeseries.map((point) => ({ scopeId: point.scopeId, totalValueJpy: point.totalValueJpy }))).toEqual([
        { scopeId: "bitbank:spot_account", totalValueJpy: "3000.000000000000000000" },
        { scopeId: "bitbank:spot_account:secondary", totalValueJpy: "7000.000000000000000000" },
      ]);

      const allocation = await db
        .select()
        .from(portfolioAssetAllocation)
        .orderBy(asc(portfolioAssetAllocation.scopeId));

      expect(
        allocation.map((asset) => ({
          scopeId: asset.scopeId,
          assetKey: asset.assetKey,
          valueJpy: asset.valueJpy,
          portfolioWeight: asset.portfolioWeight,
        })),
      ).toEqual([
        {
          scopeId: "bitbank:spot_account",
          assetKey: "bitbank:spot_account:crypto:BTC",
          valueJpy: "3000.000000000000000000",
          portfolioWeight: "1.000000000000000000",
        },
        {
          scopeId: "bitbank:spot_account:secondary",
          assetKey: "bitbank:spot_account:crypto:ETH",
          valueJpy: "7000.000000000000000000",
          portfolioWeight: "1.000000000000000000",
        },
      ]);
    });
  });
});
