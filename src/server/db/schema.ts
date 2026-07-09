import { sql } from "drizzle-orm";
import { check, foreignKey, index, jsonb, numeric, pgTable, pgView, text, timestamp, uuid, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const sourceAccounts = pgTable(
  "source_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceStatusCheck: check("source_accounts_status_check", sql`${table.status} in ('active', 'disabled')`),
    sourceIdUnique: uniqueIndex("source_accounts_source_id_unique").on(table.sourceId),
  }),
);

export const observationScopes = pgTable(
  "observation_scopes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceAccountId: uuid("source_account_id").notNull().references(() => sourceAccounts.id),
    scopeId: text("scope_id").notNull(),
    scopeType: text("scope_type").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeStatusCheck: check("observation_scopes_status_check", sql`${table.status} in ('active', 'disabled')`),
    scopeIdIdx: index("observation_scopes_scope_id_idx").on(table.scopeId),
    sourceScopeUnique: uniqueIndex("observation_scopes_source_scope_unique").on(table.sourceAccountId, table.scopeId),
  }),
);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceAccountId: uuid("source_account_id").notNull().references(() => sourceAccounts.id),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    statusCheck: check("ingestion_runs_status_check", sql`${table.status} in ('running', 'success', 'partial', 'failed')`),
    sourceStartedIdx: index("ingestion_runs_source_started_idx").on(table.sourceAccountId, table.startedAt),
  }),
);

export const scopeObservations = pgTable(
  "scope_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ingestionRunId: uuid("ingestion_run_id").notNull().references(() => ingestionRuns.id),
    observationScopeId: uuid("observation_scope_id").notNull().references(() => observationScopes.id),
    status: text("status").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    dataAsOf: timestamp("data_as_of", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    errorCode: text("error_code"),
    rawErrorCode: text("raw_error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    statusCheck: check("scope_observations_status_check", sql`${table.status} in ('success', 'partial', 'failed', 'skipped')`),
    scopeObservedIdx: index("scope_observations_scope_observed_idx").on(table.observationScopeId, table.observedAt),
    idObservedAtUnique: uniqueIndex("scope_observations_id_observed_at_unique").on(table.id, table.observedAt),
    scopeLatestObservationIdx: index("scope_observations_latest_observation_idx")
      .on(table.observationScopeId, table.observedAt.desc(), table.id.desc())
      .where(sql`${table.voidedAt} is null`),
    scopeLatestSuccessIdx: index("scope_observations_latest_success_idx")
      .on(table.observationScopeId, table.observedAt.desc(), table.id.desc())
      .where(sql`${table.status} = 'success' and ${table.voidedAt} is null`),
  }),
);

export const assetSnapshots = pgTable(
  "asset_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeObservationId: uuid("scope_observation_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    assetKey: text("asset_key").notNull(),
    assetType: text("asset_type").notNull(),
    symbol: text("symbol").notNull(),
    name: text("name"),
    quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
    price: numeric("price", { precision: 38, scale: 18 }).notNull(),
    priceCurrency: text("price_currency").notNull(),
    fxToJpy: numeric("fx_to_jpy", { precision: 38, scale: 18 }).notNull(),
    valueJpy: numeric("value_jpy", { precision: 38, scale: 18 }).notNull(),
    raw: jsonb("raw"),
  },
  (table) => ({
    assetTypeCheck: check("asset_snapshots_asset_type_check", sql`${table.assetType} in ('cash', 'crypto', 'stock', 'fund', 'cfd')`),
    scopeObservationObservedAtFk: foreignKey({
      columns: [table.scopeObservationId, table.observedAt],
      foreignColumns: [scopeObservations.id, scopeObservations.observedAt],
      name: "asset_snapshots_scope_observation_observed_at_fk",
    }),
    observationAssetIdx: index("asset_snapshots_observation_asset_idx").on(table.scopeObservationId, table.assetKey),
    observationObservedIdx: index("asset_snapshots_observation_observed_idx").on(table.scopeObservationId, table.observedAt),
    observedIdx: index("asset_snapshots_observed_idx").on(table.observedAt.desc()),
    assetObservedIdx: index("asset_snapshots_asset_observed_idx").on(table.assetKey, table.observedAt.desc()),
  }),
);

export const portfolioLatestAssets = pgView("portfolio_latest_assets", {
  sourceId: text("source_id").notNull(),
  sourceAccountId: uuid("source_account_id").notNull(),
  observationScopeId: uuid("observation_scope_id").notNull(),
  scopeId: text("scope_id").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeObservationId: uuid("scope_observation_id").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  assetKey: text("asset_key").notNull(),
  assetType: text("asset_type").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name"),
  quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull(),
  price: numeric("price", { precision: 38, scale: 18 }).notNull(),
  priceCurrency: text("price_currency").notNull(),
  fxToJpy: numeric("fx_to_jpy", { precision: 38, scale: 18 }).notNull(),
  valueJpy: numeric("value_jpy", { precision: 38, scale: 18 }).notNull(),
}).existing();

export const portfolioValueTimeseries = pgView("portfolio_value_timeseries", {
  sourceId: text("source_id").notNull(),
  sourceAccountId: uuid("source_account_id").notNull(),
  observationScopeId: uuid("observation_scope_id").notNull(),
  scopeId: text("scope_id").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeObservationId: uuid("scope_observation_id").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  totalValueJpy: numeric("total_value_jpy", { precision: 38, scale: 18 }).notNull(),
}).existing();

export const portfolioAssetAllocation = pgView("portfolio_asset_allocation", {
  sourceId: text("source_id").notNull(),
  sourceAccountId: uuid("source_account_id").notNull(),
  observationScopeId: uuid("observation_scope_id").notNull(),
  scopeId: text("scope_id").notNull(),
  scopeType: text("scope_type").notNull(),
  assetKey: text("asset_key").notNull(),
  assetType: text("asset_type").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name"),
  valueJpy: numeric("value_jpy", { precision: 38, scale: 18 }).notNull(),
  portfolioWeight: numeric("portfolio_weight", { precision: 38, scale: 18 }).notNull(),
}).existing();

export const portfolioScopeFreshness = pgView("portfolio_scope_freshness", {
  sourceId: text("source_id").notNull(),
  sourceAccountId: uuid("source_account_id").notNull(),
  observationScopeId: uuid("observation_scope_id").notNull(),
  scopeId: text("scope_id").notNull(),
  scopeType: text("scope_type").notNull(),
  latestScopeObservationId: uuid("latest_scope_observation_id").notNull(),
  latestObservationStatus: text("latest_observation_status").notNull(),
  latestObservedAt: timestamp("latest_observed_at", { withTimezone: true }).notNull(),
  latestDataAsOf: timestamp("latest_data_as_of", { withTimezone: true }),
  latestErrorCode: text("latest_error_code"),
  latestRawErrorCode: text("latest_raw_error_code"),
  latestRetryable: boolean("latest_retryable"),
  latestSuccessScopeObservationId: uuid("latest_success_scope_observation_id"),
  latestSuccessObservedAt: timestamp("latest_success_observed_at", { withTimezone: true }),
  latestSuccessDataAsOf: timestamp("latest_success_data_as_of", { withTimezone: true }),
  isLatestSuccess: boolean("is_latest_success").notNull(),
  usesFallback: boolean("uses_fallback").notNull(),
}).existing();
