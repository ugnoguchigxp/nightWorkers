# Chat Activity Ledger Redesign Plan

## Purpose
NightWorkers の Chat 欄を、WebUI の一時 state ではなく DB に保存された activity ledger から復元される transcript として作り直す。

現在の問題は、API 側では LLM 出力、tool 実行、差分、判断 JSON などを拾えていても、WebUI の Chat 欄がそれらを message 表示の都合で上書き・破棄・分離してしまうことにある。この計画では、まず全アクティビティを DB に append-only で保存し、その後に「どれを同じ turn とみなすか」「どの event kind をどう表示するか」を定義する。

通常ビューと監査ビューは v1 では分けない。全部表示し、後日非表示にしたいものだけ filter する。

## Core Principle
Chat 欄は source of truth ではない。

- API 側で発生したすべての activity を DB に保存する。
- 保存対象を事前に選別しない。未分類、未知 kind、schema 外、parse 失敗、tool 失敗、空 delta、途中状態も保存する。
- 「表示しない」は後日の filter の責務であり、「保存しない」の理由にしてはいけない。
- 保存できなかった activity は許容される欠落ではなくバグとして扱う。
- publish before persist を禁止する。WebSocket / SSE / UI response に出す activity は、先に DB に保存された row の `id` と `seq` を持つ。
- 保存処理の失敗を握りつぶさない。正規化だけが失敗した場合は `unknown.activity` として保存する。DB 書き込み自体が失敗した場合は呼び出し元に観測可能な failure として返し、保存済みであるかのように WebSocket / UI response へ流さない。
- WebSocket は保存済み activity の live tail として扱う。
- HTTP replay は同じ activity を `seq` cursor で返す。
- UI は DB activity を transcript に投影するだけにする。
- UI state に直接 message を push / replace する処理を truth として扱わない。
- optimistic UI は未確定の仮表示に限る。DB row が返ったら `clientTempId` で置換し、DB に存在しない optimistic item を確定履歴として残さない。
- LLM 本文、tool call、tool result、diff、decision JSON、verification log は本文に混ぜず、同じ activity ledger 上の別 event として扱う。

## User Orders Adopted
この計画は次を固定する。

- 監査ビューと通常ビューは一旦区別しない。
- 全アクティビティを表示してよい。
- 一切取り残しをしない。API / runtime / provider / worker / UI transport の全 activity を保存する。
- 後日、非表示にしたいものだけ filter する。
- 最初に DB 保存形式を作る。
- その後、turn の区切りと rendering を定義する。
- LLM が途中で止まり、しばらく後に再度発言した場合も、同じ assistant 発話として扱う。
- `apply_patch` / `replace_content` などの変更差分を Chat 欄で受け取れるようにする。
- LLM が判断した分類 JSON、routing、tool 使用イベントを表示可能にする。

## Scope
### In Scope
- activity ledger table の追加
- 既存 `task_messages` / `task_events` / `artifacts` から新 ledger への段階移行
- intake chat と run execution の両方を保存できる event model
- 既知 event と未知 event の両方を保存できる catch-all event model
- activity append API / repository 関数
- activity replay API
- WebSocket live event と replay event の dedupe
- assistant turn grouping
- 全 event kind の初期 rendering
- raw LLM output / raw JSON の保持
- parse / schema validation の成功 payload だけでなく失敗 payload の保持
- tool call / tool result / diff artifact / verification log の表示
- UI の transcript reducer 化
- 回帰テストと replay テスト

### Out of Scope
- v1 での通常ビュー / 監査ビュー分離
- event の非表示 filter UI
- Chat 欄以外の大規模 layout redesign
- Supervisor の判断ロジック変更
- provider ごとの prompt 方針変更
- Queue / Processor の責務変更
- 既存履歴の完全 backfill migration

## Current Anchors
実装時は次を起点に調査する。

