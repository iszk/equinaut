CREATE INDEX "scope_observations_latest_observation_idx" ON "scope_observations" USING btree ("observation_scope_id","observed_at" DESC,"id" DESC) WHERE "voided_at" IS NULL;
--> statement-breakpoint
CREATE VIEW "portfolio_scope_freshness" AS
WITH latest_observations AS (
  SELECT
    so.id,
    so.observation_scope_id,
    so.status,
    so.observed_at,
    so.data_as_of,
    so.error_code,
    so.raw_error_code,
    so.retryable,
    row_number() OVER (
      PARTITION BY so.observation_scope_id
      ORDER BY so.observed_at DESC, so.id DESC
    ) AS observation_rank
  FROM "scope_observations" so
  WHERE so.voided_at IS NULL
), latest_success_observations AS (
  SELECT
    so.id,
    so.observation_scope_id,
    so.observed_at,
    so.data_as_of,
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
  latest.id AS latest_scope_observation_id,
  latest.status AS latest_observation_status,
  latest.observed_at AS latest_observed_at,
  latest.data_as_of AS latest_data_as_of,
  latest.error_code AS latest_error_code,
  latest.raw_error_code AS latest_raw_error_code,
  latest.retryable AS latest_retryable,
  latest_success.id AS latest_success_scope_observation_id,
  latest_success.observed_at AS latest_success_observed_at,
  latest_success.data_as_of AS latest_success_data_as_of,
  (latest.status = 'success') AS is_latest_success,
  (latest.status <> 'success' AND latest_success.id IS NOT NULL) AS uses_fallback
FROM latest_observations latest
JOIN "observation_scopes" os ON os.id = latest.observation_scope_id
JOIN "source_accounts" sa ON sa.id = os.source_account_id
LEFT JOIN latest_success_observations latest_success
  ON latest_success.observation_scope_id = latest.observation_scope_id
  AND latest_success.observation_rank = 1
WHERE latest.observation_rank = 1;
