# 実データ投入

このプロジェクトは、bitbank / bitFlyer / Saxo から取得した実ポートフォリオデータを PostgreSQL に投入します。MVP では CSV import や手動入力は意図的に対象外です。

## 必要な環境変数

`.env.local` を作成するか、実行環境の process environment として同等の値を設定してください。

```dotenv
DATABASE_URL=postgres://equinaut:***@localhost:5432/equinaut
BITBANK_API_KEY=change-me
BITBANK_API_SECRET=change-me
BITBANK_ACCESS_TIME_WINDOW_MS=1000
BITFLYER_API_KEY=change-me
BITFLYER_API_SECRET=change-me
SAXO_PORTFOLIO_API_URL=https://portfolio.example/saxo
SAXO_PORTFOLIO_API_SECRET=change-me
```

Docker や secret mount を使う環境では、file-based secret 方式を推奨します。

```dotenv
DATABASE_URL=postgres://equinaut:***@postgres:5432/equinaut
BITBANK_API_KEY_FILE=/run/secrets/bitbank_api_key
BITBANK_API_SECRET_FILE=/run/secrets/bitbank_api_secret
BITBANK_ACCESS_TIME_WINDOW_MS=1000
BITFLYER_API_KEY_FILE=/run/secrets/bitflyer_api_key
BITFLYER_API_SECRET_FILE=/run/secrets/bitflyer_api_secret
SAXO_PORTFOLIO_API_URL=https://portfolio.example/saxo
SAXO_PORTFOLIO_API_SECRET_FILE=/run/secrets/saxo_portfolio_api_secret
```

補足:

- `DATABASE_URL` は実データ投入と Grafana 向け view の参照先です。
- `TEST_DATABASE_URL` は integration test 専用です。実資産データには使わないでください。
- `.env.local` は Git 管理対象外です。`.env` より先に読み込まれますが、すでに設定済みの process environment は上書きしません。
- `BITBANK_API_KEY_FILE` / `BITBANK_API_SECRET_FILE` / `BITFLYER_API_KEY_FILE` / `BITFLYER_API_SECRET_FILE` が設定されている場合、application はまず file contents を読みます。file が空、または読めない場合のみ plain env value に fallback します。
- `SAXO_PORTFOLIO_API_SECRET_FILE` が設定されている場合、application はまず file contents を読みます。file が空、または読めない場合のみ `SAXO_PORTFOLIO_API_SECRET` に fallback します。

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

## Saxo portfolio ingestion を実行する

Saxo は `SAXO_PORTFOLIO_API_URL` に GET し、`SAXO_PORTFOLIO_API_SECRET` を `Authorization: Bearer ...` として送ります。レスポンスは `portfolio-snapshot.v1` contract に沿った完全 snapshot である必要があります。

```bash
npm run ingest:saxo
```

成功時は次のような出力になります。

```text
saxo ingestion succeeded: N holdings collected
```

Saxo adapter は `sourceId = saxo`、`scopeId = saxo:portfolio`、`scopeType = portfolio` として保存します。`generatedAt` は observation の `observed_at`、`dataAsOf` は `data_as_of` に反映します。contract 上の mapping 不可、未対応 asset class、schema mismatch は `partial` ではなく source scope 全体を `failed` にします。

## bitFlyer ingestion を実行する

```bash
npx tsx scripts/ingest.ts bitflyer
```

bitFlyer ingestion は `bitflyer:spot_account` と `bitflyer:cfd_account` の 2 scope を投入します。現物残高は `cash` / `crypto` として保存し、Crypto CFD は通貨別証拠金を `cash` / `crypto`、`open_position_pnl` を `asset_type = cfd` の synthetic holding として保存します。

成功時は次のような出力になります。

```text
bitflyer ingestion succeeded: N holdings collected (bitflyer:spot_account:success:N, bitflyer:cfd_account:success:N)
```

credentials が不足している場合、command は sanitized configuration message を出して non-zero exit します。secret は出力しません。

## scheduler で定期実行する

scheduler は YAML 設定ファイルで enabled source と実行間隔を管理します。API key / API secret / `DATABASE_URL` などの secret は設定ファイルには入れず、`.env` または Docker secrets で設定してください。

