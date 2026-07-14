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
npm run ingest -- bitbank
npm run ingest -- bitflyer
npm run ingest -- saxo
```

必要な環境変数、file-mounted secret 方式、verification SQL は [docs/ingestion.md](docs/ingestion.md) を参照してください。

one-shot ingestion は source ID を引数に取る共通 entrypoint から実行します。

```bash
npm run ingest -- <bitbank|bitflyer|saxo>
```

必要な credentials がない場合は sanitized configuration message を出力して non-zero exit します。同じ source が実行中の場合は `skipped_overlap` warning を出力し、API / persistence を実行せず exit code 0 で終了します。
