---
title: redaction helper を共通化する
status: todo
---

# 概要

`src/server/ingestion/run.ts` と `src/server/ingestion/scheduler.ts` で重複している例外メッセージの redaction ロジックを、共通 helper に切り出す。

# 背景

postgres URL と password/token/apiKey 系の置換が同一の正規表現として複数箇所に存在している。どちらか片方だけ修正された場合、将来のログ出力で secret が redaction されずに出るリスクがあるため、単一の実装に集約したい。

# 実装/修正プラン

- redaction 用の helper を `src/server/ingestion/` 配下の適切な module に切り出す。
- `run.ts` と `scheduler.ts` はその helper を利用するように変更する。
- postgres URL と password/token/apiKey 系の redaction 挙動を test で固定する。
- ログ出力の message 生成箇所で unredacted message が混入しないことを確認する。

# ログ

## 2026-06-20 02:11 Hermes gpt-5.5
PR #12 merge 後の follow-up として起票。scheduler 導入時に `run.ts` と `scheduler.ts` の redaction 正規表現が重複したため、将来の修正漏れによる secret 漏洩リスクを下げる目的で共通 helper 化する。