| Area | Current Entry Point |
| --- | --- |
| DB schema | `api/db/schema.ts`, `api/db/bootstrap.ts`, `drizzle/migrations/` |
| run event persistence | `api/modules/nightworkers/nightworkers.repository.ts` の `createRunEvent`, `listTaskEventsForRun` |
| service event emission | `api/modules/nightworkers/nightworkers.service.ts` |
| runtime ledger sink | `api/services/agent-runtime/ledger-sink.ts` |
| supervisor loop events | `api/services/supervisor/supervisor-loop.ts` |
| realtime transport | `api/services/realtime/nightworkers-ws.ts` |
| message routes | `POST /api/tasks/:id/messages`, `POST /api/workbench/sessions/:id/messages`, `GET /api/tasks/:id/messages` |
| run replay route | `GET /api/runs/:id/events?afterSeq=` |
| frontend realtime merge | `src/modules/nightworkers/realtimeEvents.ts` |
| workspace hook | `src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts` |
| chat rendering | `src/modules/nightworkers/components/ThreadTimeline.tsx`, `ThreadMessage.tsx` |
| shared types | `src/modules/nightworkers/types.ts` |

## Non-Negotiable Completeness Contract
実装時は次を満たさない限り完了扱いにしない。

1. すべての外部入口で user activity を保存する。
   - `POST /api/tasks/:id/messages`
   - `POST /api/workbench/sessions/:id/messages`
   - Queue / Processor が Session に message を追加する path
   - runtime / supervisor が final response を追加する path
2. すべての LLM provider activity を保存する。
   - request metadata
   - response delta
   - final response
   - raw response
   - parse success
   - parse failure
   - schema validation failure
   - provider error
3. すべての worker activity を保存する。
   - tool call
   - tool args
   - tool result
   - tool error
   - command output
   - file diff / patch / write
   - verification output
4. すべての runtime decision を保存する。
   - Round 1 routing hypothesis
   - Round 2 decision JSON
   - selected skill references
   - stop / finalize decision
   - budget / guard / retry / resume state
5. すべての transport activity を保存する。
   - WebSocket subscribe / replay cursor
   - replay backfill
   - reconnect
   - event dedupe decision
   - publish failure
6. 機密性を理由に activity を破棄しない。
   - prompt / raw response / tool args / command output は保存する。
   - 機密が含まれる可能性は `payload_json.sensitivity` や artifact metadata に記録する。
   - 後日の表示 filter / masking / export policy で扱う。
   - v1 の保存レイヤーでは、機密性を「保存しない」理由にしない。

保存できる schema がまだない activity は、実装を止めずに `unknown.activity` と raw payload で保存する。後で kind を増やして分類し直すことはできるが、最初の発生時点で捨ててはいけない。

## Completeness Audit Matrix
Phase 0 でこの表を実ファイルパス付きで埋め、Phase 3 以降の完了判定に使う。

| Source Area | Required Activity | Adapter | Test Fixture | Done |
| --- | --- | --- | --- | --- |
| message route | user submit, assistant reply, final response | `recordActivity` from message service | route/service test | no |
| workbench intake | user submit, intake LLM delta, intake final, intake error | `recordActivity` from workbench intake path | intake test | no |
| LLM provider | request metadata, raw delta, final raw response, parse/schema result, provider error | provider emit sink | provider fixture | no |
| supervisor loop | Round 1 routing, Round 2 decision, skill selection, stop/finalize, guard/budget/retry/resume | supervisor event adapter | loop fixture | no |
| worker tools | tool call, args, result, error | worker tool dispatcher adapter | tool fixture | no |
| file edit tools | `apply_patch`, `replace_content`, file write, unified diff | artifact + file event adapter | diff fixture | no |
| command/verification | command start, stdout, stderr, exit code, duration | command event adapter | command fixture | no |
| runtime/run | run status, todo status, SessionMemory update | runtime state adapter | run fixture | no |
| realtime transport | subscribe, replay, reconnect, publish success/failure, dedupe | realtime adapter | websocket fixture | no |
| frontend optimistic | optimistic create, DB replacement, failed send | UI activity/reducer adapter | reducer fixture | no |
| unknown/catch-all | any unrecognized payload | `unknown.activity` adapter | unknown fixture | no |

この表の `Done` がすべて `yes` にならない限り、保存レイヤーの実装は完了しない。UI 切り替えは別でもよいが、保存レイヤーの取り残しは許可しない。

## Domain Model
### Hierarchy
```text
Project
  Session / Task
    Activity Ledger
      Turn
        Activity Event
          Artifact
```

`Run` は activity の optional scope とする。Chat intake のように run が存在しない activity も保存できなければならない。

