# equinaut

Personal financial asset dashboard.

## Current MVP direction

- Sources: bitbank spot, bitFlyer spot / Crypto CFD, Saxo portfolio snapshot API
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

`.env.local` または deployment environment に `DATABASE_URL` と対象 source の credentials を設定し、migration を適用してから ingestion を実行します。

```bash
npm run db:migrate
npm run ingest:bitbank
npm run ingest:saxo
```

必要な環境変数、file-mounted secret 方式、verification SQL は [docs/ingestion.md](docs/ingestion.md) を参照してください。

Manual ingestion entrypoints:

```bash
npm run ingest:bitbank
npm run ingest:saxo
```

Manual bitFlyer ingestion entrypoint:

```bash
npx tsx scripts/ingest.ts bitflyer
```

Without required credentials, the command exits non-zero with a sanitized configuration message.
