select
  observed_at,
  source_id,
  scope_id,
  asset_type,
  symbol,
  quantity,
  price,
  price_currency,
  value_jpy
from portfolio_latest_assets
where source_id in (${source_id:sqlstring})
  and scope_id in (${scope_id:sqlstring})
order by value_jpy desc;
