# Task Generation Tree Table Design

## 目的

タスク生成画面を、`Goal -> Mission -> TaskCandidate` の3層を展開・折りたたみできる単一テーブル風の表示へ再設計する。

ここでいう「テーブル」は、DBテーブルではなく画面上の見え方を指す。Goal、Mission、TaskCandidate を別パネルに分けず、1つの一覧の中で階層関係を読めるようにする。

## 結論

画面上の基本構造は次の3層に固定する。

```text
Goal
  Mission
    TaskCandidate
    TaskCandidate
  TaskCandidate
  TaskCandidate

Goal
  Mission
    TaskCandidate
```

`TaskCandidate` と `TaskProposal` は同義として扱う。ユーザーに見える設計語彙、画面文言、表示行モデルでは `TaskCandidate` に統一する。

Mission 分解から生成されるものも、Goal から直接生成されるものも、どちらも `TaskCandidate` として表示する。生成元の違いが必要な場合は別概念を作らず、`origin` や `missionId` で表す。

実装は一度にDB統合まで進めない。最初の実装単位では、既存の永続化モデルを読み取り、画面境界で `TaskCandidate` に正規化して表示と操作を統一する。その後、永続化モデルを `TaskCandidate` に寄せる。

## レビュー結果

この設計を実装可能な粒度へ落とすため、次の不足を補う。

1. 既存コードとの接続点が抽象的だった。
   - `ProjectDetailScreen.tsx`、`nightWorkersCommands.ts`、`project-detail.schema.ts`、`mission-planner.schema.ts`、`mission-planner.routes.ts` のどこを触るかを明記する。
2. `TaskCandidate` と `TaskProposal` の統一が概念説明に留まっていた。
   - Phase 1 では互換アダプタで表示を統一し、Phase 2 で永続化モデルを統一する。
3. 既存 `MissionTaskProposal` は `TaskCandidate` と同一フィールドを持っていない。
   - UI用の正規化ルールを定義し、欠ける値はその場の推測ではなく `null` または既存フィールドからの明示的な変換に限定する。
4. UI状態の遷移条件が粗かった。
   - 展開、選択、詳細モーダル、busy action、データ再読込の責務を分ける。
5. API変更がPhaseごとに分かれていなかった。
   - Phase 1 は既存APIを維持し、Phase 2/3 で追加・置換するAPIを分ける。

## 非目標

- DBを物理的に1テーブルへ統合すること。
- `Goal`、`Mission`、`TaskCandidate` 以外の画面階層を追加すること。
- `TaskCandidate` と `TaskProposal` をユーザー向けに別概念として表示すること。
- 行全体クリックで詳細を開くこと。
- 既存の Queue、Worker、Plan mode の実行モデルをこの設計で作り直すこと。

## 用語

### Goal

最上位の目的。タスク生成の親単位であり、単一テーブル内の最上位行として表示する。

Goal は配下に Mission と TaskCandidate を持てる。大きな作業は Mission として、すぐ Task 化できる作業は TaskCandidate として Goal 配下に表示する。

### Mission

TaskCandidate へ分解するための中間単位。規模が大きく、すぐに Task として実行するには粗い生成物を Mission とする。

Mission は Goal 配下に表示され、展開するとその Mission から分解された TaskCandidate を表示する。

### TaskCandidate

Task 化できる候補。Goal から直接生成された候補も、Mission 分解によって生成された候補も、同じ TaskCandidate として扱う。

旧来の `TaskProposal` は画面設計上の別概念として扱わない。移行中に内部実装名として残る場合でも、UI、共有される設計語彙、新規API、テスト名では TaskCandidate へ寄せる。

## 画面構造

### 単一テーブル風の表示

Mission タブ内の Goal 定義、Mission 候補、Task 候補の分離パネルを、1つのテーブル風コンポーネントにまとめる。

```text
+--------+-----+-----------------------------+-------------+------+--------+------+--------+----------+
| Open   | Sel | Title                       | Kind        | Stat | Impact | Size | Score  | Actions  |
+--------+-----+-----------------------------+-------------+------+--------+------+--------+----------+
| v      |     | Goal title                  | Goal        | on   | -      | -    | -      | ...      |
|   v    |     | Mission title               | Mission     | draft| -      | -    | -      | ...      |
|        | [ ] | TaskCandidate title         | Candidate   | cand | +20    | med  | 80/90  | ...      |
|        | [ ] | TaskCandidate title         | Candidate   | cand | +10    | small| 70/85  | ...      |
|        | [ ] | TaskCandidate title         | Candidate   | cand | +15    | big  | 90/70  | ...      |
```

