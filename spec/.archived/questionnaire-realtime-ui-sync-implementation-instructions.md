# QuestionnaireリアルタイムUI同期 実装指示書

## 新しいセッションへの依頼

Mission Pilotがユーザーと同じ共有commandでQuestionnaire回答を送信した場合に、現在開いているQuestionnaire画面へ回答と状態を動的に反映してください。

この作業では、Mission Pilot、Coding Agent、Questionnaire domain、Questionnaire UIの責務を混同しないでください。最初にルートの`AGENTS.md`を読み、本書の責務境界と禁止事項を維持したまま、調査、実装、Unitテスト、型検査、module境界検査まで行ってください。E2Eの実行は不要です。最終的な画面動作はユーザーが手動で検証します。

## 背景と確認済みの事実

Mission Pilotによる直近の実行では、次の処理が成功している。

1. Plan ModeがQuestionnaireを生成した。
2. Mission Pilotは20秒の介入時間が経過してから、Questionnaire正本を全ページ取得した。
3. Mission PilotはTask Operatorの共有actionである`questionnaire.submit`を実行した。
4. 15件の回答がQuestionnaire正本へ保存された。
5. Questionnaire sessionは`review_ready`へ遷移した。

問題は、サーバー側で行われた送信結果が、現在開いているQuestionnaire画面へ即時反映されないことである。

手動送信時は、ブラウザ自身がmutation responseを受け取り、ローカルstateまたはquery cacheを更新できる。一方、Mission Pilotの送信はサーバー側で実行されるため、ブラウザはそのmutation completionを直接受け取らない。したがって、正本の状態変更を共有イベントとして通知し、Questionnaire画面が正本を再取得する経路が必要である。

## 目的

Questionnaireの回答主体にかかわらず、同じ正本更新が同じUI同期経路を通るようにする。

- ユーザーがQuestionnaire画面から回答した場合
- Mission Pilotがdelegated userとして共有commandを実行した場合
- 将来、別の許可されたapplication actorが同じ共有commandを実行した場合

いずれの場合も、開いているQuestionnaire画面がページ再読み込みなしで最新の回答、status、revisionを表示すること。

## 責務境界

### Questionnaire domain / application command

Questionnaire正本の所有者である。

- 回答のschema検証
- 回答とsession statusの永続化
- revision、transaction、idempotencyの検証
- commit成功後のQuestionnaire状態変更通知
- actorに依存しない正本参照の提供

状態変更通知には、最低限、対象を一意に再取得できる情報を含める。

- `taskId`
- `questionnaireSessionId`
- Questionnaire status
- source revisionまたは更新revision
- 必要ならstate digest

回答全文をrealtime payloadの正本にしてはならない。UIは通知を受けた後、既存のcanonical queryからQuestionnaireを再取得する。

### Questionnaire画面 / Plan Mode frontend

Questionnaireの表示とクライアント側同期を所有する。

- 共有Questionnaire状態変更イベントの購読
- 対象TaskおよびQuestionnaire sessionの照合
- canonical queryのinvalidateまたは再取得
- 取得した正本による選択済み回答、status、review stateの再描画
- 重複イベントと順序逆転への耐性
- unmount、Task切り替え、接続切断時の購読解除

UIはMission Pilotの内部session、tool call、conversation、repositoryを参照してはならない。更新主体ではなく、Questionnaireの正本revisionを基準に同期する。

### Mission Pilot

Mission Pilotはユーザーと同等のapplication actorであり、Questionnaire UIの実装者ではない。

- ユーザーに許可された共有`questionnaire.submit` commandを実行できる。
- command receiptとQuestionnaireの正本状態を観測できる。
- Questionnaire回答、Plan routing、次actionの判断を自身のrole責務として行う。
- UI query cache、React state、Questionnaire画面のroute、DOMを直接操作しない。
- UI更新のためのMission Pilot専用APIを要求しない。
- UI更新のためにブラウザの回答ボタンを押す実装を追加しない。

Mission PilotからQuestionnaire画面を直接更新する依存関係を作ってはならない。

### Coding Agent

Coding Agentは登録済みrepositoryでの調査、実装、command実行、検証を所有する。

- Plan Modeが確定したTaskと設計を基に実装を進める。
- Questionnaire正本の更新後、既存のPlan Mode/application eventに従って処理を継続する。
- Questionnaire画面のquery cacheやrealtime同期を所有しない。
- Mission Pilotの代理回答、20秒タイマー、Questionnaire UI更新を実装しない。
- Mission Pilotの起動、停止、handoffを推測して分岐しない。

本件を理由に`api/modules/codingAgent`または`src/modules/codingAgent`へ変更を入れてはならない。Coding Agent runtime、tool、repository、System Contextも変更対象外とする。

### 共有境界

Mission PilotとCoding Agentを直接連携させない。

- Agent非依存のQuestionnaire command、canonical query、eventを使用する。
- 両Agentで完全に同じ意味を持つcontractが必要な場合だけ`agentsShare`を使用する。
- Questionnaire UI同期のためだけに`agentsShare`へroute、repository、role判定、専用toolを追加しない。
- 一方のrole moduleから他方のroute、service、repository、public indexをimportしない。

## 禁止事項

