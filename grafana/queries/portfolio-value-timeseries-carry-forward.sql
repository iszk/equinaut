with bounds as (
  select
    date_trunc('hour', ($__timeFrom())::timestamptz) as from_at,
    date_trunc('hour', ($__timeTo())::timestamptz) as to_at
),
buckets as (
  select generate_series(from_at, to_at, interval '1 hour') as bucket_at
  from bounds
),
series as (
  select distinct
    source_id,
    scope_id
  from portfolio_value_timeseries
  where source_id in (${source_id:sqlstring})
    and scope_id in (${scope_id:sqlstring})
)
select
  buckets.bucket_at as "time",
  concat(series.source_id, ' / ', series.scope_id) as metric,
  latest.total_value_jpy
from buckets
cross join series
left join lateral (
  select
    point.total_value_jpy
  from portfolio_value_timeseries point
  where point.source_id = series.source_id
    and point.scope_id = series.scope_id
    and point.observed_at <= buckets.bucket_at
  order by point.observed_at desc, point.scope_observation_id desc
  limit 1
) latest on true
where latest.total_value_jpy is not null
order by buckets.bucket_at, metric;
