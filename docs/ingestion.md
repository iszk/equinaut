# 実データ投入

このプロジェクトは、bitbank / bitFlyer / Saxo から取得した実ポートフォリオデータを PostgreSQL に投入します。MVP では CSV import や手動入力は意図的に対象外です。

## 必要な環境変数

`.env.local` を作成するか、実行環境の process environment として同等の値を設定してください。

```dotenv
DATABASE_URL=postgres://equinaut:***@localhost:5432/equinaut
BITBANK_API_KEY=change-me
BITBANK_API_SECRET=change-me
BITBANK_ACCESS_TIME_WINDOW_MS=1000
INGESTION_HTTP_REQUEST_TIMEOUT_MS=30000
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
INGESTION_HTTP_REQUEST_TIMEOUT_MS=30000
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

## HTTP request timeout

`INGESTION_HTTP_REQUEST_TIMEOUT_MS` は bitbank、bitFlyer、portfolio snapshot の各 HTTP request に適用する application-level timeout です。未指定時は `30000` ms、設定可能な範囲は `1000` から `120000` ms で、decimal integer 以外の値は起動時に拒否します。timeout は request 単位の `AbortSignal` で upstream request を中断するため、bitFlyer の spot / CFD の各 scope や複数 endpoint をまとめて制限する batch timeout ではありません。

timeout は source 固有の retryable な network failure として observation に保存されます。error code / message と metadata は sanitized で、URL、Authorization、credential、raw fetch rejection、abort reason、response body は保存・出力しません。今回 retry loop や backoff は追加していないため、失敗した source は既存の次回 cron slot または明示的な manual retry で再実行します。

Compose worker はこの application default を利用し、今回 `compose.yml.sample` の env、Ofelia labels、schedule、command、worker 構成は変更していません。Ofelia の10分 command-level hard timeout は batch process 全体の最終 watchdog として残ります。hard timeout による process kill は通常の timeout observation の保存を保証しないため、個別 request timeout と同じものとして扱わないでください。

## database migration を適用する

初回投入前、および schema 変更を取り込んだ後に、実 DB に migration を適用してください。

```bash
npm run db:migrate
```

migration command は `drizzle.config.ts` 経由で `DATABASE_URL` を読みます。

## bitbank ingestion を実行する

```bash
npm run ingest -- bitbank
```

成功時は次のような出力になります。

```text
bitbank ingestion succeeded: N holdings collected
```

credentials が不足している場合、command は sanitized configuration message を出して non-zero exit します。secret は出力しません。

## Saxo portfolio ingestion を実行する

Saxo は `SAXO_PORTFOLIO_API_URL` に GET し、`SAXO_PORTFOLIO_API_SECRET` を `Authorization: Bearer ...` として送ります。レスポンスは `portfolio-snapshot.v1` contract に沿った完全 snapshot である必要があります。

```bash
npm run ingest -- saxo
```

成功時は次のような出力になります。

```text
saxo ingestion succeeded: N holdings collected
```

Saxo adapter は `sourceId = saxo`、`scopeId = saxo:portfolio`、`scopeType = portfolio` として保存します。`generatedAt` は observation の `observed_at`、`dataAsOf` は `data_as_of` に反映します。contract 上の mapping 不可、未対応 asset class、schema mismatch は `partial` ではなく source scope 全体を `failed` にします。

## bitFlyer ingestion を実行する

```bash
npm run ingest -- bitflyer
```

bitFlyer ingestion は `bitflyer:spot_account` と `bitflyer:cfd_account` の 2 scope を投入します。現物残高は `cash` / `crypto` として保存し、Crypto CFD は通貨別証拠金を `cash` / `crypto`、`open_position_pnl` を `asset_type = cfd` の synthetic holding として保存します。

成功時は次のような出力になります。

```text
bitflyer ingestion succeeded: N holdings collected (bitflyer:spot_account:success:N, bitflyer:cfd_account:success:N)
```

credentials が不足している場合、command は sanitized configuration message を出して non-zero exit します。secret は出力しません。

## one-shot ingestion の実行 contract

one-shot ingestion は source ごとの PostgreSQL advisory lock を取得してから external API collect と persistence を開始します。同じ database で同一 source がすでに実行中の場合、後から起動した command は待機せず次の warning を stderr に出力します。

```text
bitbank ingestion skipped_overlap: another execution is already running
```

この場合は external API と persistence を実行せず、exit code 0 で終了します。異なる source は異なる lock key を使うため、互いに妨げません。

| 結果 | 出力 | exit code |
| --- | --- | ---: |
| `success` | stdout | 0 |
| `partial` | stderr | 1 |
| `failed` | stderr | 1 |
| `skipped_overlap` | stderr（warning） | 0 |
| 引数不正、予期しない error | stderr | 1 |

result message と最外周 exception は共通 redaction helper を通してから出力します。PostgreSQL URL credential、password / token / API key / API secret、Authorization / Cookie header は未 redaction で出力しません。

## shared Ofelia で定期実行する

定期実行は host-wide shared Ofelia が `compose.yml.sample` の labels を読み取り、resident `ingestion-worker` に `job-exec` します。schedule の source of truth はこの labels だけです。shared Ofelia 自体は equinaut Compose に含めません。

| job | schedule（6-field、秒から開始） | command |
| --- | --- | --- |
| `equinaut-bitbank-ingestion` | 毎時 0 / 15 / 30 / 45 分 | `npm run ingest -- bitbank` |
| `equinaut-bitflyer-ingestion` | 毎時 5 / 20 / 35 / 50 分 | `npm run ingest -- bitflyer` |
| `equinaut-saxo-ingestion` | 毎時 10 / 25 / 40 / 55 分 | `npm run ingest -- saxo` |

各 command は `/usr/bin/timeout` により10分で `TERM` を受け、30秒の kill graceを超えると強制終了します。全jobに `no-overlap=true` を設定しています。Ofeliaの同一job名の重複に加えて、application boundaryのPostgreSQL advisory lockがmanual runや別job名を含む同一sourceの重複を防ぎます。

shared Ofeliaは6-field cronとlabel discoveryに対応する`v0.3.22`を前提とします。Ofeliaをupgradeする場合は、cron field、`job-exec`、`no-overlap`、`--docker-filter`によるtarget discoveryを再検証してください。

### Workerを作成または再作成する

初回起動またはschema変更を含むdeployでは、先に[Migrationを適用する](#migrationを適用する)の停止・migration・起動sequenceを実施してください。schema変更を含まない通常のworker recreateは次の手順です。

```bash
docker compose build ingestion-worker
docker compose up -d postgres ingestion-worker
docker compose ps ingestion-worker
```

`ingestion-worker`は`command: ["sleep", "infinity"]`のexec targetです。containerが`Up`であることはtarget processの生存だけを示し、各ingestion batchの成功を示しません。

Ofeliaは起動時にtarget labelsを読み取るため、workerをcreate / recreateした後はshared Ofelia containerを必ずrestartします。次の変数にはlive環境の実container名を設定してください。

```bash
OFELIA_CONTAINER="<shared-ofelia-container>"
docker restart "${OFELIA_CONTAINER}"
docker logs --since 5m "${OFELIA_CONTAINER}"
```

startup logsで次の3 jobが登録され、discovery errorがないことを確認します。

- `equinaut-bitbank-ingestion`
- `equinaut-bitflyer-ingestion`
- `equinaut-saxo-ingestion`

単純なcontainer restartではなく、workerをcreate / recreateした場合にOfelia restartとregistration確認が必要です。labelsやimageを変更した場合はworkerがrecreateされるため、この手順を省略しないでください。

## 投入結果を確認する

同じ `DATABASE_URL` の database に対して、read-only で次を確認します。workerの`Up`やOfelia上のcommand終了だけでなく、DBへ期待したresultが記録されたことまで確認してください。

```sql
select
  sa.source_id,
  ir.status,
  ir.started_at,
  ir.finished_at,
  ir.error_code