### Entity Responsibilities
| Entity | Responsibility | Not Responsible For |
| --- | --- | --- |
| Session / Task | 会話と作業の所属単位 | live 表示順の source of truth |
| Run | 実行単位。存在する場合のみ activity に紐づく | intake chat 全体の必須親 |
| Turn | ユーザーまたは assistant の発話まとまり | 個別 event の保存先 |
| Activity Event | append-only の事実 | UI 表示判断 |
| Artifact | diff / patch / file / log / JSON などの大きい payload | transcript の並び順 |
| Transcript Item | UI 投影結果 | DB source of truth |

## Activity Event Schema
### New Table
`activity_events` を追加する。既存 `task_events` は run scoped なので、run がない intake chat とすべての UI 表示対象を扱うには狭い。v1 では既存 table を壊さず、新 table を additive に導入する。

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text primary key | UUID |
| `task_id` | text not null | Session / Task scope |
| `run_id` | text nullable | Run がある activity のみ |
| `turn_id` | text nullable | 同じ発話・判断まとまりを束ねる |
| `parent_event_id` | text nullable | tool result -> tool call などの関連 |
| `seq` | integer not null | task 単位の単調増加 cursor |
| `run_seq` | integer nullable | run 単位 cursor が必要な場合 |
| `kind` | text not null | event kind |
| `source` | text not null | `user | assistant | supervisor | worker | tool | system | provider` |
| `status` | text nullable | `started | delta | completed | failed | paused | resumed` など |
| `text` | text nullable | 表示可能な短い本文。raw text もここに残す |
| `payload_json` | json text nullable | structured payload |
| `artifact_id` | text nullable | 大きい diff/log/file への参照 |
| `client_temp_id` | text nullable | optimistic UI や transient event の置換用 |
| `external_id` | text nullable | provider/tool/runtime 側の event id |
| `dedupe_key` | text nullable | replay/live/transient 重複排除用 |
| `ingest_error` | text nullable | 保存時の正規化失敗を raw 保存した理由 |
| `visibility` | text not null default `visible` | v1 は全表示。将来 filter 用 |
| `created_at` | integer timestamp | event 発生時刻 |

Indexes:

- `(task_id, seq)` unique
- `(task_id, created_at)`
- `(run_id, run_seq)`
- `(turn_id, seq)`
- `(kind, created_at)`
- `(artifact_id)`
- `(dedupe_key)` unique where not null if SQLite partial indexes are acceptable; otherwise repository で重複排除する。

### Artifact Storage
既存 `artifacts` は `run_id` not null なので、intake activity からも参照できるようにするか、`activity_artifacts` を追加する。

v1 の推奨は `activity_artifacts` 追加。

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text primary key | UUID |
| `task_id` | text not null | Session scope |
| `run_id` | text nullable | optional |
| `kind` | text not null | `diff | patch | file | log | json | screenshot | command_output` |
| `path` | text nullable | 対象ファイル、仮想 path、または artifact label |
| `content_text` | text nullable | unified diff / log / raw JSON |
| `metadata_json` | json text nullable | tool name, file path, mime, language, size |
| `created_at` | integer timestamp | |

大きい payload を `activity_events.payload_json` に詰め続けない。event は索引・時系列・短い summary、artifact は内容本体を担当する。

## Event Kinds
v1 では event kind を細かくしすぎず、表示に必要な分類を固定する。

