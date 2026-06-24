---
status: done
created_at: 2026-06-24
completed_at: 2026-06-24
---

# 既存 Grafana 向け portfolio dashboard を追加する

## 背景

homelab の既存 Grafana に equinaut dashboard を同居させる。Grafana 本体は equinaut repository では管理せず、PostgreSQL datasource と dashboard import / provisioning 用 artifacts を提供する。

## 対応内容

- `reader` user を使う前提の PostgreSQL datasource provisioning 例を追加する。
- `portfolio_latest_assets`, `portfolio_value_timeseries`, `portfolio_asset_allocation` を使う dashboard JSON を追加する。
- dashboard panel の SQL を `grafana/queries/` に分離して保存する。
- 既存 Grafana への import / provisioning 手順を `docs/grafana.md` に日本語で記載する。

## 対応しないこと

- Grafana 本体の install / deploy
- Grafana の authentication / reverse proxy / TLS 設定
- alerting
- partial observation を dashboard に表示する仕様設計
