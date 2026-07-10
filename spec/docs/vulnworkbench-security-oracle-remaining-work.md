# vulnWorkbench Security Oracle 連携 残タスク

## Status

partial

## 現在地

Review Modeでは、登録済みProjectのrepo rootを対象にvulnWorkbenchの
`api/cli/oracle-security.ts` を実行し、scanner-backed finding、改善提案、artifactを保存・表示できる。
CLI環境変数のallowlist、timeout、JSON抽出、失敗時のwarning / needs-human artifact、回帰テストも存在する。

元の全体設計は `spec/archive/vulnworkbench-cli-security-oracle-plan.md` を参照する。

## 残タスク

1. vulnWorkbenchの現行`oracle-security` JSON schema、exit code、redactionをfixture contract testで固定する。
2. env設定だけでなくProject単位のsecurity gate設定をschema / API / UIへ追加する。
3. Review Modeの任意診断と、implementation closeout前のblocking security gateを明確に分離する。
4. repo-native verify成功後、open Todo解消後、finalize前にだけdeterministic security gateを実行する。
5. findingなしを`passed`、actionable findingを`continue`、CLI missing / schema invalid / prerequisite missing / iteration上限を`needs_human`として保存する。
6. blocking Improvement Requestをallowed scope、non-goals、acceptance、verify、rerun情報付き`security_fix` Todoへ変換する。
7. scope外diffを拒否し、repo verifyと同一finding rerunのevidenceが揃うまでTodoをpassにしない。
8. rerun結果の`resolved`、`still_present`、`changed`、`not_reproducible`、`scanner_failed`を区別する。
9. resolved / false-positive判断だけをredact済みの再利用可能な手順としてcontextStill候補へ送る。

## 完了条件

- disabled時に既存runへ影響しない。
- scanner failureがsecurity passとして扱われない。
- actionable findingが残るrunはfinalizeできない。
- 修正、repo verify、finding rerunが同じImprovement Requestへtraceできる。
- raw scanner outputやsecretがmodel-visible payload、Project repo、knowledge candidateへ漏れない。
- NightWorkersとvulnWorkbench双方のfocused testsおよび代表verifyが成功する。
