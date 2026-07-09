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

## 評価額 semantics

`valueJpy` は equinaut dashboard の総資産・allocation に加算してよい JPY 評価額です。notional / exposure / contract value を機械的に表すものではありません。

`positions[].assetClass` は source 側の商品分類です。許可値は `cash`, `stock`, `etf`, `fund`, `bond`, `option`, `future`, `cfd`, `fx` です。これは equinaut 内部の `asset_snapshots.asset_type` / `HoldingSnapshot.assetType` とは別概念であり、内部 `assetType` は dashboard 用 valuation category として扱います。

`price`, `priceCurrency`, `quantity` は producer が `valueJpy` を説明するために提供する valuation input です。ただし、すべての `assetClass` で `quantity * price * fx = valueJpy` が成り立つことは要求しません。

`assetClass = cfd` の `valueJpy` には、equity contribution や PnL contribution など、総資産に加算してよい値だけを入れます。CFD の notional / exposure を `valueJpy` として送ってはいけません。notional / exposure や source 元の price / quantity が必要な場合は `sourceMetadata` に保持し、equinaut adapter 側で `valueJpy` と混同しないように扱います。

## 範囲外

- Saxo API 呼び出し
- GCP endpoint 実装
- trading bot 側変更
- equinaut ingestion adapter 実装
- equinaut 内部の `assetKey` / `scopeId` への mapping
