with allocation_buckets as (
  select
    case
      when scope_type = 'cfd_account' then 'CFD'
      else symbol
    end as symbol,
    sum(value_jpy) as value_jpy,
    source_id,
    scope_id
  from portfolio_asset_allocation
  where source_id in (${source_id:sqlstring})
    and scope_id in (${scope_id:sqlstring})
  group by
    source_id,
    scope_id,
    case
      when scope_type = 'cfd_account' then 'CFD'
      else symbol
    end
),
positive_buckets as (
  select *
  from allocation_buckets
  where value_jpy > 0
)
select
  symbol,
  value_jpy,
  case
    when sum(value_jpy) over () = 0 then 0
    else value_jpy / sum(value_jpy) over ()
  end as portfolio_weight,
  source_id,
  scope_id
from positive_buckets
order by value_jpy desc;
