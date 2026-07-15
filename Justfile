default:
    @just --choose

setup:
    @mise trust --yes
    @mise install
    @npm ci

psql:
    @docker compose exec -it postgres sh -lc 'psql -U "${POSTGRES_USER:-equinaut}" -d "${POSTGRES_DB:-equinaut}"'

migrate:
    @docker compose --profile tools run --rm migration

ingest source:
    @docker compose exec -T ingestion-worker npm run ingest -- {{source}}

worker-logs:
    @docker compose logs -f ingestion-worker
