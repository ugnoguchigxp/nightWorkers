# Mission Pilot Pure TypeScript Boundary Rules

- repository、filesystem、Git、shellへアクセスしない。
- Coding Agent、Plan Mode、NightWorkers private sourceをimportしない。
- user-equivalentなTask Operator action以外の業務副作用を作らない。
- prompt文言は日本語を維持する。
- ユーザー文言、Task文言、error textをkeywordまたは正規表現で分類しない。
- structured principalとprovenanceをすべての代理操作で必須にする。
- 独自の`package.json`、`tsconfig.json`、dependency graphを作らず、root toolchainで検査する。
- package外importはroot dependencyとして管理されたthird-party dependencyと明示されたpublic contractに限定する。
- backend、frontend、contracts、testingの公開面はroot `tsconfig.json`とbuild configの完全一致aliasだけで提供し、deep importを許可しない。
- `drizzle-orm`、`@libsql/client`、NightWorkers DB client/schemaをimportしない。
- SQLite read/writeはcompositionから注入された固定operation allowlistの非HTTP persistence capabilityだけを使い、任意SQL、table名、DB handleを渡さない。
