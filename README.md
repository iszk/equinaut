# equinaut

Personal financial asset dashboard.

## Current MVP direction

- Initial source: bitbank only
- Input: scraper/API automatic ingestion only; no CSV import or manual entry
- Database: PostgreSQL
- Language: TypeScript strict mode

## Development

```bash
npm install
npm test
npm run typecheck
npm run db:generate
```

## Real data ingestion

Configure `DATABASE_URL` and bitbank credentials in `.env.local` or the deployment environment, apply migrations, then run ingestion:

```bash
npm run db:migrate
npm run ingest:bitbank
```

See [docs/ingestion.md](docs/ingestion.md) for required environment variables, file-mounted secret options, and verification SQL.

Manual bitbank ingestion entrypoint:

```bash
npm run ingest:bitbank
```

Without bitbank credentials, the command exits non-zero with a sanitized configuration message.