- Mission PilotからCoding Agent moduleをimportする。
- Coding AgentからMission Pilot moduleをimportする。
- Coding AgentへQuestionnaire UI更新責務を追加する。
- Mission PilotへQuestionnaire画面やReact query cacheの操作責務を追加する。
- Mission Pilot専用のQuestionnaire取得・回答・UI通知APIを追加する。
- 同じ回答をMission Pilot専用draftや別の回答テーブルへ複製し、それをUI正本にする。
- actorがMission PilotかどうかでQuestionnaire保存処理やUI同期処理を分岐する。
- ユーザー文言、error message、keyword、正規表現から更新対象や次actionを推測する。
- Questionnaire正本のcommit前に成功イベントを配信する。
- realtime payloadだけを信用してQuestionnaire正本を上書きする。
- UI同期の修正を理由にCoding Agentのworkflow、mode、tool allowlistを増やす。

## 最初に調査すること

実装前に、次の既存経路をコード上で追跡する。

1. Questionnaire画面から手動送信したときのfrontend mutation。
2. 手動送信成功後に、どのquery cacheまたはcomponent stateが更新されるか。
3. `questionnaire.submit`が最終的に呼ぶ共有application command。
4. 回答保存と`review_ready`遷移を行うtransaction境界。
5. 既存のQuestionnaire state changed listenerまたはevent。
6. Task、Plan Mode workspace、Questionnaireで既に利用しているrealtime transport。
7. Mission Pilot経由の送信後に、どの通知がfrontendまで届いていないか。
8. Questionnaire画面が使用しているcanonical query keyと再取得関数。

新しいparallel abstractionを作る前に、既存のQuestionnaire eventとTask realtime transportを再利用できるか確認する。

## 推奨する実装方針

実際のコード構造を確認したうえで、原則として次の経路に統一する。

```text
User UI または Mission Pilot
        |
        v
共有 questionnaire.submit command
        |
        v
Questionnaire正本をtransaction内で更新
        |
        v
commit成功後にAgent非依存のstate changed eventを発行
        |
        v
既存のTask / Plan Mode realtime transport
        |
        v
Questionnaire画面が対象sessionのcanonical queryを再取得
        |
        v
回答・status・review stateを再描画
```

### Backend

- 既存のQuestionnaire状態変更通知がcommit成功後に必ず発行されているか確認する。
- 手動UIとMission Pilotの両方が同じapplication commandを通ることを維持する。
- actor別の通知分岐を追加しない。
- 既存イベントがbackend内listenerだけに閉じている場合は、Agent非依存のTaskまたはPlan Mode realtime projectionへ接続する。
- eventにはrevisionまたはdigestを含め、frontendが古い通知を新しい正本として扱わないようにする。
- 副作用の権限、revision、idempotency検証を維持する。

### Frontend

- Questionnaire画面が既に購読しているTaskまたはworkspace realtime更新経路へQuestionnaire state changedを統合する。
- 対象`taskId`と`questionnaireSessionId`が一致した場合、canonical Questionnaire queryをinvalidateまたは再取得する。
- Mission Pilot固有のevent名、session ID、tool resultをUI更新条件にしない。
- 手動mutation responseによる即時更新は維持してよいが、その後のcanonical refetchと矛盾しないようにする。
- realtime eventが重複しても回答を二重送信したりUI stateを壊したりしない。
- revisionが古いeventは無視するか、最新正本の再取得だけを行う。

## 受け入れ条件

- [ ] Questionnaire画面を開いた状態で、Mission Pilotが`questionnaire.submit`を成功させると、ページ再読み込みなしで選択済み回答が表示される。
- [ ] 同じ画面でQuestionnaire statusが`answering`から`review_ready`へ動的に変わる。
- [ ] 表示内容はQuestionnaireのcanonical queryから取得した正本である。
- [ ] 手動回答の既存動作を壊していない。
- [ ] Mission Pilotと手動UIが同じ`questionnaire.submit` application commandを使用している。
- [ ] Mission Pilot専用のQuestionnaire UI同期APIを追加していない。
- [ ] Mission Pilotからfrontendのroute、component、query cacheを操作していない。
- [ ] `api/modules/codingAgent`および`src/modules/codingAgent`を変更していない。
- [ ] Mission PilotとCoding Agent間のdirect importまたはre-exportを追加していない。
- [ ] 重複イベント、遅延イベント、Task切り替えで別Questionnaireの回答が表示されない。
- [ ] Unitテスト、型検査、module境界検査が成功する。

## 必要なテスト

E2Eは実行しない。少なくとも次のUnitまたはintegration-level testを追加・更新する。

1. `questionnaire.submit`成功後に共有状態変更通知が発行される。
2. Mission Pilot経由と手動UI経由で通知contractが同じである。
3. frontendのevent handlerが対象Questionnaire queryを再取得対象にする。
4. 別Taskまたは別Questionnaire sessionのeventを誤適用しない。
5. 同じrevisionの重複eventを安全に処理する。
6. 古いrevisionのeventで新しい表示状態へ巻き戻らない。
7. Mission Pilot / Coding Agent module境界検査が成功する。

検証commandはリポジトリの既存scriptを確認して選択する。最低限、関連Vitest、`bun run typecheck`、`bun run check:architecture`を実行する。

## 作業完了時の報告

最終報告には次を含める。

1. 動的反映されなかった直接原因。
2. 使用した既存のcanonical command、event、realtime transport。
3. backendの変更箇所。
4. frontendの変更箇所。
5. Mission PilotとCoding Agentの責務を混ぜていない根拠。
6. `api/modules/codingAgent`および`src/modules/codingAgent`に変更がないこと。
7. 実行したUnitテスト、型検査、module境界検査の結果。
8. E2Eは実行せず、手動確認をユーザーへ委ねたこと。

