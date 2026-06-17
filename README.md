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

Manual bitbank ingestion entrypoint:

```bash
npm run ingest:bitbank
```

Without bitbank credentials, the command exits non-zero with a sanitized configuration message.
