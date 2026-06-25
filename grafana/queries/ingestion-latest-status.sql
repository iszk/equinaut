select
  source_id,
  scope_id,
  status,
  observed_at,
  latest_success_observed_at,
  error_code,
  raw_error_code,
  error_message,
  retryable,
  run_status,
  run_started_at,
  run_finished_at
from ingestion_latest_status
where source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
order by source_id, scope_id;