階層はインデントと展開ボタンで表す。Goal/Signal 列は持たない。Goal は親行として表現し、Signal は詳細モーダルや内部生成入力に閉じ込める。

### 行の種類

画面の行モデルは3種類だけにする。

```ts
type TaskGenerationTreeRow =
  | {
      kind: 'goal';
      id: string;
      depth: 0;
      goal: MissionGoal;
      childCounts: {
        missions: number;
        taskCandidates: number;
      };
    }
  | {
      kind: 'mission';
      id: string;
      depth: 1;
      parentGoalId: string;
      mission: Mission;
      childCounts: {
        taskCandidates: number;
      };
    }
  | {
      kind: 'task_candidate';
      id: string;
      depth: 1 | 2;
      parentGoalId: string | null;
      parentMissionId: string | null;
      candidate: TaskCandidate;
    };
```

`TaskCandidate` は単一の定義にする。

```ts
type TaskCandidate = {
  id: string;
  repositoryId: string;
  goalId: string | null;
  missionId: string | null;
  origin: 'goal_generation' | 'mission_decomposition';
  title: string;
  summary: string;
  rationale: string;
  evaluationContribution: number | null;
  importancePercent: number;
  confidencePercent: number;
  tokenSize: 'huge' | 'big' | 'medium' | 'small' | 'tiny';
  complexity: 'very_complex' | 'complex' | 'moderate' | 'simple' | 'trivial';
  taskPrompt: string;
  acceptanceCriteria: string;
  verificationPlan: string;
  status: 'candidate' | 'task_created' | 'dismissed';
  taskId: string | null;
};
```

`origin` は表示ラベルを分けるための主概念ではない。詳細やデバッグで生成元を示すための補助情報に留める。

## 既存コードとの接続

### 主な変更対象

Phase 1 の主対象は次のファイルである。

| ファイル | 役割 |
| --- | --- |
| `src/modules/nightworkers/components/ProjectDetailScreen.tsx` | 既存の3パネルを tree table と詳細モーダルへ置き換える。 |
| `src/modules/nightworkers/nightWorkersCommands.ts` | Phase 1 では既存API呼び出しを維持する。UI側では `UnifiedTaskCandidate` adapter から既存APIへ分岐する。 |
| `src/i18n/dictionaries/ja.ts` | ユーザー向け文言から Proposal を消し、TaskCandidate 語彙へ寄せる。 |
| `src/i18n/dictionaries/en.ts` | 英語文言も同じ語彙へ寄せる。 |
| `tests/project-detail-screen.test.tsx` | tree table、展開、タイトルクリック、選択、列表示を検証する。 |
| `tests/project-detail-backend.test.ts` | 既存 candidate 作成・dismiss・Task化の回帰を確認する。 |
| `tests/mission-planner.test.ts` | Phase 1 では既存 proposal API の回帰を確認する。Phase 2 で TaskCandidate API へ更新する。 |

Phase 2 以降で触る主対象は次のファイルである。

| ファイル | 役割 |
| --- | --- |
| `shared/schemas/project-detail.schema.ts` | `TaskCandidate` の最終形を定義する。 |
| `shared/schemas/mission-planner.schema.ts` | `MissionTaskProposal` を新規設計から外し、互換schemaへ移す。 |
| `api/db/project-detail-schema.ts` | `mission_task_candidates` に `missionId` / `origin` / source metadata を追加する。 |
| `api/db/mission-planner-schema.ts` | `mission_task_proposals` の廃止または互換読み取り化を行う。 |
| `api/modules/project-detail/project-detail.service.ts` | Goal 直下 TaskCandidate 生成とTask化の正本にする。 |
| `api/modules/mission-planner/mission-planner.service.ts` | Mission分解結果を TaskCandidate として保存する。 |
| `api/modules/mission-planner/mission-planner.routes.ts` | proposal API を TaskCandidate API へ置換または互換化する。 |

### Phase 1 のデータ取得

Phase 1 は既存APIを使ってよい。