| Kind | Meaning | Rendering |
| --- | --- | --- |
| `user.message` | ユーザー入力 | user message |
| `assistant.delta` | streaming 中の assistant token / chunk | assistant turn に追記 |
| `assistant.message` | assistant の確定本文 | assistant message |
| `assistant.pause` | assistant turn が一時停止した | status row inside assistant turn |
| `assistant.resume` | 同じ assistant turn が再開した | status row inside assistant turn |
| `assistant.raw_output` | parse できない、または schema 外の raw 出力 | raw text block |
| `llm.request` | provider 呼び出し metadata。prompt 全文は policy に合わせ artifact 化 | JSON block |
| `llm.response_delta` | provider から来た raw delta | assistant turn または raw event block |
| `llm.response_final` | provider final response metadata / raw body | raw event block |
| `llm.decision_json` | routing / workflow / classification / supervisor decision | JSON block |
| `llm.schema_result` | parse / validation 成否 | JSON or status block |
| `llm.error` | provider / parse / schema の失敗 | error block |
| `runtime.decision` | runtime guard / retry / budget / resume / finalize decision | JSON block |
| `runtime.state` | SessionMemory / Todo / run state update | status or JSON block |
| `tool.call` | worker / MCP / shell / edit tool の呼び出し | tool block |
| `tool.result` | tool 成功結果 | tool block |
| `tool.error` | tool 失敗結果 | error block |
| `command.output` | shell / verification command の stdout/stderr chunk | log block |
| `file.diff` | unified diff | diff block |
| `file.patch` | `apply_patch` / `replace_content` の patch payload | diff block |
| `file.write` | file creation / replacement | file activity block |
| `verification.output` | test / build / command output | log block |
| `run.status` | run lifecycle | status row |
| `todo.status` | Todo lifecycle | status row |
| `transport.subscribe` | WebSocket / SSE subscribe | status row |
| `transport.replay` | replay backfill result | status row |
| `transport.publish` | live publish result | status row |
| `ui.optimistic` | UI optimistic item の作成・置換 | status row |
| `system.info` | runtime info | status row |
| `system.error` | runtime error | error block |
| `unknown.activity` | 既知 kind に分類できない activity | raw event block |

新しい kind を追加する場合は、backend schema union、frontend type、reducer、renderer、test fixture を同時に更新する。ただし未知 kind を保存しない選択はしない。分類できない activity は必ず `unknown.activity` として raw payload ごと保存する。

## Turn Grouping
### Turn ID Rules
`turn_id` は UI が同じ発話として表示すべき単位を表す。

- user submit ごとに user turn を作る。
- assistant が応答を開始したら assistant turn を作る。
- streaming delta、pause、resume、message、raw output は同じ assistant turn に紐づける。
- assistant が tool を使う場合、その tool call / result / diff も原則として同じ assistant turn に紐づける。
- tool result を受けて LLM が再度発話する場合でも、ユーザーから見て同じ応答継続なら同じ assistant turn を維持する。
- 新しい user input が入ったら次の turn に進む。

### Pause / Resume
LLM が途中で止まったように見えるケースを別 message にしない。

```text
assistant.delta turn=A "まず..."
assistant.pause turn=A
tool.call turn=A
tool.result turn=A
assistant.resume turn=A
assistant.delta turn=A "続きです..."
assistant.message turn=A final text
```

UI は turn A を 1 つの assistant 発話として表示し、その中に tool activity と diff を時系列で挿入する。

### Final Text
`assistant.delta` は live 表示に使う。`assistant.message` が保存されたら、それを確定本文にする。ただし delta と final の差分がある場合に情報を捨てないため、raw delta aggregate は `payload_json` または artifact に残す。

## Backend Implementation Plan
### Phase 0: Inventory
目的: 既存 emission point を洗い出し、最初の migration 範囲を固定する。

Tasks:
- `createRunEvent` 呼び出し箇所を一覧化する。
- `task_messages` 作成箇所を一覧化する。
- route handler 入口を一覧化する。
  - `POST /api/tasks/:id/messages`
  - `POST /api/workbench/sessions/:id/messages`
  - `GET /api/tasks/:id/messages`
  - `GET /api/runs/:id/events`
- `task_llm_delta` / `model.response_delta` / transient websocket event の作成箇所を一覧化する。
- `apply_patch` / `replace_content` / file edit tool result の payload 形を確認する。
- `llm.decision_json` として保存すべき supervisor decision payload を確認する。
- provider request / response / parse / schema validation の発生箇所を一覧化する。
- command output / verification output の chunk 発生箇所を一覧化する。
- UI optimistic message の作成箇所を一覧化する。

Done when:
- activity ledger に流すべき entrypoint が file path 単位で列挙されている。
- run がない intake と run 中 execution の両方が含まれている。
- 既知 kind に分類できない entrypoint は `unknown.activity` に流す候補として列挙されている。

Verification:
- `rg -n "createRunEvent|createTaskMessage|task_llm_delta|response_delta|apply_patch|replace_content|supervisor_decision|emitEvent|runCommand|run_verification|optimistic" api src`
- 見落とした activity 種別をこの計画に追記する。

### Phase 1: Add Activity Ledger Schema
目的: 既存挙動を壊さず、activity を保存できる DB を追加する。

