---
title: scope observation の論理無効化を実装する
status: wip
---

# 概要

誤投入した observation を物理削除せず、`voided_at` / `void_reason` で論理無効化できるようにする。

# 背景

`0001-初期設計決定` では、再実行は append-only、誤投入は `voided_at` で論理無効化する方針になっている。しかし現在の `scope_observations` schema には `voided_at` / `void_reason` がなく、dashboard views も void 済み observation を除外できない。

# 実装/修正プラン

- `scope_observations` に `voided_at` / `void_reason` を追加する migration を作成する。
- Drizzle schema を更新する。
- `portfolio_latest_assets` / `portfolio_value_timeseries` / `portfolio_asset_allocation` が `voided_at is null` の success のみ参照するようにする。
- void 済み observation が latest / timeseries / allocation に出ない integration test を追加する。
- 運用用の void 手順を docs に短く追記するか検討する。

# ログ

## 2026-06-30 01:09 Codex GPT-5

現状確認で、設計上 Accepted の論理無効化方針が schema / dashboard views に未反映であることを確認した。金融データの誤投入訂正に関わるため、独立 task として起票した。

## 2026-06-30 12:20 Codex GPT-5

実装に着手した。`voided_at` / `void_reason` は nullable とし、`void_reason` は必須制約を置かず運用上の記録欄として扱う方針にした。schema / migration / dashboard views / integration test / docs を更新し、void 済み successful observation が latest / timeseries / allocation に出ないことを検証する。