```ts
const [goalsRes, missionsRes, candidatesRes, proposalsRes] = await Promise.all([
  fetchMissionGoals(project.id),
  fetchMissions(project.id),
  fetchMissionTaskCandidates(project.id),
  fetchRepositoryMissionTaskProposals(project.id),
]);
```

ただし、コンポーネント境界では `proposalCandidates` という概念を表に出さない。読み取った `MissionTaskProposal[]` は `TaskCandidate` 表示行へ正規化してから tree table に渡す。

## TaskCandidate 正規化

### UI正規化型

Phase 1 では永続化モデルをすぐに統一しないため、UI境界に互換型を置く。

```ts
type TaskCandidateOrigin = 'goal_generation' | 'mission_decomposition';

type TaskCandidateSourceRef =
  | { source: 'mission_task_candidate'; id: string }
  | { source: 'mission_task_proposal'; id: string };

type UnifiedTaskCandidate = {
  id: string;
  repositoryId: string;
  goalId: string | null;
  missionId: string | null;
  origin: TaskCandidateOrigin;
  sourceRef: TaskCandidateSourceRef;
  title: string;
  summary: string;
  rationale: string;
  evaluationContribution: number | null;
  importancePercent: number | null;
  confidencePercent: number | null;
  tokenSize: 'huge' | 'big' | 'medium' | 'small' | 'tiny' | null;
  complexity: 'very_complex' | 'complex' | 'moderate' | 'simple' | 'trivial' | null;
  taskPrompt: string;
  acceptanceCriteria: string;
  verificationPlan: string;
  status: 'candidate' | 'task_created' | 'dismissed';
  taskId: string | null;
};
```

`UnifiedTaskCandidate` は Phase 1 だけの互換型である。画面表示、選択、詳細モーダル、Task化はこの型だけを見る。

### MissionTaskCandidate からの変換

```ts
function fromMissionTaskCandidate(candidate: MissionTaskCandidate): UnifiedTaskCandidate {
  return {
    id: `mission_task_candidate:${candidate.id}`,
    repositoryId: candidate.repositoryId,
    goalId: candidate.goalId,
    missionId: null,
    origin: 'goal_generation',
    sourceRef: { source: 'mission_task_candidate', id: candidate.id },
    title: candidate.title,
    summary: candidate.summary,
    rationale: candidate.rationale,
    evaluationContribution: candidate.evaluationContribution,
    importancePercent: candidate.importancePercent,
    confidencePercent: candidate.confidencePercent,
    tokenSize: candidate.tokenSize,
    complexity: candidate.complexity,
    taskPrompt: candidate.taskPrompt,
    acceptanceCriteria: candidate.acceptanceCriteria,
    verificationPlan: candidate.verificationPlan,
    status: candidate.status === 'selected' ? 'candidate' : candidate.status,
    taskId: candidate.taskId,
  };
}
```

`selected` は現在の画面操作では独立表示しない。Phase 1 の表示では `candidate` と同じ選択可能候補として扱う。

### MissionTaskProposal からの変換

既存 `MissionTaskProposal` は Mission分解から来た TaskCandidate とみなす。

```ts
function fromMissionTaskProposal(proposal: MissionTaskProposal): UnifiedTaskCandidate {
  return {
    id: `mission_task_proposal:${proposal.id}`,
    repositoryId: proposal.repositoryId,
    goalId: null,
    missionId: proposal.missionId,
    origin: 'mission_decomposition',
    sourceRef: { source: 'mission_task_proposal', id: proposal.id },
    title: proposal.title,
    summary: proposal.summary,
    rationale: proposal.expectedOutcome,
    evaluationContribution: null,
    importancePercent: null,
    confidencePercent: null,
    tokenSize: null,
    complexity: null,
    taskPrompt: proposal.initialPrompt,
    acceptanceCriteria: proposal.acceptanceCriteria.join('\n'),
    verificationPlan: proposal.verificationGate.join('\n'),
    status: proposal.status === 'proposed' ? 'candidate' : proposal.status,
    taskId: proposal.taskId,
  };
}
```

重要度、信頼度、サイズ、複雑度は `MissionTaskProposal` から推測しない。Phase 1 では `-` として表示する。risk から重要度や複雑度を作る暫定変換は、同じ定義にする方針と衝突するため採用しない。

### Task化の分岐

