---
status: done
created_at: 2026-06-25
completed_at: 2026-06-25
---

# Grafana ingestion health dashboard を追加する

## 背景

portfolio dashboard は資産額の結果を見る用途だが、資産額が更新されない場合に ingestion の最新状態や失敗履歴を確認する場所がない。Uptime Kuma integration / alerting は後続に回し、まず Grafana で履歴と状態を見えるようにする。

## 実装範囲

- `scope_observations` / `ingestion_runs` ベースの ingestion health view を追加する
- 最新 status / run history / recent partial・failed を確認できる Grafana dashboard を追加する
- dashboard panel SQL を `grafana/queries/` に分離する
- `reader` user に必要な read-only 権限を docs に追記する

## あえてやらないこと

- Uptime Kuma integration
- alerting
- scheduler heartbeat
- retry policy の変更
- partial observation を portfolio value に混ぜること