Tasks:
- `api/db/schema.ts` に `activityEvents` と `activityArtifacts` を追加する。
- `api/db/bootstrap.ts` に `CREATE TABLE IF NOT EXISTS` を追加する。
- `drizzle/migrations/` に additive migration を追加する。
- type export を追加する。
- cleanup script に test data 削除を追加する。

Done when:
- local DB bootstrap で新 table が作られる。
- 既存 `task_events`, `task_messages`, `artifacts` は削除しない。

Verification:
- `pnpm verify`
- SQLite の `PRAGMA table_info(activity_events)` で column が存在する。
- migration snapshot が schema と一致する。

### Phase 2: Repository API
目的: すべての activity 保存を 1 箇所へ寄せる。

Tasks:
- `appendActivityEvent(input)` を追加する。
- `appendActivityArtifact(input)` を追加する。
- `listActivityEventsForTask(taskId, { afterSeq })` を追加する。
- `listActivityEventsForRun(runId, { afterSeq })` を追加する。
- task 単位 `seq` を transaction 内で採番する。
- `payload_json` に raw provider payload を残せるようにする。
- `kind` が未対応でも `unknown.activity` に正規化して保存する。
- `dedupe_key` / `client_temp_id` / `external_id` を受け取り、重複時は既存 row を返す。
- artifact と event を同一 transaction で保存する。

Done when:
- event append は必ず DB 書き込み後に created row を返す。
- websocket publish は created row の `id` / `seq` を使う。
- replay と live event が同じ payload shape になる。
- event append が失敗した場合、呼び出し元が failure を観測できる。

Verification:
- repository unit test で `seq` が task 単位に単調増加する。
- `afterSeq` replay が重複なく返る。
- artifact 付き event が取得できる。
- duplicate `dedupe_key` append が二重 row を作らない。
- unknown kind input が `unknown.activity` として保存される。

### Phase 3: Event Sink Adapter
目的: 既存 emission point を一気に壊さず、新 ledger に二重書き込みする。

Tasks:
- `recordActivity(input)` service を作る。
- `recordActivity(input)` は save-first の唯一の入口にする。保存前に WebSocket / response / in-memory buffer へ流す path を作らない。
- 既存 `createRunEvent` 後に対応する `activity_events` を保存する adapter を追加する。
- `task_messages` 作成時に `user.message` / `assistant.message` を保存する。
- transient streaming delta を `assistant.delta` として保存する。
- provider raw delta / final response / request metadata を `llm.*` として保存する。
- supervisor decision を `llm.decision_json` として保存する。
- runtime guard / retry / budget / resume / finalize decision を `runtime.*` として保存する。
- tool call / result / error を `tool.*` として保存する。
- `apply_patch` / `replace_content` の差分を `activity_artifacts(kind="diff" | "patch")` と `file.diff` / `file.patch` event として保存する。
- command stdout / stderr と verification output を artifact 付きで保存する。
- WebSocket subscribe / replay / publish failure を `transport.*` として保存する。
- parse 失敗、schema validation 失敗、provider の raw response、未知 event を保存する catch-all path を追加する。
- 保存対象外の activity 種別が見つかった場合は、実装を完了扱いにせず、この計画の event kind と adapter を更新する。

Done when:
- API / runtime / provider / worker / transport で発生した activity はすべて `activity_events` から復元できる。
- 既知 kind に分類できない activity も `unknown.activity` として復元できる。
- WebSocket で観測できた activity は、必ず同じ `id` / `seq` で DB replay からも取得できる。
- 既存 UI はまだ壊さず、旧 `task_messages` / `task_events` は互換表示の補助としてだけ併用できる。新規 activity の保存漏れを補う目的では使わない。

Verification:
- 手動実行で user message、assistant delta、assistant final、decision JSON、tool call、diff が DB に残る。
- parse 失敗、schema validation 失敗、tool 失敗、provider raw response、未知 event が DB に残る。
- WebSocket 未接続でも DB に activity が残る。
- WebSocket で受けた activity の `id` / `seq` を `GET /api/tasks/:id/activity-events?afterSeq=` で照合できる。
- `pnpm verify`

### Phase 4: Replay API And Realtime Contract
目的: UI が activity ledger だけで live と replay を扱えるようにする。

