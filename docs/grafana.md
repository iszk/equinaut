# Grafana PostgreSQL queries

The database exposes dashboard-oriented views so Grafana panels can read portfolio data without repeating application joins.

## Latest assets table

```sql
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
order by value_jpy desc;
```

## Portfolio total time series per source/scope

The current MVP has one bitbank spot-account scope. If multiple scopes are added later, keep `source_id` and `scope_id` in the Grafana series labels because each row is aggregated per successful scope observation.

```sql
select
  observed_at as time,
  source_id,
  scope_id,
  total_value_jpy
from portfolio_value_timeseries
order by observed_at;
```

## Latest asset allocation

```sql
select
  source_id,
  scope_id,
  symbol,
  value_jpy,
  portfolio_weight
from portfolio_asset_allocation
where source_id = 'bitbank'
  and scope_id = 'bitbank:spot_account'
order by value_jpy desc;
```

`portfolio_weight` is a 0-1 ratio. Format it as percent in Grafana. Allocation rows are grouped per `source_id` / `scope_id`, so keep those fields in filters or labels when multiple scopes exist.

## Recommended Grafana database access

Create a read-only PostgreSQL role for Grafana and grant it `SELECT` on these views instead of using the ingestion/application owner role.

```sql
grant usage on schema public to grafana_reader;
grant select on
  portfolio_latest_assets,
  portfolio_value_timeseries,
  portfolio_asset_allocation
to grafana_reader;
```
