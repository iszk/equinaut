import { asc, sql } from "drizzle-orm";
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
  it("creates indexes for latest observation lookups", async () => {
    await withTestDatabase(async ({ db, schemaName }) => {
      const successIndex = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = ${schemaName}
          AND indexname = 'scope_observations_latest_success_idx'
      `);

      expect(successIndex).toHaveLength(1);
      expect(successIndex[0]?.indexdef).toContain("WHERE (status = 'success'::text)");

      const latestIndex = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef
        FROM pg_indexes
        WHERE schemaname = ${schemaName}
          AND indexname = 'scope_observations_latest_idx'
      `);

      expect(latestIndex).toHaveLength(1);
      expect(latestIndex[0]?.indexdef).toContain("observed_at DESC");
    });
  });

  it("exposes ingestion health views for Grafana run history queries", async () => {
    await withTestDatabase(async ({ db }) => {
      const [sourceAccount] = await db
        .insert(sourceAccounts)
        .values({ sourceId: "bitbank", displayName: "bitbank" })
        .returning({ id: sourceAccounts.id });
      if (sourceAccount === undefined) {
        throw new Error("source account insert did not return an id");
      }

      const [observationScope] = await db
        .insert(observationScopes)
        .values({ sourceAccountId: sourceAccount.id, scopeId: "bitbank:spot_account", scopeType: "spot_account" })
        .returning({ id: observationScopes.id });
      if (observationScope === undefined) {
        throw new Error("observation scope insert did not return an id");
      }

      const observations: { status: "success" | "partial" | "failed"; observedAt: Date; errorCode?: string; errorMessage?: string; retryable?: boolean }[] = [
        { status: "success", observedAt: new Date("2026-06-18T00:00:00.000Z") },
        {
          status: "partial",
          observedAt: new Date("2026-06-18T01:00:00.000Z"),
          errorCode: "missing_ticker",
          errorMessage: "Missing JPY ticker for ETH",
          retryable: false,
        },
        {
          status: "failed",
          observedAt: new Date("2026-06-18T02:00:00.000Z"),
          errorCode: "network_error",
          errorMessage: "bitbank API request failed",
          retryable: true,
        },
        {
          status: "failed",
          observedAt: new Date("2026-06-18T03:00:00.000Z"),
          retryable: true,
        },
      ];

      for (const observation of observations) {
        const [ingestionRun] = await db
          .insert(ingestionRuns)
          .values({
            sourceAccountId: sourceAccount.id,
            status: observation.status,
            startedAt: observation.observedAt,
            finishedAt: new Date(observation.observedAt.getTime() + 1_000),
            errorCode: observation.errorCode,
            errorMessage: observation.errorMessage,
          })
          .returning({ id: ingestionRuns.id });
        if (ingestionRun === undefined) {
          throw new Error("ingestion run insert did not return an id");
        }

        await db.insert(scopeObservations).values({
          ingestionRunId: ingestionRun.id,
          observationScopeId: observationScope.id,
          status: observation.status,
          observedAt: observation.observedAt,
          errorCode: observation.errorCode,
          errorMessage: observation.errorMessage,
          retryable: observation.retryable,
        });
      }

      const latestStatus = await db.execute<{
        source_id: string;
        scope_id: string;
        status: string;
        observed_at: Date;
        error_code: string | null;
        latest_success_observed_at: Date | null;
        retryable: boolean | null;
      }>(sql`
        SELECT source_id, scope_id, status, observed_at, error_code, latest_success_observed_at, retryable
        FROM ingestion_latest_status
      `);

      expect(latestStatus).toHaveLength(1);
      expect(latestStatus[0]).toMatchObject({
        source_id: "bitbank",
        scope_id: "bitbank:spot_account",
        status: "failed",
        error_code: null,
        retryable: true,
      });
      expect(new Date(String(latestStatus[0]?.observed_at)).toISOString()).toBe("2026-06-18T03:00:00.000Z");
      expect(new Date(String(latestStatus[0]?.latest_success_observed_at)).toISOString()).toBe("2026-06-18T00:00:00.000Z");

      const history = await db.execute<{ status: string; error_code: string | null }>(sql`
        SELECT status, error_code
        FROM ingestion_observation_history
        ORDER BY observed_at
      `);
      expect(history.map((row) => row.status)).toEqual(["success", "partial", "failed", "failed"]);

      const recentErrors = await db.execute<{ status: string; error_code: string | null; error_message: string | null }>(sql`
        SELECT status, error_code, error_message
        FROM ingestion_recent_errors
        ORDER BY observed_at
      `);
      expect(recentErrors).toMatchObject([
        { status: "partial", error_code: "missing_ticker", error_message: "Missing JPY ticker for ETH" },
        { status: "failed", error_code: "network_error", error_message: "bitbank API request failed" },
        { status: "failed", error_code: null, error_message: null },
      ]);
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
