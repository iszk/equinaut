---
title: Vitest / Vite 系 dev dependency の脆弱性を解消する
status: wip
---

# 概要

`npm audit` で報告されている dev dependency の脆弱性を解消する。

# 背景

現状の `vitest@2.1.9` は critical advisory の対象になっている。併せて `vite` / `esbuild` 経由の high / moderate advisory も報告されている。

`drizzle-kit` 経由でも deprecated な `@esbuild-kit/*` が残っているため、単純な `npm audit fix --force` ではなく、影響範囲を確認しながら更新する必要がある。

# 実装/修正プラン

- `vitest` を advisory 解消済みの major version に更新する。
- `vite` / `vite-node` / `@vitest/mocker` / `esbuild` の advisory が解消されることを確認する。
- `drizzle-kit` の advisory 経路を確認し、更新または代替対応が必要か判断する。
- `npm test` / `npm run typecheck` を実行する。
- 可能なら `npm audit` が 0 件、少なくとも critical / high が残らない状態にする。

# ログ

## 2026-06-30 01:09 Codex GPT-5

現状確認で `npm audit --json` を実行し、8 件の脆弱性を確認した。内訳は moderate 6 件、high 1 件、critical 1 件。主な direct dependency は `vitest` と `drizzle-kit`。

## 2026-06-30 02:09 Codex GPT-5

`vitest` を `^4.1.9` に更新し、`vite` を `^8.1.0`、`esbuild` を `^0.28.1` として devDependency に明示したうえで `package-lock.json` を再生成した。これにより `vitest` / `vite` / `vite-node` / `@vitest/mocker` 経由の critical / high advisory は解消された。

更新後に `npm run typecheck`、`npm test`、`npm ls vitest vite vite-node @vitest/mocker esbuild drizzle-kit`、`npx drizzle-kit --help` を実行し、いずれも成功した。`npm test` は 13 files 中 11 passed / 2 skipped、61 tests 中 55 passed / 6 skipped。

`npm audit --json` の最終結果は moderate 4 件、high 0 件、critical 0 件。残存分は `drizzle-kit@0.31.10` 経由の `@esbuild-kit/esm-loader` / `@esbuild-kit/core-utils` / nested `esbuild@0.18.20` に限定される。`drizzle-kit@0.31.10` は npm registry 上で最新であり、audit が提示する修正は `drizzle-kit@0.18.1` への downgrade だったため、今回の依存更新 task では採用しなかった。
