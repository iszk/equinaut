# Real data ingestion

This project ingests real portfolio data from bitbank into PostgreSQL. CSV import and manual entry are intentionally out of scope for the MVP.

## Required environment

Create `.env.local` or provide equivalent process environment variables in the runtime environment.

```dotenv
DATABASE_URL=postgres://equinaut:change-me@localhost:5432/equinaut
BITBANK_API_KEY=change-me
BITBANK_API_SECRET=change-me
BITBANK_ACCESS_TIME_WINDOW_MS=1000
```

For Docker or secret-mounted deployments, prefer file-based secrets:

```dotenv
DATABASE_URL=postgres://equinaut:change-me@postgres:5432/equinaut
BITBANK_API_KEY_FILE=/run/secrets/bitbank_api_key
BITBANK_API_SECRET_FILE=/run/secrets/bitbank_api_secret
BITBANK_ACCESS_TIME_WINDOW_MS=1000
```

Notes:

- `DATABASE_URL` is for real ingestion and Grafana-facing views.
- `TEST_DATABASE_URL` is only for integration tests and must not be used for real asset data.
- `.env.local` is ignored by Git and is loaded before `.env` without overriding already-set process environment variables.
- If `BITBANK_API_KEY_FILE` or `BITBANK_API_SECRET_FILE` is set, the application reads the file contents first and falls back to the plain env value only if the file is empty or unreadable.

## Apply database migrations

Run migrations against the real database before the first ingestion and after pulling schema changes:

```bash
npm run db:migrate
```

The migration command reads `DATABASE_URL` through `drizzle.config.ts`.

## Run bitbank ingestion

```bash
npm run ingest:bitbank
```

Expected success shape:

```text
bitbank ingestion succeeded: N holdings collected
```

If credentials are missing, the command exits non-zero with a sanitized configuration message and does not print secrets.

## Verify inserted data

Run read-only checks against the same `DATABASE_URL` database:

```sql
select count(*) from source_accounts;
select count(*) from observation_scopes;
select count(*) from scope_observations;
select count(*) from asset_snapshots;
```

Grafana-facing views:

```sql
select *
from portfolio_latest_assets
order by value_jpy desc;

select *
from portfolio_value_timeseries
order by observed_at desc;

select *
from portfolio_asset_allocation
order by value_jpy desc;
```

`portfolio_asset_allocation` is scoped by `source_id` / `scope_id`; include those fields in Grafana filters or labels when multiple scopes exist.

## Operational flow

1. Deploy code containing the latest migrations.
2. Configure `DATABASE_URL` and bitbank credentials in the target environment.
3. Run `npm run db:migrate` once per deployment/schema update.
4. Run `npm run ingest:bitbank` manually or from a scheduler.
5. Confirm the dashboard views return rows.
6. Point Grafana at the same database with a read-only role.
