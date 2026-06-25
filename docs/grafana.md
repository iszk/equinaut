# Grafana dashboard

## 方針

この repository では Grafana 本体を立てません。homelab などで既に動いている Grafana に、equinaut 用の PostgreSQL datasource と dashboard を同居させる前提です。

追加する成果物は次の通りです。

- `grafana/dashboards/portfolio-overview.json`: portfolio overview 用の import 可能な dashboard JSON
- `grafana/dashboards/ingestion-health.json`: ingestion health / run history 用の import 可能な dashboard JSON
- `grafana/queries/*.sql`: dashboard panel で使う SQL
- `grafana/provisioning/datasources/equinaut-postgres.example.yaml`: datasource provisioning 例
- `grafana/provisioning/dashboards/equinaut.example.yaml`: dashboard provisioning 例

## 前提

- equinaut の PostgreSQL に read-only user `reader` が作成済みであること
- Grafana から equinaut PostgreSQL に network 到達できること
- migration 適用済みで、次の view が存在すること
  - `portfolio_latest_assets`
  - `portfolio_value_timeseries`
  - `portfolio_asset_allocation`
  - `ingestion_observation_history`
  - `ingestion_latest_status`
  - `ingestion_recent_errors`

`portfolio_latest_allocation` という view は存在しません。

## Datasource

Grafana 側で PostgreSQL datasource を作成します。dashboard JSON は default datasource UID として `equinaut-postgres` を参照するため、既存 Grafana 側の datasource UID もこの値に合わせると import 後すぐ使えます。

| 設定 | 値 |
| --- | --- |
| Type | PostgreSQL |
| Name | `Equinaut PostgreSQL` |
| UID | `equinaut-postgres` |
| Host | Grafana から到達できる equinaut PostgreSQL host / port |
| Database | equinaut の database 名 |
| User | `reader` |
| Password | `reader` user の password |
| TLS / SSL Mode | 環境に合わせる。local network では `disable` でも可 |

provisioning で管理する場合は、`grafana/provisioning/datasources/equinaut-postgres.example.yaml` を既存 Grafana の provisioning path に合わせてコピーし、password は環境変数などの secret 管理に寄せてください。Grafana の provisioning では環境変数展開が行われるため、password に `$` を含む場合は Grafana の公式仕様に従って escape してください。

## Dashboard import

Grafana UI から import する場合:

1. Grafana 側に UID `equinaut-postgres` の PostgreSQL datasource を作成しておきます。
2. Grafana の `Dashboards` → `New` → `Import` を開きます。
3. `grafana/dashboards/portfolio-overview.json` または `grafana/dashboards/ingestion-health.json` を upload します。
4. Folder は `Equinaut` など、既存 dashboard と分離できる場所を選びます。
5. 初回表示が空の場合は、dashboard 上部の `Source` / `Scope` variable を実データに合わせて選び直してください。

provisioning で管理する場合は、dashboard JSON を既存 Grafana の dashboard provisioning path に配置し、`grafana/provisioning/dashboards/equinaut.example.yaml` を環境に合わせて調整してください。

## Panels

### Portfolio overview

#### 最新ポートフォリオ評価額

`portfolio_latest_assets` から、選択中 source / scope の最新 successful observation に含まれる `value_jpy` を合計して表示します。

#### ポートフォリオ評価額の推移

`portfolio_value_timeseries` を time series として表示します。複数 source / scope を扱う場合に備えて、series label は `source_id / scope_id` です。

#### 資産配分

`portfolio_asset_allocation` を pie chart として表示します。`portfolio_weight` は 0-1 ratio なので、Grafana では percent unit で表示します。

#### 最新保有資産

`portfolio_latest_assets` を table として表示します。`quantity`, `price`, `value_jpy`, `observed_at` を確認できます。

#### 最新 successful observation

`portfolio_latest_assets` から、source / scope ごとの最新 successful observation に紐づく asset snapshot 時刻を表示します。現行 view だけを使うため、asset snapshot がない observation はこの panel には出ません。

### Ingestion health

#### 最新 ingestion status

`ingestion_latest_status` から、source / scope ごとの最新 observation status を表示します。`success`, `partial`, `failed`, `skipped` の状態、error code、retryable、最後に成功した時刻を確認できます。

#### status 件数推移

`ingestion_observation_history` を time series として表示します。Grafana の `$__timeGroupAlias` / `$__interval` で bucket 化し、status ごとの発生件数を見るための panel です。portfolio value には使いません。

#### recent partial / failed

`ingestion_recent_errors` から、直近の `partial` / `failed` を表示します。error detail が欠落した observation も状態確認のため表示します。error message は ingestion の保存境界で redaction 済みの値だけを保存・表示する前提で、DB 保存前に secret を含む message を必ず redaction してください。

#### run history

`ingestion_observation_history` から、直近の observation 履歴を table 表示します。資産額が更新されていないときに、いつどの source / scope が失敗したか確認する用途です。

## SQL

Panel の SQL は `grafana/queries/` に分離してあります。Grafana dashboard JSON を直接編集しづらい場合は、これらの SQL を panel editor に貼り付けて調整してください。

- `latest-total-value.sql`
- `latest-assets.sql`
- `portfolio-value-timeseries.sql`
- `asset-allocation.sql`
- `source-freshness.sql`
- `ingestion-latest-status.sql`
- `ingestion-status-timeseries.sql`
- `ingestion-recent-errors.sql`
- `ingestion-run-history.sql`

## read-only 権限

`reader` user には、最低限次の権限だけを付与します。password や接続文字列は repository に保存しないでください。

```sql
grant usage on schema public to reader;
grant select on
  portfolio_latest_assets,
  portfolio_value_timeseries,
  portfolio_asset_allocation,
  ingestion_observation_history,
  ingestion_latest_status,
  ingestion_recent_errors
to reader;
```

将来 view を増やした場合も、Grafana datasource には application owner ではなく read-only user を使ってください。

## partial observation の扱い

現在の dashboard views は successful observation のみを参照します。partial observation の snapshots は audit / reprocessing 用に保存されることがありますが、現時点では Grafana の latest / timeseries / allocation には出しません。

partial を dashboard に出す場合は、欠損 asset による過小評価を避けるため、warning 表示や separate panel などの仕様を別途設計してください。
