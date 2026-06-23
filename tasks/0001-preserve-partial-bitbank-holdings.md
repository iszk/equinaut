---
title: Preserve successfully mapped holdings on partial bitbank valuation failures
status: done
---

# 概要

bitbank の holdings mapping で一部 asset の JPY ticker が欠損した場合でも、それ以前に正常に mapping 済みの holdings を保持・永続化できるようにする。

# 背景

現在の `mapBitbankAssetsToHoldings` は、missing ticker を検出すると `status: "partial"` と `holdings: []` を返す。JPY cash など、既に正しく評価できた holdings があっても破棄される。

この挙動は将来的には改善したいが、現時点の MVP では bitbank の JPY ticker が取得できないケースは例外的で、`partial` の永続化 semantics もまだ固まっていない。今回の PR では scope を広げず、後続 task として追跡する。

# 実装/修正プラン

- `MappingResult` の `partial` variant が accumulated holdings を返せるように型を拡張する。
- `collectBitbankSpotAccount` から `partial` holdings を伝播する。
- DB 永続化側で `partial` run の observations と snapshots をどう扱うか決める。
- JPY cash + missing crypto ticker の regression test を追加する。

# ログ

## 2026-06-17 00:05 Hermes Agent gpt-5.5

Copilot review の指摘を triage した。指摘自体は正しいが、今は MVP の最小 ingestion path を優先し、`partial` の永続化方針を広げるほどではないため今回の PR では見送り。将来的にやりたい改善として task 化した。

## 2026-06-23 Hermes Agent gpt-5.5

`partial` observation でも、missing ticker 発生前に正常に map 済みの holdings を保持・永続化するようにした。`mapBitbankAssetsToHoldings` / `collectBitbankSpotAccount` / `persistBitbankSpotObservation` の partial holdings 伝播を修正し、JPY cash + missing crypto ticker の regression test を追加した。dashboard views は引き続き `success` observation のみを対象とし、partial snapshots を latest portfolio には反映しない方針を維持した。
