# P1-07 非 Loopback 公開安全策 実装計画

## 目的

repository write と command execution を持つ API が、認証無効のまま非 loopback interface へ公開される構成を暗黙に許可しない。

## 対応する改善項目

- 改善項目 12: 非 loopback 公開時の安全策を強制する。

## 依存関係

- 先行 Phase: P1-06、P0-03。
- 後続 Phase: P2 全体。

## 実装範囲

1. listen host を validated config として明示する。
2. production で非 loopback かつ `API_AUTH_REQUIRED=false` の場合は起動を拒否する。
3. development / container 用の明示的な危険承認 flag が必要なら、default false で追加する。
4. startup preflight に host、auth、CORS、proxy の診断を追加する。
5. Overview に解消方法を含む persistent warning を表示する。
6. IPv4、IPv6 loopback、`0.0.0.0`、proxy header の test matrix を追加する。

## 主な変更候補

- `api/config.ts`
- `api/server.ts`
- startup preflight service / schema
- Overview warning UI
- security hardening / runtime bootstrap test

## 対象外

- multi-user authorization model。
- hosted SaaS 対応。
- reverse proxy の自動設定。

## 検証計画

- `127.0.0.1`、`::1` は認証無効でも local mode として起動できる。
- `0.0.0.0` と private/public address は認証無効なら production 起動に失敗する。
- 認証有効時の明示 CORS origin は起動できる。
- Overview と preflight が同じ判定理由を表示する。
- `bun run test:desktop-runtime` と `bun run verify:full` を実行する。

## 完了条件

- 無認証外部公開が default configuration では成立しない。
- desktop loopback 起動に回帰がない。
- 危険構成が log、preflight、UI のすべてで確認できる。
- wildcard CORS を許可しない既存契約が維持される。
