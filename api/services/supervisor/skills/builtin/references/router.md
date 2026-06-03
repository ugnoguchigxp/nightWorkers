# Router

## Use When

Round 1 と各ラウンドの行動前に、現在の routing hypothesis を作るか見直すときに使う。

## Required Behavior

- primary mode は1つだけ選ぶ。
- secondary modes、work kinds、overlays は必要に応じて複数選ぶ。
- 分類は固定せず、observations、tool result、todoPlan、ユーザー追加入力で再評価する。
- toolCall を返す前に、今が answer、analyze、plan、execute、review、investigate、verify、summarize のどこかを確認する。

## Stop Conditions

- routing が十分明確で、次に読む reference と必要証拠が決まったら次の phase へ進む。
- routing confidence が低い場合は、止まらずに最小の証拠取得を選ぶ。

## Report Contract

- routing hypothesis には primaryMode、secondaryModes、phase、workKinds、overlays、requiredEvidence、nextSkillFiles、confidence を含める。

