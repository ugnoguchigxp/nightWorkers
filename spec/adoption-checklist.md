# Adoption Checklist

NightWorkers を既存のローカル repository に対して使い始める前の確認項目。

## Before Deciding to Try It

- [ ] README の Good Fit / Not Good Fit を読み、自分の用途が local-first
  control plane に合っている。
- [ ] [Feature Tour](./feature-tour.md) で Workbench、Implementation Queue、
  Run Evidence、Artifact Pane の役割を確認した。
- [ ] hosted demo はないが、credential 不要の固定 seed demo を
  `bun run demo:smoke` で再現できることを確認した。
- [ ] 最初の評価は、本番 repository ではなく throwaway repository または戻せる
  repository で行う。

## Before First Run

- [ ] 本番 repository を登録する前に `bun run demo:setup` と
  `bun run demo:run` で evidence 導線を確認し、`bun run demo:reset` した。
- [ ] `bun run setup` が完了している。
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
- [ ] Final report を単独で信じず、diff、tool results、verification evidence と合わせて確認する。

## Before Real Work

- [ ] `bun run verify:fast` がローカルで動くことを確認した。
- [ ] Desktop app として使う場合は `bun run desktop:build` と `bun run desktop:smoke` の現状を確認した。
- [ ] Provider smoke test が通る。
- [ ] Runtime lane と structured provider を混同していない。
- [ ] Secret を含む repository や production credentials を扱う場合、MCP / Hooks / provider settings の送信範囲を再確認した。

## Ongoing Use

- [ ] Queue に入れる task は user-approved automation work として扱う。
- [ ] Failed / needs_human の run は raw event、tool output、final report を分けて読む。
- [ ] Coding Agentが明示的にTodoを完了し、final report、diff、tool resultを確認してからcommitする。
- [ ] verificationやsecurity scanが必要かはTaskに応じてTodoへ含め、結果を確認する。
- [ ] `needs_human` Todoがある場合は質問へ回答し、同じTodoをresumeしてから続行する。
- [ ] Documentationやruntime境界の説明に違和感があれば、[Architecture and Module Boundaries](./architecture.md) と実装を同時に更新する。