from ingestion_runs ir
join source_accounts sa on sa.id = ir.source_account_id
order by ir.started_at desc
limit 30;

select
  sa.source_id,
  os.scope_id,
  so.status,
  so.observed_at,
  so.error_code,
  so.retryable
from scope_observations so
join observation_scopes os on os.id = so.observation_scope_id
join source_accounts sa on sa.id = os.source_account_id
where so.voided_at is null
order by so.observed_at desc
limit 30;

select
  source_id,
  scope_id,
  latest_observation_status,
  latest_observed_at,
  latest_success_observed_at,
  uses_fallback
from portfolio_scope_freshness
order by latest_observed_at desc;
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

## Cutover / migration / recovery runbook

### Migrationを適用する

runtimeのmigrationは定期jobやworker startupから実行せず、`migration` serviceを明示的に起動します。migrationとingestion persistenceの競合を避けるため、先にworkerを停止します。

```bash
docker compose stop ingestion-worker
docker compose build ingestion-worker
docker compose --profile tools run --rm migration
docker compose up -d ingestion-worker
docker compose ps ingestion-worker
```

migrationが失敗した場合はworkerを停止したまま原因を解消してください。推測によるdown migrationや、削除済みの旧定期実行経路の起動は行いません。worker停止中にcron slotを迎えた場合、Ofeliaのexec failureは保守時間帯のexpected eventとして記録し、復旧後のretryでfreshnessを確認します。

