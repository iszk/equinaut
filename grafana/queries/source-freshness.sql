select
  source_id,
  scope_id,
  max(observed_at) as latest_observed_at
from portfolio_latest_assets
where source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
group by source_id, scope_id
order by latest_observed_at desc;
