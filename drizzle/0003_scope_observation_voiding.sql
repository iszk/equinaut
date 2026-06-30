ALTER TABLE "scope_observations" ADD COLUMN "voided_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "scope_observations" ADD COLUMN "void_reason" text;
--> statement-breakpoint
DROP VIEW "portfolio_asset_allocation";
--> statement-breakpoint
DROP VIEW "portfolio_value_timeseries";
--> statement-breakpoint
DROP VIEW "portfolio_latest_assets";
--> statement-breakpoint
DROP INDEX "scope_observations_latest_success_idx";
--> statement-breakpoint
CREATE INDEX "scope_observations_latest_success_idx" ON "scope_observations" USING btree ("observation_scope_id","observed_at" DESC,"id" DESC) WHERE "status" = 'success' AND "voided_at" IS NULL;
--> statement-breakpoint
CREATE VIEW "portfolio_latest_assets" AS
WITH ranked_observations AS (
  SELECT
    so.id,
    so.observation_scope_id,
    so.observed_at,
    row_number() OVER (
      PARTITION BY so.observation_scope_id
      ORDER BY so.observed_at DESC, so.id DESC
    ) AS observation_rank
  FROM "scope_observations" so
  WHERE so.status = 'success'
    AND so.voided_at IS NULL
)
SELECT
  sa.source_id,
  sa.id AS source_account_id,
  os.id AS observation_scope_id,
  os.scope_id,
  os.scope_type,
  ro.id AS scope_observation_id,
  ro.observed_at,
  asset.asset_key,
  asset.asset_type,
  asset.symbol,
  asset.name,
  asset.quantity,
  asset.price,
  asset.price_currency,
  asset.fx_to_jpy,
  asset.value_jpy
FROM ranked_observations ro
JOIN "observation_scopes" os ON os.id = ro.observation_scope_id
JOIN "source_accounts" sa ON sa.id = os.source_account_id
JOIN "asset_snapshots" asset ON asset.scope_observation_id = ro.id
WHERE ro.observation_rank = 1;
--> statement-breakpoint
CREATE VIEW "portfolio_value_timeseries" AS
SELECT
  sa.source_id,
  sa.id AS source_account_id,
  os.id AS observation_scope_id,
  os.scope_id,
  os.scope_type,
  so.id AS scope_observation_id,
  so.observed_at,
  sum(asset.value_jpy)::numeric(38, 18) AS total_value_jpy
FROM "scope_observations" so
JOIN "observation_scopes" os ON os.id = so.observation_scope_id
JOIN "source_accounts" sa ON sa.id = os.source_account_id
JOIN "asset_snapshots" asset ON asset.scope_observation_id = so.id
WHERE so.status = 'success'
  AND so.voided_at IS NULL
GROUP BY
  sa.source_id,
  sa.id,
  os.id,
  os.scope_id,
  os.scope_type,
  so.id,
  so.observed_at;
--> statement-breakpoint
CREATE VIEW "portfolio_asset_allocation" AS
WITH asset_totals AS (
  SELECT
    source_id,
    source_account_id,
    observation_scope_id,
    scope_id,
    scope_type,
    asset_key,
    asset_type,
    symbol,
    name,
    sum(value_jpy)::numeric(38, 18) AS value_jpy
  FROM "portfolio_latest_assets"
  GROUP BY
    source_id,
    source_account_id,
    observation_scope_id,
    scope_id,
    scope_type,
    asset_key,
    asset_type,
    symbol,
    name
), portfolio_totals AS (
  SELECT
    source_account_id,
    observation_scope_id,
    sum(value_jpy)::numeric(38, 18) AS value_jpy
  FROM asset_totals
  GROUP BY source_account_id, observation_scope_id
)
SELECT
  asset_totals.source_id,
  asset_totals.source_account_id,
  asset_totals.observation_scope_id,
  asset_totals.scope_id,
  asset_totals.scope_type,
  asset_totals.asset_key,
  asset_totals.asset_type,
  asset_totals.symbol,
  asset_totals.name,
  asset_totals.value_jpy,
  CASE
    WHEN portfolio_totals.value_jpy = 0 THEN 0::numeric(38, 18)
    ELSE (asset_totals.value_jpy / portfolio_totals.value_jpy)::numeric(38, 18)
  END AS portfolio_weight
FROM asset_totals
JOIN portfolio_totals
  ON portfolio_totals.source_account_id = asset_totals.source_account_id
  AND portfolio_totals.observation_scope_id = asset_totals.observation_scope_id;