画面上は同じ `TaskCandidate` として選択するが、Phase 1 の保存元は2種類あるため、Task化時だけ `sourceRef` で既存APIを分岐する。

```ts
const selectedGoalCandidateIds = selectedCandidates
  .filter((candidate) => candidate.sourceRef.source === 'mission_task_candidate')
  .map((candidate) => candidate.sourceRef.id);

const selectedMissionCandidateIds = selectedCandidates
  .filter((candidate) => candidate.sourceRef.source === 'mission_task_proposal')
  .map((candidate) => candidate.sourceRef.id);
```

この分岐は UI の概念分離ではなく、互換期間の API adapter である。ボタン、テーブル、詳細モーダル、文言では分岐を見せない。

## 展開と折りたたみ

展開状態はUIローカル状態として持つ。

```ts
type ExpandedState = {
  goalIds: Set<string>;
  missionIds: Set<string>;
};
```

初期状態:

- 初回表示時は、子要素を持つ active Goal を展開する。
- Mission は初回表示時に折りたたむ。
- ユーザーが展開状態を変更した後は、データ再読込で同じ id が残っている限り展開状態を維持する。
- id が消えた Goal / Mission は展開状態から除外する。

表示ルール:

1. Goal 行は常に表示する。
2. Goal が展開されている場合、その直下の Mission と Goal 直下 TaskCandidate を表示する。
3. Mission が展開されている場合、その Mission 配下の TaskCandidate を表示する。
4. TaskCandidate は終端行であり、展開ボタンを持たない。

Goal 配下に TaskCandidate と Mission が混在する場合、並び順は次を基本にする。

1. Mission。
2. Goal 直下 TaskCandidate。

Mission 配下 TaskCandidate は Mission の下にのみ表示する。同じ TaskCandidate を Goal 直下にも重複表示しない。

### 行構築ルール

tree table 用の行構築は `buildTaskGenerationTreeRows(...)` に閉じ込める。

```ts
type BuildTaskGenerationTreeRowsInput = {
  goals: MissionGoal[];
  missions: Mission[];
  candidates: UnifiedTaskCandidate[];
  expanded: ExpandedState;
};
```

親子関係:

1. Mission の親 Goal は `mission.sourceGoalIds[0]` を primary parent とする。
2. Mission が複数 Goal に紐づく場合、表示上は primary parent の下に1回だけ出す。
3. Mission が `sourceGoalIds` を持たない場合は、互換用の読み取り専用 Goal 行 `__unassigned__` の下に出す。
4. TaskCandidate が `missionId` を持つ場合は、その Mission 配下に出す。
5. TaskCandidate が `missionId` を持たず `goalId` を持つ場合は、その Goal 直下に出す。
6. TaskCandidate が `missionId` も `goalId` も持たない場合は、互換用の読み取り専用 Goal 行 `__unassigned__` の下に出す。

`__unassigned__` は Phase 1 の互換表示であり、ユーザーが作成・編集・削除する本物の Goal ではない。最終状態では、生成・分解された Mission / TaskCandidate は必ず Goal に紐づくことを目指す。

並び順:

1. Goal は既存の `sortOrder`、次に `createdAt`。
2. Goal 配下では Mission を先に表示し、次に Goal 直下 TaskCandidate を表示する。
3. Mission と TaskCandidate は `createdAt` の新しい順を基本にする。
4. `__unassigned__` は最後に表示する。

### 展開操作

- Goal の chevron を押すと `expanded.goalIds` を toggle する。
- Mission の chevron を押すと `expanded.missionIds` を toggle する。
- タイトルクリック、checkbox、Actions は展開状態を変えない。
- 展開中の Mission が削除されたら、その Mission id を `expanded.missionIds` から除外する。

## タイトルクリックと詳細モーダル

詳細表示は各行のタイトルクリックで開く。行全体クリックにはしない。

```text
Goal title              -> GoalDetailModal
  Mission title         -> MissionDetailModal
    TaskCandidate title -> TaskCandidateDetailModal
  TaskCandidate title   -> TaskCandidateDetailModal
```

展開ボタン、選択チェックボックス、Actions と詳細表示が干渉しないよう、クリック対象はタイトルテキストまたはタイトルボタンに限定する。

```ts
type DetailModalState =
  | { kind: 'goal'; id: string }
  | { kind: 'mission'; id: string }
  | { kind: 'task_candidate'; id: string }
  | null;
```