```bash
cp config/ingestion.example.yaml config/ingestion.yaml
npm run ingest:scheduler -- --config config/ingestion.yaml
```

Docker Compose で動かす場合は、`config/ingestion.yaml` を作成してから scheduler service を起動します。scheduler は Docker image として build され、image 起動時に `npm run db:migrate` を実行してから scheduler loop を開始します。source code 全体は bind mount せず、`config/` directory のみ read-only で mount します。

```bash
docker compose build scheduler
docker compose up -d postgres app scheduler
docker compose logs -f scheduler
```

設定例:

```yaml
scheduler:
  runOnStart: true
  defaultIntervalSeconds: 900
  minIntervalSeconds: 60

sources:
  - id: bitbank
    enabled: true
    intervalSeconds: 900
  - id: bitflyer
    enabled: false
    intervalSeconds: 900
  - id: saxo
    enabled: false
    intervalSeconds: 900
```

- `runOnStart` が `true` の場合、起動直後に enabled source を一度実行します。
- `intervalSeconds` を省略した source は `defaultIntervalSeconds` を使います。
- 現在対応している source id は `bitbank` / `bitflyer` / `saxo` です。
- source の実行に失敗しても scheduler process は継続し、次回 interval で再実行します。
- Docker Compose の scheduler は 1 replica 前提です。複数 replica で同時起動すると、起動時 migration が競合する可能性があります。将来 scale する場合は migration 専用 service への分離を検討してください。

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

select *
from portfolio_scope_freshness
order by latest_observed_at desc;
```

`portfolio_asset_allocation` は `source_id` / `scope_id` 単位で scoped されています。複数 scope を扱う場合は、Grafana の filter または label にこれらの field を含めてください。

## asset snapshot の評価額 semantics

`asset_snapshots.asset_type` は厳密な金融商品 taxonomy ではなく、dashboard 上で合算・allocation 表示するための valuation category です。許可値は `cash` / `crypto` / `stock` / `fund` / `cfd` です。

`value_jpy` は dashboard の総資産・allocation に加算する JPY 評価額です。notional / exposure / contract value を機械的に表すものではありません。

`quantity` / `price` / `price_currency` / `fx_to_jpy` は原則として `value_jpy` の説明に使える valuation inputs です。ただし、すべての `asset_type` で `quantity * price * fx_to_jpy = value_jpy` が成り立つことは要求しません。

`raw` には source が返した元の price / currency / quantity / notional / metadata を保存します。API key、Authorization header、Cookie などの secret は保存しません。

`asset_type` 別の意味は次の通りです。

| asset_type | value_jpy の意味 |
| --- | --- |
| `cash` | JPY 換算後の現金残高 |
| `crypto` / `stock` / `fund` | market value。原則として price 等から概ね説明可能な評価額 |
| `cfd` | 総資産に加算してよい equity contribution または unrealized PnL component。notional / exposure ではない |

CFD では notional / exposure を asset snapshot の `value_jpy` に保存しません。source price / source quantity / notional が必要な場合は `raw` に保持し、総資産に加算してよい評価額または評価損益コンポーネントだけを `asset_type = cfd` として保存します。

## 運用手順

1. 最新 migration を含む code を deploy します。
2. 対象環境に `DATABASE_URL` と有効化する source の credentials を設定します。
3. Docker Compose の scheduler service では、起動時に `npm run db:migrate` が実行されます。手動運用の場合は scheduler / ingestion 起動前に `npm run db:migrate` を実行してください。
4. 対象 source の ingestion を手動、または scheduler から実行します。
5. dashboard views が rows を返すことを確認します。
6. Grafana には同じ database を read-only role で参照させます。

### 誤投入 observation を無効化する

誤った `success` observation が投入された場合も、append-only 方針を維持するため物理削除は行いません。対象の `scope_observations` に `voided_at` を設定すると、`portfolio_latest_assets` / `portfolio_value_timeseries` / `portfolio_asset_allocation` から除外されます。理由を残せる場合は `void_reason` も設定してください。

```sql
update scope_observations
set
  voided_at = now(),
  void_reason = '誤投入データのため無効化'
where id = '<scope_observation_id>';
```
