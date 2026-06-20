default:
    @just --choose

psql:
    @docker compose exec -it postgres sh -lc 'psql -U "${POSTGRES_USER:-equinaut}" -d "${POSTGRES_DB:-equinaut}"'

migrate:
    @docker compose exec app npm run db:migrate

bitbank:
    @docker compose exec app npm run ingest:bitbank

scheduler-logs:
    @docker compose logs -f scheduler