詳細対象の解決:

- `goal` は `goals.find((goal) => goal.id === id)` で解決する。
- `mission` は `missions.find((mission) => mission.id === id)` で解決する。
- `task_candidate` は `UnifiedTaskCandidate.id` で解決する。
- 再読込後に対象が見つからない場合、modal を閉じる。

### GoalDetailModal

表示する情報:

- title。
- goalText。
- active。
- 配下 Mission 件数。
- 配下 TaskCandidate 件数。

操作:

- 編集。
- active 切替。
- 削除。
- Goal配下のタスク生成。

制約:

- `__unassigned__` の GoalDetailModal は開かない。タイトルクリックも無効にする。

### MissionDetailModal

表示する情報:

- title。
- goalText。
- nonGoals。
- status。
- statusReason。
- parent Goal。
- 配下 TaskCandidate 件数。

操作:

- タスク分解。
- draft Mission の削除。
- 閉じる。

制約:

- タスク分解中は同じ Mission の分解ボタンを disabled にする。
- `review_pending` または `active` の Mission は、既存実装に合わせて通常の分解ボタンを disabled にする。
- draft 以外の Mission は削除できない。

### TaskCandidateDetailModal

表示する情報:

- title。
- summary。
- rationale。
- taskPrompt。
- acceptanceCriteria。
- verificationPlan。
- evaluationContribution。
- tokenSize。
- importancePercent。
- confidencePercent。
- complexity。
- parent Goal。
- parent Mission。

操作:

- Task 化。
- dismiss。
- 閉じる。

制約:

- `status === 'task_created'` の候補は Task 化できない。
- `status === 'dismissed'` の候補は通常一覧に出さない。
- Phase 1 では詳細モーダルからの単体 Task 化も、テーブル選択からの一括 Task 化と同じ adapter を使う。

## UI状態

`ProjectDetailScreen` では、少なくとも次の状態を分けて保持する。

```ts
const [expanded, setExpanded] = useState<ExpandedState>({
  goalIds: new Set(),
  missionIds: new Set(),
});
const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
const [detailModal, setDetailModal] = useState<DetailModalState>(null);
const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
const [busyAction, setBusyAction] = useState<string | null>(null);
```

状態遷移:

| 操作 | 更新する状態 | 更新しない状態 |
| --- | --- | --- |
| Goal chevron | `expanded.goalIds` | selection / modal |
| Mission chevron | `expanded.missionIds` | selection / modal |
| TaskCandidate checkbox | `selectedCandidateIds` | expanded / modal |
| title click | `detailModal` | expanded / selection |
| dismiss | `selectedCandidateIds` から対象を除外し再読込 | expanded は残存idのみ維持 |
| Task化 | `selectedCandidateIds` を空にして再読込 | expanded は残存idのみ維持 |
| Mission分解 | 再読込し、対象 Mission を展開状態にする | selection |
| Goal生成 | 再読込し、対象 Goal を展開状態にする | selection |

`busyAction` は操作種別と対象idを含める。

```ts
type BusyAction =
  | `goal:save`
  | `goal:generate:${string}`
  | `mission:decompose:${string}`
  | `mission:delete:${string}`
  | `candidate:dismiss:${string}`
  | `candidate:create-tasks`;
```

既存実装の `string | null` を維持してもよいが、値はこの形に寄せる。

## テーブル列

列は既存のタスク候補列を基本にする。ただし Goal/Signal は列として表示しない。

| 列 | Goal | Mission | TaskCandidate |
| --- | --- | --- | --- |
| 展開 | あり | あり | なし |
| 選択 | なし | なし | あり |
| タイトル | クリック可能 | クリック可能 | クリック可能 |
| 種別 | Goal | Mission | Candidate |
| 状態 | active/inactive | mission status | candidate status |
| 評価寄与 | - | - | evaluationContribution |
| サイズ | - | - | tokenSize |
| 重要度 | - | - | importancePercent |
| 信頼度 | - | - | confidencePercent |
| 複雑度 | - | - | complexity |
| 操作 | edit / active切替 / delete / generate | decompose / delete if no current children | create task / dismiss |

Goal と Mission は集約行なので、TaskCandidate 専用の数値列は `-` にする。

## 生成フロー

### Goal からのタスク生成