Tasks:
- `GET /api/tasks/:id/activity-events?afterSeq=` を追加する。
- `GET /api/runs/:id/activity-events?afterSeq=` を追加する。
- route response schema を `shared/schemas/nightworkers.schema` に追加する。
- WebSocket の publish payload を `activity_event_created` に統一する。
- subscribe 時に `taskId` と `afterSeq` を受け、DB replay 後に live tail へ入る。
- `transport.replay` event で replay 件数と cursor を保存する。
- publish 失敗時は `transport.publish` status=`failed` を保存する。
- 既存 `task_event_created` は互換期間だけ残す。

Done when:
- ページ読み込み時と WebSocket 再接続時に同じ event shape が使われる。
- `id` または `taskId:seq` で dedupe できる。
- replay API は `task_id` scope を基本にし、run がない intake activity も返す。
- run replay API は既存 run detail 画面用に同じ event shape を返す。

Verification:
- WebSocket を切断しても `afterSeq` replay で欠落が戻る。
- live event と replay event が二重表示されない。
- ownership / auth check は既存 run replay と同等に通る。
- run なし intake activity が task replay API で返る。

### Phase 5: Frontend Transcript Reducer
目的: React component が message 配列を直接 truth として扱わないようにする。

Tasks:
- `src/modules/nightworkers/activityTranscript.ts` を追加する。
- `dedupeAndSortActivityEvents(events)` を実装する。
- `buildTranscriptItems(events)` を実装する。
- `assistant.delta` / `assistant.message` / `assistant.pause` / `assistant.resume` を `turn_id` で束ねる。
- tool / diff / decision JSON は同じ turn 内の child item として保持する。
- fallback text を生成せず、raw text / raw JSON を表示する。
- `unknown.activity` を raw event block として表示する。
- `client_temp_id` が一致する optimistic item は DB row で置換する。

Initial types:

```ts
type TranscriptItem =
  | { kind: 'user_turn'; turnId: string; events: ActivityEvent[]; text: string }
  | { kind: 'assistant_turn'; turnId: string; events: ActivityEvent[]; text: string; children: TranscriptChild[] }
  | { kind: 'unknown'; event: ActivityEvent }
  | { kind: 'activity'; event: ActivityEvent };

type TranscriptChild =
  | { kind: 'tool'; events: ActivityEvent[] }
  | { kind: 'diff'; event: ActivityEvent; artifact?: ActivityArtifact }
  | { kind: 'json'; event: ActivityEvent }
  | { kind: 'log'; event: ActivityEvent; artifact?: ActivityArtifact }
  | { kind: 'status'; event: ActivityEvent };
```

Done when:
- 同じ input events から常に同じ transcript ができる。
- assistant pause/resume 後の delta が同じ assistant turn に入る。
- diff / decision JSON / tool result が消えない。

Verification:
- reducer unit tests:
  - streaming delta only
  - delta + final message
  - pause + resume
  - tool call + result + diff
  - decision JSON
  - unknown activity
  - optimistic item replacement
  - replay/live duplicate
  - run なし intake event

### Phase 6: ThreadTimeline Replacement Slice
目的: Chat 欄を activity transcript rendering に切り替える。

Tasks:
- `useNightWorkersWorkspace` で activity events を取得・保持する。
- 既存 `latestRunEvents` と `taskMessages` の merge 表示から、activity transcript 表示へ段階的に切り替える。
- `ThreadTimeline` は `TranscriptItem[]` を受け取る方向へ整理する。
- v1 では全 kind を表示する。
- `llm.decision_json` は JSON block として表示する。
- `tool.*` は tool block として表示する。
- `file.diff` / `file.patch` は diff block として表示する。
- `verification.output` は log block として表示する。
- `unknown.activity` は raw event block として表示する。
- optimistic user message は未確定表示にし、DB row 到着後に置換する。

Done when:
- Chat 欄で user message、assistant text、LLM raw activity、runtime decision、tool activity、diff、decision JSON、verification output、transport activity、unknown activity が同じ時系列に表示される。
- `showDebugEvents` による非表示に依存しない。
- 旧 streaming preview の一時 state が transcript と競合しない。
- DB に存在しない optimistic item が reload 後の履歴に残らない。

Verification:
- Playwright または in-app browser で、実行中に delta が出ることを確認する。
- 実行完了後に reload しても同じ transcript が復元される。
- page navigation 後に戻っても欠落しない。
- unknown activity fixture が UI に表示される。

### Phase 7: Remove Old Chat Truth Paths
目的: 新 ledger が安定した後、上書き・欠落の原因になる旧表示 path を削る。

