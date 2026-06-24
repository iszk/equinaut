select
  observed_at as "time",
  concat(source_id, ' / ', scope_id) as metric,
  total_value_jpy
from portfolio_value_timeseries
where $__timeFilter(observed_at)
  and source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
order by observed_at;
