# Trust Model

NightWorkers は local-first の自律開発 control plane であり、信頼境界は「登録済み Project Folder」「NightWorkers runtime state」「外部 provider / tool integration」に分かれる。

## Local State

- Primary runtime state は SQLite/libSQL、settings、logs、artifacts としてローカルに保存される。
- Development mode は repo-local defaults を使う。
- Desktop mode は `NIGHTWORKERS_RUNTIME_DIR` があればその場所を使い、未設定の場合は Tauri sidecar が解決した runtime directory を使う。
- Registered Project work は登録済み Project repo root を基準に実行される。Tauri resource directory や temporary directory を実作業 workspace として扱わない。

## Provider Boundary

- Structured LLM providers は intake、Blueprint、Plan Mode、review、smoke test などの schema-first reasoning に使う。
- Implementation runtime lane は repository work execution に使う。
- Provider request には user prompt、Supervisor prompt context、StateCard、tool/result summaries、artifact/task context が含まれる場合がある。
- Provider credentials は user-managed であり、Settings API は masked secret を返す。

## Worker Tool Boundary

- Repository writes は worker-tool dispatcher 経由に集約する。
- Path policy、command policy、timeout、blocked command は tool policy gate で評価する。
- Tool calls、policy blocks、diffs、test results、final reports は run evidence として保存する。
- Coding Agent Run は登録済みProject identity revision、Task workspace allocation、admission attestation、canonical rootを一体のbindingとして保持する。再開時や各workspace tool実行時に一つでも不一致ならfail-closeする。
- `dirty`、conflict、ahead／behindは観測時刻、比較ref、比較SHAを伴うappend-only attestationで記録する。
- workspace file artifactはTask worktree内の相対path、allocation version、観測HEAD、content SHA-256が一致する場合だけ登録できる。temporary root、別repository、secret fileは成果物にできない。

## Secret Boundary

- Provider credentialはOS secret store（macOS Keychain、Windows Credential Manager、Linux libsecret）へ保存し、利用不能時はsession-onlyとする。SQLite fallbackは行わない。
- Project `.env`の正本はProject Tree内のuser-managed fileである。NightWorkersはbase worktreeからTask worktreeへcopyせず、必要な場合はユーザーがTask worktreeへ用意する。
- `.env`、private key、registry credential fileはfile read、search、structure inspection、Project exploration、artifact登録から除外する。
- child process environmentはpurpose別の共通builderで明示構築し、NightWorkers/provider credentialをGit、Hook、MCP stdio、bootstrap、Task worker、workspace commandへambient継承しない。
- event、artifact、Run、message、background processへ書く値はpersistence firewallを通す。raw command outputをtemporary artifactやSQLiteへ保存しない。

## MCP And Hooks

- MCP Server settings は non-authenticated stdio / Streamable HTTP / legacy SSE を対象にする。
- Auth headers、API keys、bearer tokens、cookies、secret-like env values は current implementation slice では拒否する。
- MCP tool calls は internal `mcp_call_tool` bridge を通し、run evidence path から外さない。
- Agent Hooks は hook runner で実行し、worker `run_command` と再帰させない。

## Operator Checklist

- [ ] Sensitive repository を登録する前に、Provider、MCP、Hooks の設定を確認した。
- [ ] `HOST`がloopback addressのままで、proxyやport forwardにより外部公開されていない。
- [ ] MCP / Hooks に secret-like headers や env values を入れていない。
- [ ] Implementation Run の managed evidence と `completion_check` を確認した。
- [ ] Review Run が `done` で、未処置 blocking finding がない。
- [ ] Review が修正した場合、Implementation Run で検証を再実行した。
- [ ] implementation Security Oracle の pass または理由付き skip を確認した。
- [ ] closeout evidence、diff、final reportを確認してからcommit/pushする。
- [ ] Desktop release/adoption readiness では `desktop:smoke` を別途確認する。