Goal 配下で「タスク生成」を実行すると、LLM は生成物を `Mission` または `TaskCandidate` として返す。

```ts
type GenerateTaskGenerationItemsResult = {
  schemaVersion: 'nightworkers.task-generation-items/v1';
  items: Array<
    | {
        kind: 'mission';
        title: string;
        goalText: string;
        nonGoals: string[];
        sourceGoalIds: string[];
        rationale: string;
      }
    | {
        kind: 'task_candidate';
        goalId: string | null;
        title: string;
        summary: string;
        rationale: string;
        evaluationContribution: number | null;
        importancePercent: number;
        confidencePercent: number;
        tokenSize: TaskCandidate['tokenSize'];
        complexity: TaskCandidate['complexity'];
        taskPrompt: string;
        acceptanceCriteria: string;
        verificationPlan: string;
      }
  >;
};
```

分類はキーワード判定で行わない。LLM の structured output と prompt 指示で `kind` を選ばせる。

判断基準:

- すぐに実装 Task として扱える粒度なら `task_candidate`。
- 複数 Task へ分解すべき粒度なら `mission`。
- 完了条件や検証が複数領域にまたがるものは原則 `mission`。

### Mission からのタスク分解

Mission の「タスク分解」を実行すると、分解結果は `TaskCandidate` として Mission 配下に追加する。

この経路で生成された TaskCandidate も、Goal から直接生成された TaskCandidate と同じ列、同じ詳細モーダル、同じ Task 化操作を使う。

## 既存実装からの移行方針

### Phase 1: UI統合

既存APIを大きく変えず、まず表示モデルを統合する。

- `GoalDefinitionsPanel`、`MissionPlannerPanel`、`MissionGenerateTasksPanel` を1つの tree table へ置き換える。
- `MissionTaskProposal` は UI 行へ取り込む時点で `TaskCandidate` 相当へ正規化する。
- ユーザー向け文言では `Proposal` を出さない。
- 既存の Task 化APIが内部的に分かれていても、画面操作は「選択した TaskCandidate を Task 化」に統一する。

Phase 1 で追加するコンポーネントと helper:

```text
ProjectDetailScreen
  - buildUnifiedTaskCandidates(...)
  - buildTaskGenerationTreeRows(...)
  - TaskGenerationTreeTable
  - GoalDetailModal
  - MissionDetailModal
  - TaskCandidateDetailModal
```

Phase 1 で削除または置き換える既存表示:

```text
GoalDefinitionsPanel      -> Goal row + GoalDetailModal
MissionPlannerPanel       -> Mission row + MissionDetailModal
MissionGenerateTasksPanel -> TaskCandidate rows + TaskCandidateDetailModal
```

Phase 1 で維持する既存API:

```text
GET    /api/repositories/:repositoryId/mission-goals
GET    /api/repositories/:repositoryId/missions
GET    /api/repositories/:repositoryId/mission-task-candidates?status=candidate
GET    /api/repositories/:repositoryId/mission-task-proposals?status=proposed
POST   /api/repositories/:repositoryId/mission-task-candidates/generate
POST   /api/repositories/:repositoryId/missions/generate-candidates
POST   /api/missions/:missionId/decompose
POST   /api/repositories/:repositoryId/mission-task-candidates/create-tasks
POST   /api/mission-task-proposals/create-tasks
POST   /api/mission-task-proposals/:proposalId/dismiss
PATCH  /api/mission-task-candidates/:candidateId
DELETE /api/missions/:missionId
```

Phase 1 では、新しい backend endpoint を必須にしない。見え方と操作語彙を先に統一し、永続化統合は Phase 2 へ回す。

### Phase 2: TaskCandidateモデル統一

Mission 分解結果の永続化名とAPI名を TaskCandidate に寄せる。

- Mission 分解結果の保存先を TaskCandidate として扱えるようにする。
- `missionId` と `origin` を TaskCandidate に持たせる。
- `TaskProposal` という共有schema/API名を新規設計から外す。

Phase 2 のDB移行方針:

1. `mission_task_candidates` に次を追加する。
   - `mission_id nullable references missions(id) on delete cascade`
   - `origin text not null default 'goal_generation'`
   - `source_planning_result_id nullable`
   - `source_decomposition_task_id nullable`
   - `expected_outcome nullable`
   - `implementation_focus_json nullable`
   - `dependencies_json nullable`
   - `target_files_or_modules_json nullable`
   - `approval_required boolean default false`
   - `scheduling_json nullable`