Tasks:
- `taskMessages + latestRunEvents` をその場で混ぜる timeline construction を撤去する。
- websocket transient preview を truth として扱う state を撤去する。
- fallback assistant prose を生成する表示 path を撤去する。
- 旧 `task_event_created` 依存を互換期間後に削除する。
- `task_llm_delta` を DB 非永続の transient truth として扱う path を撤去する。

Done when:
- Chat 欄の transcript は activity ledger reducer だけから生成される。
- 旧 state path が新 transcript を上書きできない。
- 旧 path が残る場合は、activity ledger への adapter または read-only fallback としてのみ存在する。

Verification:
- `rg -n "activeStreamingResponse|showDebugEvents|task_llm_delta|task_event_created|latestRunEvents" src/modules/nightworkers`
- 残すものは互換・設定・別画面用途として理由を明記する。

## Rendering Requirements
v1 は全部表示する。

### Assistant Turn
- markdown を表示する。
- streaming 中は delta aggregate を表示する。
- final message が来たら final text を表示する。
- delta と final の両方が存在し、内容が異なる場合は raw delta を child block として残す。
- pause / resume は小さな status row として表示する。

### Tool Block
- tool name
- call id
- status
- arguments summary
- result summary
- raw payload JSON

### Diff Block
- file path
- operation
- unified diff
- tool name
- success / failure

### Decision JSON Block
- workflow
- routing hypothesis
- selected skill references
- decision phase
- raw JSON
- parse / schema status

### Raw LLM Block
- provider
- model
- request id / response id
- status
- raw delta / final body
- parse / schema result
- error payload if failed

### Runtime Decision Block
- decision phase
- routing hypothesis
- selected skill files
- guard / retry / budget state
- SessionMemory update summary
- raw JSON

### Verification Log Block
- command
- exit code
- stdout / stderr
- duration
- status

### Transport Block
- transport kind
- subscribe target
- replay cursor
- replay count
- publish status
- failure payload

### Unknown Activity Block
- original source
- original external id
- ingest error
- raw payload JSON
- artifact link if present

## Compatibility Strategy
既存 table はすぐに削除しない。

- `task_messages` は既存 API と履歴互換のため当面残す。
- `task_events` は run event 互換のため当面残す。
- 新規 UI は `activity_events` を優先する。新規 session / run で `activity_events` が空の場合は実装不備として扱う。
- `activity_events` がない古い session は旧 path で表示してよい。
- 新規 session / run は必ず activity ledger に保存する。
- 旧 path から読む fallback は古い session 専用とし、新規 activity の保存漏れを隠すために使わない。

## Acceptance Criteria
次のケースで Chat 欄が欠落・上書きしないこと。

1. user message が保存され、reload 後も表示される。
2. assistant streaming delta が live 表示される。
3. assistant final message が delta を不正に消さず、同じ turn に確定される。
4. LLM が pause 後に resume しても、同じ assistant 発話として表示される。
5. `llm.decision_json` が表示される。
6. tool call / result / error が表示される。
7. `apply_patch` / `replace_content` の diff が表示される。
8. verification output が表示される。
9. WebSocket 接続前に発生した event が replay で戻る。
10. live と replay の重複 event が二重表示されない。
11. page navigation / reload 後に同じ transcript が復元される。
12. run がない intake chat でも activity が保存・表示される。
13. parse 失敗、schema validation 失敗、provider raw response が保存・表示される。
14. 既知 kind に分類できない activity が `unknown.activity` として保存・表示される。
15. 保存対象外として破棄される activity が存在しない。
16. WebSocket で表示された activity は reload 後も同じ `id` / `seq` で表示される。
17. optimistic UI item は DB row に置換され、未保存 item が確定履歴に残らない。
18. transport subscribe / replay / publish failure が保存・表示される。
19. runtime guard / retry / budget / resume / finalize decision が保存・表示される。

## Verification Commands
Fast gate:

```bash
pnpm verify
```

Focused checks to add:

```bash
pnpm test src/modules/nightworkers/activityTranscript.test.ts
pnpm test api/modules/nightworkers/activity-ledger.test.ts
```

Manual DB checks:

```sql
SELECT seq, kind, source, status, turn_id, dedupe_key, ingest_error, text
FROM activity_events
WHERE task_id = ?
ORDER BY seq;
```

