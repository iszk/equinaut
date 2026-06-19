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

## 実データ投入

`.env.local` または deployment environment に `DATABASE_URL` と bitbank credentials を設定し、migration を適用してから ingestion を実行します。

```bash
npm run db:migrate
npm run ingest:bitbank
```

必要な環境変数、file-mounted secret 方式、verification SQL は [docs/ingestion.md](docs/ingestion.md) を参照してください。

Manual bitbank ingestion entrypoint:

```bash
npm run ingest:bitbank
```

Without bitbank credentials, the command exits non-zero with a sanitized configuration message.