2. 既存 `mission_task_proposals` を `mission_task_candidates` へ backfill する。
3. Queue metadata handoff に必要な proposal metadata は、TaskCandidate の `origin === 'mission_decomposition'` と source fields から復元する。
4. backfill 後も1リリース分は旧 proposal API を互換読み取りとして残してよい。
5. 新規保存は `mission_task_candidates` のみにする。

Phase 2 の schema / prompt 方針:

1. Mission分解の task output schema を `TaskCandidate` と同じ必須フィールドへ寄せる。
2. Mission分解から来る候補も、次を必須にする。
   - `evaluationContribution`
   - `importancePercent`
   - `confidencePercent`
   - `tokenSize`
   - `complexity`
   - `taskPrompt`
   - `acceptanceCriteria`
   - `verificationPlan`
3. `expectedOutcome`、`implementationFocus`、`dependencies`、`targetFilesOrModules`、`approvalRequired`、`scheduling` は TaskCandidate の補助metadataとして保存する。画面上の別概念にはしない。
4. Queue metadata handoff は、補助metadataを読む。補助metadataがない TaskCandidate では既存の通常 Task 作成と同じ扱いにする。

Phase 2 のAPI方針:

```text
GET  /api/repositories/:repositoryId/mission-task-candidates?status=candidate
POST /api/repositories/:repositoryId/mission-task-candidates/create-tasks
POST /api/mission-task-candidates/:candidateId/dismiss
```

Mission分解から来た候補も同じ endpoint で返す。`missionId` がある行は Mission 配下に表示する。

### Phase 3: 生成API統合

Goal からの生成を、Mission と TaskCandidate を同時に返せるAPIへ統合する。

- Goal 直下の生成結果が Mission と TaskCandidate の混在を許す。
- 既存の「Mission候補生成」と「Task候補生成」の分離ボタンを、画面上は「タスク生成」へ寄せる。
- 生成結果は tree table に即時反映する。

Phase 3 の追加API:

```text
POST /api/repositories/:repositoryId/task-generation-items/generate
```

入力:

```ts
type GenerateTaskGenerationItemsRequest = {
  goalIds?: string[];
  includeInactiveGoals?: boolean;
};
```

出力:

```ts
type GenerateTaskGenerationItemsResponse = {
  status: 'completed';
  missions: Mission[];
  candidates: TaskCandidate[];
};
```

既存の2ボタンはこのAPIに寄せる。内部で `Mission` と `TaskCandidate` を同時に保存する。

## 実装手順

### Step 1: UI互換型と正規化 helper

`ProjectDetailScreen.tsx` に `UnifiedTaskCandidate`、`TaskGenerationTreeRow`、`buildUnifiedTaskCandidates(...)` を追加する。

完了条件:

- `MissionTaskCandidate[]` と `MissionTaskProposal[]` から1つの `UnifiedTaskCandidate[]` が作れる。
- UI表示上の文言に Proposal が出ない。
- 既存の candidate/proposal Task化APIを呼び分けるための `sourceRef` が残る。

### Step 2: tree row builder

`buildTaskGenerationTreeRows(...)` を追加する。

完了条件:

- Goal、Mission、TaskCandidate の3種類だけを返す。
- Goal/Signal 列を必要としない。
- `__unassigned__` 互換行を最後に出せる。
- 展開状態に応じて children を出し分ける。

### Step 3: table component

`TaskGenerationTreeTable` を追加し、Mission タブの3パネルを置き換える。

完了条件:

- chevron、checkbox、title button、Actions がそれぞれ独立して動く。
- TaskCandidate 行だけ checkbox を持つ。
- title button だけが detail modal を開く。
- 行全体クリックは detail modal を開かない。

### Step 4: detail modals

既存の Goal dialog、Mission candidate modal、candidate/proposal drawers を整理し、3種類の detail modal に寄せる。

完了条件:

- Goal title -> `GoalDetailModal`。
- Mission title -> `MissionDetailModal`。
- TaskCandidate title -> `TaskCandidateDetailModal`。
- modal 内の Task化、dismiss、分解、削除は既存API adapter を使う。

### Step 5: i18n

