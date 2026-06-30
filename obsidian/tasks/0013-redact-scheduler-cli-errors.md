---
title: scheduler CLI の最外周 error 出力を redaction する
status: wip
---

# 概要

`scripts/ingest-scheduler.ts` の最外周 `catch` でも共通 redaction helper を使う。

# 背景

`run.ts` と scheduler loop 内の source result / crash log は `redactSensitiveMessage` を使っている。一方、scheduler CLI の config load や起動時例外を扱う最外周 `catch` は `error.message` をそのまま `console.error` に渡している。

YAML config に secret を入れない方針のため通常リスクは低いが、プロジェクト方針として secret を含む可能性がある error / log message は必ず redaction する必要がある。

# 実装/修正プラン

- `scripts/ingest-scheduler.ts` で `redactSensitiveMessage` を使う。
- config path / read error / parse error の既存挙動を壊さない regression test を追加するか検討する。
- 同様の最外周 CLI error 出力が他にないか確認する。

# ログ

## 2026-06-30 01:09 Codex GPT-5

現状確認で、scheduler CLI の最外周 error 出力だけ共通 redaction helper を通っていないことを確認した。小さく独立して直せる安全性改善として起票した。

## 2026-06-30 12:16 Codex GPT-5

`scripts/ingest-scheduler.ts` の最外周 error 出力に `redactSensitiveMessage` を適用するため、CLI failure 表示用 helper を追加して script から利用する方針で着手した。
config read / parse error の文脈を維持しつつ secret を redaction する regression test も追加対象にした。

## 2026-06-30 12:17 Codex GPT-5

`formatSchedulerCliFailure` を追加し、scheduler CLI の最外周 `catch` から利用するように変更した。
config read / parse error の既存メッセージ形を維持する test と、PostgreSQL URL / `apiSecret` を redaction する test を追加した。
同種の最外周 CLI error 出力を確認し、`scripts/ingest.ts` は usage と既に redaction 済みの ingestion result 出力のみだったため追加変更しなかった。
検証は `npm test -- src/server/ingestion/scheduler-cli.test.ts`、`npm run typecheck`、`npm test` が成功した。
task の close はユーザー確認が必要なため、status は `wip` のままとした。