workerを起動した後は[Workerを作成または再作成する](#workerを作成または再作成する)の手順どおりshared Ofeliaをrestartし、3 jobのregistrationを確認します。

### Manual ingestionとretry

deployment環境では、resident worker内でgeneric CLIを実行します。次はbitbankの例です。bitflyer / Saxoもsource引数だけを変更します。

```bash
docker compose exec -T ingestion-worker npm run ingest -- bitbank
```

Justfileを使う場合も同じentrypointを呼びます。

```bash
just ingest bitbank
```

失敗原因を解消してmanual retryした後は、commandのstdout / stderrとexit codeに加えて、上記SQLで新しい`ingestion_runs` / `scope_observations` / freshnessを確認します。manual retryを行わない場合、失敗したsourceは次の15分cron slotで再試行されます。3 sourceは独立したOfelia jobsのため、1 sourceの失敗は他sourceの実行や次回scheduleを止めません。

### Job logsとresultを確認する

`job-exec`したprocessのstdout / stderr、non-zero result、timeoutはshared OfeliaのDocker logsに出ます。`ingestion-worker`のmain processは`sleep infinity`なので、worker logsやcontainerの`Up`だけではbatch resultを判定できません。

```bash
OFELIA_CONTAINER="<shared-ofelia-container>"
docker logs --since 30m "${OFELIA_CONTAINER}"
```

| 状態 | 確認方法 | 対応 |
| --- | --- | --- |
| worker停止 / 未登録 | `docker compose ps ingestion-worker`が非`Up`、またはOfelia logsにexec / discovery error | workerを復旧し、Ofeliaをrestartして3 jobのregistrationを再確認する |
| `success` | CLI exit 0、Ofelia logsに成功message、DBの最新run / scopeが`success` | freshnessの時刻が進んだことを確認する |
| `partial` / `failed` | CLI exit 1、Ofelia logsのsanitized error、DB status / error code | 原因を解消してmanual retryするか、次回cron slotを待つ |
| hard timeout | 通常exit 124、30秒のkill grace超過時は137 | 個別 request timeout の範囲外で残った hung source を調査し、DBに通常の timeout observation が保存されたとは仮定せず、次回cronを監視する |
| Ofelia `no-overlap` | 同一jobの前回実行が継続中で、Ofeliaが次の起動をskip | 前回jobとtimeoutを確認し、次回cron slotを待つ |
| application `skipped_overlap` | stderr warningだがexit 0。lock取得前なので新しいDB runは作られない | 競合中の同一source実行を確認し、次回のfreshness更新まで追跡する |
| workerは`Up`だがdataがstale | DB freshnessが進まず、Ofelia logsに未登録 / failure / timeout / overlap | Ofelia registrationとjob logsを先に確認し、DB resultと突合する |

Ofeliaの`no-overlap`は同一job名だけを対象にします。PostgreSQL advisory lockはmanual commandや異なるjob名からの起動も含め、同じdatabase上の同一sourceを保護します。`skipped_overlap`は意図的にexit 0のため、Ofeliaのsuccess扱いだけで取得成功と判断しないでください。

### Rollbackする

schedule source of truthを二重化しないため、rollback先もgeneric CLI + Ofelia worker方式の直前のknown-good image / commit / labelsに限定します。

1. `ingestion-worker`を停止します。
2. 直前のknown-good image / Compose labelsへ戻してworkerをrecreateします。
3. shared Ofeliaをrestartし、3 jobのregistrationを確認します。
4. generic CLIでmanual ingestionを1 sourceずつ実行します。
5. Ofelia logs、`ingestion_runs`、`scope_observations`、`portfolio_scope_freshness`を確認します。

DB migration後に旧imageとのschema互換性が保証できない場合は、workerを停止したままDB backup restoreまたは互換性を回復するforward fixを選択します。自動down migrationは行いません。削除済みのTypeScript定期実行loop、YAML schedule、worker起動時migrationへは戻しません。

### 誤投入 observation を無効化する

誤った `success` observation が投入された場合も、append-only 方針を維持するため物理削除は行いません。対象の `scope_observations` に `voided_at` を設定すると、`portfolio_latest_assets` / `portfolio_value_timeseries` / `portfolio_asset_allocation` から除外されます。理由を残せる場合は `void_reason` も設定してください。

```sql
update scope_observations
set
  voided_at = now(),
  void_reason = '誤投入データのため無効化'
where id = '<scope_observation_id>';
```