`src/i18n/dictionaries/ja.ts` と `src/i18n/dictionaries/en.ts` を更新する。

完了条件:

- ユーザー向け文言に `proposal` / `提案` を別概念として出さない。
- `TaskCandidate` は日本語では原則「タスク候補」に統一する。
- `Goal/Signal` 列名を使わない。

### Step 6: tests

UIテストを先に更新し、必要に応じて backend 回帰テストを維持する。

完了条件:

- `tests/project-detail-screen.test.tsx` が tree table の表示と操作を検証する。
- `tests/project-detail-backend.test.ts` の candidate 生成、dismiss、Task化テストが通る。
- `tests/mission-planner.test.ts` の Mission分解、旧 proposal API、Queue metadata handoff 回帰が通る。

## 実装上の注意

- 表示統合と永続化統合を混同しない。最初に統合するのは見え方である。
- `TaskCandidate` と `TaskProposal` を画面上で併記しない。
- `Goal/Signal` 列を復活させない。Goal は親行で表す。
- 詳細モーダルはタイトルクリックで開く。行全体クリックにはしない。
- 展開状態、選択状態、詳細モーダル状態は分けて管理する。
- TaskCandidate の選択は TaskCandidate 行だけで許可する。

## 受け入れ条件

1. Mission タブに、Goal、Mission、TaskCandidate が1つの単一テーブル風表示で表示される。
2. Goal 行を展開すると、配下の Mission と Goal 直下 TaskCandidate が表示される。
3. Mission 行を展開すると、配下の TaskCandidate が表示される。
4. TaskCandidate と TaskProposal がユーザー向け表示で分離されていない。
5. Goal/Signal 列が存在しない。
6. Goal、Mission、TaskCandidate のタイトルクリックで、それぞれ対応する詳細モーダルが開く。
7. 行全体クリックでは詳細モーダルが開かない。
8. TaskCandidate 行だけが選択でき、選択した TaskCandidate を Task 化できる。
9. Mission 行からタスク分解を実行でき、結果が同じ TaskCandidate として表示される。
10. 現在の子 TaskCandidate を持たない Mission は削除でき、子を持つ Mission は削除できない。過去に dismiss / task_created になった候補は削除ブロックに使わない。
11. TaskCandidate は dismiss できる。

## 検証計画

### UIテスト

- Goal 行の展開・折りたたみ。
- Mission 行の展開・折りたたみ。
- Goal タイトルクリックで Goal detail modal が開く。
- Mission タイトルクリックで Mission detail modal が開く。
- TaskCandidate タイトルクリックで TaskCandidate detail modal が開く。
- 行全体クリックで modal が開かない。
- TaskCandidate 行のみ checkbox が表示される。
- Goal/Signal 列が表示されない。

実行コマンド:

```bash
bunx vitest run tests/project-detail-screen.test.tsx
```

### API/サービステスト

- Phase 1:
  - 既存の Goal 直下 candidate 生成が壊れていない。
  - Mission 分解で生成された互換 candidate を画面 adapter が扱える。
  - TaskCandidate の Task 化が、保存元に関係なく同じ画面操作で実行できる。
  - dismissed / task_created の候補が通常一覧から除外される。
- Phase 2:
  - Mission 分解結果が `mission_task_candidates` に保存される。
  - `missionId` 付き TaskCandidate が Mission 配下に表示できる。
  - 旧 proposal API の互換期間を設ける場合、その読み取り結果が新 TaskCandidate と重複しない。
- Phase 3:
  - Goal からの生成結果が Mission と TaskCandidate を混在して保存できる。

実行コマンド:

```bash
bunx vitest run tests/project-detail-backend.test.ts tests/mission-planner.test.ts tests/services.mission-task-candidates.test.ts
```

### 回帰確認

- 既存の Mission 分解フローが壊れていない。
- 既存の Task 化後の Queue metadata handoff が壊れていない。
- Project Detail の他タブに不要な変更が入っていない。

実装完了前の最終確認:

```bash
bun run typecheck
bunx vitest run tests/project-detail-screen.test.tsx tests/project-detail-backend.test.ts tests/mission-planner.test.ts tests/services.mission-task-candidates.test.ts
```

Phase 2/3 で backend schema や route を変更した場合は、最後に repo の通常 verify を実行する。

```bash
bun run verify
```
