select
  coalesce(sum(value_jpy), 0)::numeric(38, 18) as total_value_jpy
from portfolio_latest_assets
where source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring});
