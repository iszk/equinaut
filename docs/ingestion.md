# 実データ投入

このプロジェクトは、bitbank から取得した実ポートフォリオデータを PostgreSQL に投入します。MVP では CSV import や手動入力は意図的に対象外です。

## 必要な環境変数

`.env.local` を作成するか、実行環境の process environment として同等の値を設定してください。

```dotenv
DATABASE_URL=postgres://equinaut:***@localhost:5432/equinaut
BITBANK_API_KEY=change-me
BITBANK_API_SECRET=change-me
BITBANK_ACCESS_TIME_WINDOW_MS=1000
```

Docker や secret mount を使う環境では、file-based secret 方式を推奨します。

```dotenv
DATABASE_URL=postgres://equinaut:***@postgres:5432/equinaut
BITBANK_API_KEY_FILE=/run/secrets/bitbank_api_key
BITBANK_API_SECRET_FILE=/run/secrets/bitbank_api_secret
BITBANK_ACCESS_TIME_WINDOW_MS=1000
```

補足:

- `DATABASE_URL` は実データ投入と Grafana 向け view の参照先です。
- `TEST_DATABASE_URL` は integration test 専用です。実資産データには使わないでください。
- `.env.local` は Git 管理対象外です。`.env` より先に読み込まれますが、すでに設定済みの process environment は上書きしません。
- `BITBANK_API_KEY_FILE` または `BITBANK_API_SECRET_FILE` が設定されている場合、application はまず file contents を読みます。file が空、または読めない場合のみ plain env value に fallback します。

## database migration を適用する

初回投入前、および schema 変更を取り込んだ後に、実 DB に migration を適用してください。

```bash
npm run db:migrate
```

migration command は `drizzle.config.ts` 経由で `DATABASE_URL` を読みます。

## bitbank ingestion を実行する

```bash
npm run ingest:bitbank
```

成功時は次のような出力になります。

```text
bitbank ingestion succeeded: N holdings collected
```

credentials が不足している場合、command は sanitized configuration message を出して non-zero exit します。secret は出力しません。

## 投入結果を確認する

同じ `DATABASE_URL` の database に対して、read-only で次を確認します。

```sql
select count(*) from source_accounts;
select count(*) from observation_scopes;
select count(*) from scope_observations;
select count(*) from asset_snapshots;
```

Grafana 向け view:

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

`portfolio_asset_allocation` は `source_id` / `scope_id` 単位で scoped されています。複数 scope を扱う場合は、Grafana の filter または label にこれらの field を含めてください。

## 運用手順

1. 最新 migration を含む code を deploy します。
2. 対象環境に `DATABASE_URL` と bitbank credentials を設定します。
3. deploy / schema update ごとに `npm run db:migrate` を実行します。
4. `npm run ingest:bitbank` を手動、または scheduler から実行します。
5. dashboard views が rows を返すことを確認します。
6. Grafana には同じ database を read-only role で参照させます。
