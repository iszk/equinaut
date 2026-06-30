select
  source_id,
  scope_id,
  latest_observation_status,
  latest_observed_at,
  latest_success_observed_at,
  is_latest_success,
  uses_fallback,
  latest_error_code,
  latest_retryable
from portfolio_scope_freshness
where source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
order by latest_observed_at desc;
