# Mission Pilot Package Rules

- repository、filesystem、Git、shellへアクセスしない。
- Coding Agent、Plan Mode、NightWorkers private sourceをimportしない。
- user-equivalentなTask Operator action以外の業務副作用を作らない。
- prompt文言は日本語を維持する。
- ユーザー文言、Task文言、error textをkeywordまたは正規表現で分類しない。
- structured principalとprovenanceをすべての代理操作で必須にする。
- package外importはthird-party dependencyと明示されたworkspace public contractに限定する。
- backend、frontend、contracts、testingの公開面はpackage.jsonの明示exportだけで提供し、deep importを許可しない。
