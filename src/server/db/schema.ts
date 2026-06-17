import { sql } from "drizzle-orm";
import { check, index, jsonb, numeric, pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";

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
    errorCode: text("error_code"),
    rawErrorCode: text("raw_error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    statusCheck: check("scope_observations_status_check", sql`${table.status} in ('success', 'partial', 'failed', 'skipped')`),
    scopeObservedIdx: index("scope_observations_scope_observed_idx").on(table.observationScopeId, table.observedAt),
  }),
);

export const assetSnapshots = pgTable(
  "asset_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scopeObservationId: uuid("scope_observation_id").notNull().references(() => scopeObservations.id),
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
    assetTypeCheck: check("asset_snapshots_asset_type_check", sql`${table.assetType} in ('cash', 'crypto', 'stock', 'fund')`),
    observationAssetIdx: index("asset_snapshots_observation_asset_idx").on(table.scopeObservationId, table.assetKey),
  }),
);