Completeness checks:

```sql
SELECT kind, COUNT(*)
FROM activity_events
WHERE task_id = ?
GROUP BY kind
ORDER BY kind;
```

```sql
SELECT ae.seq, ae.kind, aa.kind AS artifact_kind, aa.path
FROM activity_events ae
LEFT JOIN activity_artifacts aa ON aa.id = ae.artifact_id
WHERE ae.task_id = ?
ORDER BY ae.seq;
```

Manual UI checks:

- Chat で実装依頼を送る。
- streaming 中に tool event と delta が表示される。
- LLM decision JSON、provider raw response、runtime decision が表示される。
- reload する。
- 同じ user / assistant / decision JSON / raw LLM / runtime / tool / diff / verification / transport / unknown が戻る。

## Risks
### Duplicate Storage
`task_messages`, `task_events`, `activity_events` の二重書き込み期間は不整合が起きやすい。

Mitigation:
- 新 UI は activity ledger を優先する。
- 旧 table は互換用途としてだけ読む。
- adapter test で同一 action の activity event 作成を確認する。

### Seq Race
同じ task に並列で event append すると seq が衝突する可能性がある。

Mitigation:
- repository transaction で `max(seq) + 1` を採番する。
- SQLite の write lock 前提でも test で並列 append を確認する。

### Payload Bloat
diff や log を event JSON に詰めると replay が重くなる。

Mitigation:
- 大きい本文は artifact に保存する。
- event は summary と artifact reference を持つ。

### UI Overload
v1 は全部表示するため、Chat 欄が情報過多になる。

Mitigation:
- これは意図的に受け入れる。
- `visibility` と `kind` を保存しておき、後日 filter を追加できるようにする。

## First Implementation Slice
最初の PR / commit はここまでに絞る。

1. `activity_events` / `activity_artifacts` schema 追加
2. repository append / replay API 追加
3. Phase 0 で列挙したすべての emission point から `recordActivity` へ接続
4. user / assistant / LLM provider / runtime decision / worker tool / file diff / verification / transport / unknown activity の保存
5. activity replay endpoint 追加
6. transcript reducer と unit test
7. completeness DB check と replay check

この slice では UI の完全切り替えを無理に終わらせない。ただし保存は部分対応にしない。まず「DB に全部残る」「WebSocket で見えた activity は replay でも戻る」「同じ event から transcript を復元できる」を証明する。

この slice の完了条件:

- Phase 0 の inventory に保存対象外の entrypoint が残っていない。
- 新規 session / run の全 activity が `activity_events` に保存される。
- 分類できない activity は `unknown.activity` として保存される。
- 旧 `task_messages` / `task_events` にだけ存在し、`activity_events` に存在しない新規 activity がない。
- UI の完全切り替えが未完でも、DB replay から完全な transcript input を復元できる。

### First Slice Implementation Status
実装開始時点の first slice では、次を追加した。

- `activity_events` / `activity_artifacts` schema、bootstrap、migration
- `appendActivityEvent` / `appendActivityArtifact`
- `GET /api/tasks/:id/activity-events?afterSeq=`
- `GET /api/runs/:id/activity-events?afterSeq=`
- `task_messages` から `user.message` / `assistant.message` / `tool.result` / `system.info` への保存
- `tool_diff` message metadata から `file.patch` / `file.diff` artifact への保存
- `createRunEvent` から `assistant.delta`、`llm.*`、`tool.*`、`verification.output`、`run.status`、`runtime.*`、`system.*` への保存
- `activity_event_created` WebSocket event
- frontend activity event query/cache
- `buildTranscriptItems` reducer と focused unit test

この時点では Chat 欄 renderer の完全置換は未完了。次の実装では `ThreadTimeline` を activity transcript 起点に切り替え、旧 `taskMessages + latestRunEvents` 合成表示を撤去する。

## Report Format After Implementation
実装完了時は次を報告する。

- 追加した table / endpoint / reducer
- activity ledger に保存できる event kind
- Phase 0 inventory の全 entrypoint と保存対応状況
- `activity_events` に保存できなかった activity が 0 件であること
- `unknown.activity` として保存された activity の件数と raw payload の確認結果
- replay / dedupe の検証結果
- UI で表示できる event kind
- 次に切り替えるべき旧 Chat path
