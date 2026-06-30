select
  $__timeGroupAlias(observed_at, $__interval),
  concat(source_id, ' / ', scope_id, ' / ', status) as metric,
  count(*) as observation_count
from ingestion_observation_history
where $__timeFilter(observed_at)
  and source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
group by 1, 2
order by 1;
