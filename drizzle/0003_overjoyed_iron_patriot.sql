CREATE INDEX "scope_observations_latest_idx" ON "scope_observations" USING btree ("observation_scope_id","observed_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE VIEW "ingestion_observation_history" AS
SELECT
  sa.source_id,
  sa.id AS source_account_id,
  os.id AS observation_scope_id,
  os.scope_id,
  os.scope_type,
  so.id AS scope_observation_id,
  so.ingestion_run_id,
  so.status,
  so.observed_at,
  so.data_as_of,
  so.error_code,
  so.raw_error_code,
  so.error_message,
  so.retryable,
  ir.status AS run_status,
  ir.started_at AS run_started_at,
  ir.finished_at AS run_finished_at
FROM "scope_observations" so
JOIN "observation_scopes" os ON os.id = so.observation_scope_id
JOIN "source_accounts" sa ON sa.id = os.source_account_id
JOIN "ingestion_runs" ir ON ir.id = so.ingestion_run_id;
--> statement-breakpoint
CREATE VIEW "ingestion_latest_status" AS
WITH ranked_observations AS (
  SELECT
    so.id,
    row_number() OVER (
      PARTITION BY so.observation_scope_id
      ORDER BY so.observed_at DESC, so.id DESC
    ) AS observation_rank
  FROM "scope_observations" so
), latest_success AS (
  SELECT
    so.observation_scope_id,
    max(so.observed_at) AS latest_success_observed_at
  FROM "scope_observations" so
  WHERE so.status = 'success'
  GROUP BY so.observation_scope_id
)
SELECT
  history.source_id,
  history.source_account_id,
  history.observation_scope_id,
  history.scope_id,
  history.scope_type,
  history.scope_observation_id,
  history.ingestion_run_id,
  history.status,
  history.observed_at,
  latest_success.latest_success_observed_at,
  history.data_as_of,
  history.error_code,
  history.raw_error_code,
  history.error_message,
  history.retryable,
  history.run_status,
  history.run_started_at,
  history.run_finished_at
FROM ranked_observations ranked
JOIN "ingestion_observation_history" history ON history.scope_observation_id = ranked.id
LEFT JOIN latest_success ON latest_success.observation_scope_id = history.observation_scope_id
WHERE ranked.observation_rank = 1;
--> statement-breakpoint
CREATE VIEW "ingestion_recent_errors" AS
SELECT
  source_id,
  source_account_id,
  observation_scope_id,
  scope_id,
  scope_type,
  scope_observation_id,
  ingestion_run_id,
  status,
  observed_at,
  error_code,
  raw_error_code,
  error_message,
  retryable,
  run_status,
  run_started_at,
  run_finished_at
FROM "ingestion_observation_history"
WHERE status IN ('partial', 'failed');
