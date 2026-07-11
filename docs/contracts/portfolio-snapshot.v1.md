# portfolio-snapshot.v1

Saxo Bank portfolio exporter と equinaut の間で共有する portfolio snapshot contract。
equinaut 固有の `assetKey` / `scopeId` は含めず、producer が保持する source ID と金融商品の snapshot 情報だけを表現する。

## 成果物

- `src/contracts/portfolio-snapshot/v1.ts`: Zod 4 schema、TypeScript type、example の source of truth
- `docs/contracts/portfolio-snapshot.v1.schema.json`: JSON Schema artifact
- `docs/contracts/portfolio-snapshot.v1.example.json`: example JSON
- `npm run contracts:generate`: JSON artifact を再生成する script

## 主要ルール

- `schemaVersion` は `portfolio-snapshot.v1` 固定。
- `generatedAt` / `dataAsOf` は UTC の ISO 8601 string とし、`Z` suffix を必須にする。
- decimal は JSON number ではなく string で表現し、指数表記は許可しない。
- `cashBalances` と `positions` は `valueJpy` を必須にする。
- top-level と主要 object は unknown field を許可しない。
- provider 固有の追加情報は `sourceMetadata` に JSON 値として入れる。
- equinaut の HTTP ingestion adapter は完全 snapshot のみを受け付ける。producer 側で部分取得や欠損がある場合も `partial` flag は contract に含めず、contract に沿った完全 snapshot を返す責任は producer 側にある。

## equinaut HTTP ingestion mapping

- `SAXO_PORTFOLIO_API_URL` に GET し、`SAXO_PORTFOLIO_API_SECRET` または `SAXO_PORTFOLIO_API_SECRET_FILE` の値を Bearer token として送る。
- `sourceId = saxo`、`displayName = Saxo Bank`、`scopeId = saxo:portfolio`、`scopeType = portfolio`、`assetKeyPrefix = saxo:portfolio` として保存する。
- `cashBalances` は通貨単位で集約し、asset key は `saxo:portfolio:cash:${currency}` にする。`sourceBalanceId` や client/account ID は asset key に含めない。
- `positions` は初期実装では `sourcePositionId` を asset key に使い、`sourceInstrumentId` / `netPositionId` など source 側 identifier は `raw` に残す。
- `stock` は `assetType = stock`、`etf` / `fund` は `assetType = fund`、`cfd` は `assetType = cfd` に map する。`bond` / `option` / `future` / `fx` は初期実装では `unsupported_asset_class` として failed にする。
- CFD は `valueJpy` を総資産へ加算してよい JPY contribution として扱い、`quantity = valueJpy`、`price = 1`、`priceCurrency = JPY`、`fxToJpy = 1` で保存する。source quantity / price / notional / PnL は `raw` に保存する。
- `generatedAt` は `scope_observations.observed_at`、`dataAsOf` は `scope_observations.data_as_of` に反映する。
- `accounts[].sourceMetadata.clientKey` は永続化 raw data に含めない。

## 範囲外

- Saxo Bank OpenAPI への直接呼び出し
- GCP endpoint 実装
- trading bot 側変更
- non-CFD short position の dashboard 表現決定
