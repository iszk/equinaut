select
  observed_at,
  source_id,
  scope_id,
  status,
  error_code,
  error_message,
  retryable,
  run_status,
  run_started_at,
  run_finished_at
from ingestion_observation_history
where $__timeFilter(observed_at)
  and source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
order by observed_at desc
limit 200;
