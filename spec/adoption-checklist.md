# Adoption Checklist

NightWorkers を既存のローカル repository に対して使い始める前の確認項目。

## Before First Run

- [ ] `bun install`、`.env` 作成、`bun run db:migrate`、`bun run db:seed` が完了している。
- [ ] `bun run dev` で Overview が開ける。
- [ ] 最初に登録する Project Folder は、throwaway repo か、変更を review して戻せる repo である。
- [ ] Provider credentials を入れる前に Settings の現在値を確認した。
- [ ] MCP Server と Agent Hooks は意図して有効化するまで OFF / empty にしている。
- [ ] [Trust Model](./trust-model.md) を読み、Project Folder と runtime state の境界を理解した。

## First Session

- [ ] 最初の message は read-only investigation にする。
- [ ] Chat-only/intake と execution run の違いを Workbench timeline で確認する。
- [ ] Implementation Queue へ入れる前に、plan と expected changes を確認する。
- [ ] Run が始まった場合、todos、tool outcomes、diff、test/final-report events を確認する。
- [ ] Artifact Pane に出た Blueprint / Plan Mode Workspace は adoption 前に確認する。

## Before Real Work

- [ ] `bun run verify:fast` がローカルで動くことを確認した。
- [ ] Desktop app として使う場合は `bun run desktop:build` と `bun run desktop:smoke` の現状を確認した。
- [ ] Provider smoke test が通る。
- [ ] Runtime lane と structured provider を混同していない。
- [ ] Secret を含む repository や production credentials を扱う場合、MCP / Hooks / provider settings の送信範囲を再確認した。

## Ongoing Use

- [ ] Queue に入れる task は user-approved automation work として扱う。
- [ ] Failed / needs_human の run は raw event、tool output、final report を分けて読む。
- [ ] Diff と verification evidence がない変更を commit しない。
- [ ] Documentation や verification gate の説明に違和感があれば、[Documentation Maintenance Checklist](./archive/documentation-maintenance-checklist.md) に沿って更新する。
