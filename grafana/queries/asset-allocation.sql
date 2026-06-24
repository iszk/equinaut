select
  symbol,
  value_jpy,
  portfolio_weight,
  source_id,
  scope_id
from portfolio_asset_allocation
where source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
order by value_jpy desc;
