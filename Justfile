
default:
    @just --choose

psql:
    @docker compose exec -it postgres psql -U equinaut -d equinaut

migrate:
    @docker compose exec app npm run db:migrate

bitbank:
    @docker compose exec app npm run ingest:bitbank
