---
title: Codex App ライク UI 改修計画
---

# Codex App ライク UI 改修計画

作成日: 2026-05-31

## 目的

NightWorkers の Home 画面を、現行の「リポジトリ実行ダッシュボード」から、Codex App に近い「プロジェクト内の作業スレッド UI」へ改修する。

この計画は、すぐ実装に入れる粒度を目標にする。対象ファイル、作成するコンポーネント、props、状態、API 接続、検証コマンドを明示する。

## スコープ

残すもの:

- プロジェクト一覧
- 作業スレッド一覧
- 選択中スレッドのタイムライン
- 初回指示入力
- run 開始
- 実行状態表示
- agent 結果表示
- 変更カード
- モデル選択
- Thinking 深度設定
- 右上設定ボタン
- LLM 設定画面

今回やらないもの:

- 検索
- プラグイン
- オートメーション
- 音声入力
- ファイル添付
- 画像追加
- チャットからの追加指示の高度化
- Plan mode / Goal mode
- commit / push / PR 作成
- backend schema の大規模変更

## 現行コードから確認した前提

### UI

- Home 画面は `src/routes/index.tsx`。
- 現在の Home は `CodexAppUnifiedDashboard` という単一コンポーネントで、sidebar、workspace、composer、folder browser、settings screen をすべて抱えている。
- route shell は `src/routes/__root.tsx`。ここに NightWorkers の上部 nav がある。
- 現在の composer には、添付、権限、モデル風表示、repo/branch、mic、send が混在している。
- 現在の run 表示は accordion で、chat thread ではなく log/review dashboard に近い。

### API

現行 UI は `src/lib/api.ts` の Hono client から次を使える。

- `GET /api/repositories`
- `POST /api/repositories`
- `DELETE /api/repositories/:id`
- `GET /api/tasks`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/run`
- `GET /api/tasks/:id/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/review`
- `GET /api/settings/llm`
- `POST /api/settings/llm`

### 既存データ型

`shared/schemas/nightworkers.schema.ts` から、UI 側で必要な型を先に固定する。

```ts
export type Repository = {
  id: string;
  name: string;
  localPath: string;
  branch: string;
  allowed: boolean;
  safetyPolicy?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type Task = {
  id: string;
  repositoryId: string;
  title: string;
  description?: string | null;
  objective?: string | null;
  acceptanceCriteria?: string | null;
  status: string;
  compiledPrompt?: string | null;
  timeoutSeconds: number;
  priority: number;
  createdBy?: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type TaskRun = {
  id: string;
  taskId: string;
  repositoryId?: string | null;
  status: string;
  workerKind: string;
  timeoutSeconds: number;
  contextSnapshot?: unknown | null;
  summary?: string | null;
  finalReport?: string | null;
  startedAt: unknown;
  endedAt?: unknown | null;
  finishedAt?: unknown | null;
  logContent?: string | null;
  diffPatch?: string | null;
  testResults?: unknown | null;
  contextEval?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type RunDetails = TaskRun & {
  events: unknown[];
};
```

実装時はこの型を `src/modules/nightworkers/types.ts` に置く。`unknown` は後続で狭めるが、まず `any` を消すことを優先する。

## 目標 UX

ユーザーの体験は次の流れにする。

1. 左サイドバーで project を見る。
2. project 配下の work thread を選ぶ。
3. work thread の中央に、ユーザー依頼、agent 結果、変更カードが時系列に出る。
4. 下部 composer で初回指示を入力する。
5. composer には model selector と Thinking depth selector がある。
6. 送信すると session 作成または run 開始が行われる。
7. 実行中は thread 内に working 状態が出る。
8. run 完了後、変更がある場合は `ChangeCard` が出る。
9. 右上設定ボタンから LLM 設定を開く。

## 最終コンポーネント構成

```text
src/routes/index.tsx
└── NightWorkersHome
    └── NightWorkersShell
        ├── ProjectSidebar
        │   ├── ProjectSidebarHeader
        │   ├── ProjectSection
        │   └── WorkThreadRow
        ├── ThreadWorkspace
        │   ├── SettingsButton
        │   ├── ThreadHeader
        │   ├── ThreadTimeline
        │   │   ├── UserRequestMessage
        │   │   ├── AgentResultMessage
        │   │   ├── ChangeCard
        │   │   └── WorkingIndicator
        │   └── Composer
        │       ├── ModelSelector
        │       ├── ThinkingDepthSelector
        │       └── SendButton
        ├── SettingsScreen
        └── FolderBrowserDialog
```

## 追加ファイル

```text
src/modules/nightworkers/types.ts
src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts
src/modules/nightworkers/utils/diff.ts
src/modules/nightworkers/utils/time.ts
src/modules/nightworkers/components/NightWorkersShell.tsx
src/modules/nightworkers/components/ProjectSidebar.tsx
src/modules/nightworkers/components/ThreadWorkspace.tsx
src/modules/nightworkers/components/ThreadTimeline.tsx
src/modules/nightworkers/components/ThreadMessage.tsx
src/modules/nightworkers/components/ChangeCard.tsx
src/modules/nightworkers/components/Composer.tsx
src/modules/nightworkers/components/ModelThinkingControls.tsx
src/modules/nightworkers/components/SettingsButton.tsx
src/modules/nightworkers/components/SettingsScreen.tsx
src/modules/nightworkers/components/FolderBrowserDialog.tsx
```

## 変更ファイル

```text
src/routes/index.tsx
src/routes/__root.tsx
src/modules/nightworkers/*
```

`shared/schemas/nightworkers.schema.ts` と backend API は、最初の実装では変更しない。model / thinking depth を backend に保存する必要が出た段階で別作業にする。

## 実装ステップ 0: 現状維持のまま型と util を作る

### 目的

`src/routes/index.tsx` から安全に切り出せる土台を作る。

### 作業

1. `src/modules/nightworkers/types.ts` を作成する。
2. `Repository`, `Task`, `TaskRun`, `RunDetails`, `ModelOption`, `ThinkingDepthOption` を定義する。
3. `src/modules/nightworkers/utils/diff.ts` を作成する。
4. `getDiffStats(diff?: string | null)` を `index.tsx` から移す。
5. `getChangedFiles(diff?: string | null)` を追加する。
6. `src/modules/nightworkers/utils/time.ts` を作成する。
7. `getRelativeTimestamp`, `formatRunDuration`, `formatFinishedTime` を移す。

### 実装メモ

`getChangedFiles` はまず diff header だけを見る。

```ts
export type ChangedFileSummary = {
  path: string;
  added: number;
  deleted: number;
};
```

初期実装ではファイル単位の行数が難しければ、`diff --git a/... b/...` ごとに chunk を分けて `+` / `-` を数える。

### 受け入れ条件

- `index.tsx` 内の diff/time helper が削除される。
- `pnpm typecheck` が通る。
- 画面表示は変わらない。

## 実装ステップ 1: Workspace hook を作る

### 目的

データ取得と mutation を UI コンポーネントから分離する。

### 追加ファイル

`src/modules/nightworkers/hooks/useNightWorkersWorkspace.ts`

### 返す state

```ts
export type NightWorkersWorkspaceState = {
  projects: Repository[];
  sessions: Task[];
  activeSessionId: string | null;
  activeSession: Task | null;
  activeProject: Repository | null;
  activeSessionRuns: TaskRun[];
  latestRun: TaskRun | undefined;
  isProjectsLoading: boolean;
  isSessionsLoading: boolean;
  isAgentWorking: boolean;
  setActiveSessionId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => void;
  deleteProject: (id: string) => void;
  createSession: (input: CreateSessionInput) => Promise<Task>;
  startRun: (sessionId: string) => Promise<TaskRun>;
  reviewRun: (input: ReviewRunInput) => Promise<{ ok: boolean; status: string }>;
  refreshWorkspace: () => void;
};
```

### 実装方針

- 既存の `useQuery` / `useMutation` を hook に移す。
- query keys は既存の `projects`, `sessions`, `sessionRuns` を維持する。
- `activeSessionRuns[0]` を latest run とする現行仕様を維持する。
- `runDetails` は現在 UI で未使用なので、この step では移さず削除する。

### 受け入れ条件

- `src/routes/index.tsx` に API 呼び出しの詳細が残らない。
- 既存の project/session/run の表示が維持される。
- `pnpm typecheck` が通る。

## 実装ステップ 2: `src/routes/index.tsx` を route entry に縮小する

### 目的

巨大コンポーネントを解体し、Home route は state wiring だけにする。

### 変更後の形

```tsx
export const Route = createFileRoute('/')({
  component: NightWorkersHome,
});

function NightWorkersHome() {
  const workspace = useNightWorkersWorkspace();
  const [showSettings, setShowSettings] = useState(false);
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);

  return (
    <NightWorkersShell
      workspace={workspace}
      showSettings={showSettings}
      onOpenSettings={() => setShowSettings(true)}
      onCloseSettings={() => setShowSettings(false)}
      showFolderBrowser={showFolderBrowser}
      onOpenFolderBrowser={() => setShowFolderBrowser(true)}
      onCloseFolderBrowser={() => setShowFolderBrowser(false)}
    />
  );
}
```

### 受け入れ条件

- `src/routes/index.tsx` が概ね 150 行以下になる。
- JSX の大半が `src/modules/nightworkers/components/` に移動する。
- 見た目はまだ大きく変えなくてよい。

## 実装ステップ 3: App shell を Codex App 風の仕様構造へ変える

### 目的

「上部 nav + dashboard」ではなく「sidebar + thread workspace」にする。

### `__root.tsx`

Home 画面では上部 nav を出さない。最小実装は pathname 判定でよい。

```tsx
const isHome = window.location.pathname === '/';
return (
  <div className="min-h-screen bg-[#101014]">
    {!isHome && <nav>...</nav>}
    <main>
      <Outlet />
    </main>
  </div>
);
```

より整理するなら、Home 専用 shell に完全委譲する。

### `NightWorkersShell` props

```ts
type NightWorkersShellProps = {
  workspace: NightWorkersWorkspaceState;
  showSettings: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  showFolderBrowser: boolean;
  onOpenFolderBrowser: () => void;
  onCloseFolderBrowser: () => void;
};
```

### レイアウト

```tsx
<div className="flex h-screen overflow-hidden bg-[#101014] text-zinc-100">
  <ProjectSidebar ... />
  <ThreadWorkspace ... />
  <SettingsButton onClick={onOpenSettings} />
  {showSettings && <SettingsScreen onClose={onCloseSettings} />}
  {showFolderBrowser && <FolderBrowserDialog ... />}
</div>
```

### 受け入れ条件

- Home 画面で別段の上部 nav が消える。
- 左 sidebar と右 workspace が画面全高を使う。
- 右上設定ボタンが残る。

## 実装ステップ 4: Sidebar を Project / Work Thread 一覧にする

### 目的

repository 管理ではなく、作業スレッド選択 UI にする。

### `ProjectSidebar` props

```ts
type ProjectSidebarProps = {
  projects: Repository[];
  sessions: Task[];
  activeSessionId: string | null;
  expandedProjects: Record<string, boolean>;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (repositoryId: string) => void;
  onToggleProject: (projectId: string) => void;
  onOpenFolderBrowser: () => void;
};
```

### 表示ルール

- 先頭に小さく `NightWorkers` を表示する。
- 見出しは `Projects` または `Workspaces` にする。
- project row は folder icon + project name。
- thread row は session title + shortcut/time。
- project 削除ボタンはこの phase では表示しない。
- project 追加は sidebar header の `+` のみ。

### 受け入れ条件

- 常時表示される危険操作がない。
- project/thread を選ぶ UI に見える。
- 検索、プラグイン、オートメーションは表示されない。

## 実装ステップ 5: Thread workspace を作る

### `ThreadWorkspace` props

```ts
type ThreadWorkspaceProps = {
  activeSession: Task | null;
  activeProject: Repository | null;
  runs: TaskRun[];
  latestRun?: TaskRun;
  isAgentWorking: boolean;
  model: string;
  thinkingDepth: ThinkingDepth;
  onModelChange: (model: string) => void;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  onSubmitInitialPrompt: (prompt: string) => Promise<void>;
  onReviewRun: (runId: string) => void;
  onRevertRun: (runId: string) => void;
};
```

### 空状態

active session がない場合:

- 中央に大きな landing hero は作らない。
- `作業スレッドを選択するか、下の入力欄から開始` 程度の短い empty state にする。
- composer は表示する。

### active session がある場合

- `ThreadHeader` に session title、project name、status を表示する。
- `ThreadTimeline` に user request、agent result、change card を表示する。
- run accordion は廃止する。

### 受け入れ条件

- workspace が dashboard ではなく thread 表示になる。
- 空状態でも composer が主導線になる。

## 実装ステップ 6: ThreadTimeline に変換する

### `ThreadTimeline` props

```ts
type ThreadTimelineProps = {
  session: Task;
  runs: TaskRun[];
  latestRun?: TaskRun;
  isAgentWorking: boolean;
  onReviewRun: (runId: string) => void;
  onRevertRun: (runId: string) => void;
};
```

### 描画ルール

1. `session.description` があれば `UserRequestMessage` として表示する。
2. runs は古い順に並べる。
3. 各 run に対して:
   - `finalReport` があれば agent result として表示。
   - `finalReport` がなければ `summary` を表示。
   - `diffPatch` があれば `ChangeCard` を表示。
4. `isAgentWorking` が true の場合、末尾に `WorkingIndicator` を表示。

### `ThreadMessage` props

```ts
type ThreadMessageProps = {
  role: 'user' | 'assistant' | 'system';
  children: React.ReactNode;
  timestamp?: string;
};
```

### 受け入れ条件

- run の内部 UI ではなく、会話の流れとして読める。
- terminal log は初期表示しない。
- raw diff は初期表示しない。

## 実装ステップ 7: ChangeCard を実装する

### `ChangeCard` props

```ts
type ChangeCardProps = {
  runId: string;
  diffPatch: string;
  status: string;
  onReview: (runId: string) => void;
  onRevert: (runId: string) => void;
};
```

### 表示ルール

- `getChangedFiles(diffPatch)` の先頭ファイルをタイトルにする。
- 複数ファイルの場合は `index.tsx ほか 3 件を編集しました` のように表示する。
- 追加/削除合計を `+43 -78` の形式で表示する。
- 右側に `元に戻す` と `レビューする` を置く。
- `onRevert` は初期実装では toast/alert でもよい。backend がないため実処理は後続。
- `onReview` は `POST /api/runs/:id/review` の `complete` につなげるか、既存レビュー UI がない場合は no-op ではなく `TODO` コメント付きで disabled にする。

### 受け入れ条件

- diff stats が composer ではなく change card に表示される。
- 変更結果が agent result の一部として見える。

## 実装ステップ 8: Composer を単純化する

### `Composer` props

```ts
type ComposerProps = {
  disabled: boolean;
  model: string;
  thinkingDepth: ThinkingDepth;
  modelOptions: ModelOption[];
  thinkingDepthOptions: ThinkingDepthOption[];
  onModelChange: (model: string) => void;
  onThinkingDepthChange: (depth: ThinkingDepth) => void;
  onSubmit: (prompt: string) => Promise<void>;
};
```

### 表示するもの

- textarea
- Model selector
- Thinking depth selector
- send button

### 消すもの

- `Paperclip`
- `Mic`
- `フルアクセス`
- repo name badge
- branch badge
- diff stats
- commit/push button

### `ThinkingDepth`

```ts
export type ThinkingDepth = 'low' | 'medium' | 'high' | 'very_high';

export const THINKING_DEPTH_OPTIONS: ThinkingDepthOption[] = [
  { value: 'low', label: '低い' },
  { value: 'medium', label: '標準' },
  { value: 'high', label: '高い' },
  { value: 'very_high', label: '非常に高い' },
];
```

### `ModelOption`

最初は settings API の値を直接読まず、静的 options で始める。

```ts
export const DEFAULT_MODEL_OPTIONS: ModelOption[] = [
  { value: 'gpt-5-mini', label: 'gpt-5-mini' },
  { value: 'gpt-5', label: 'gpt-5' },
  { value: 'codex-sdk-agent', label: 'Codex SDK' },
];
```

### 送信動作

active session がない場合:

1. active project があれば、その repositoryId で task を作る。
2. title は prompt の先頭 40 文字。
3. description と objective に prompt を入れる。
4. task 作成後に `POST /api/tasks/:id/run` を呼ぶ。

active session がある場合:

1. 今回は高度な follow-up として作り込まない。
2. 最小実装では `PATCH /api/tasks/:id` で description を更新し、`POST /api/tasks/:id/run` を呼ぶ。
3. 既存挙動と同じだが、UI 表現は初回指示入力として扱う。

### 受け入れ条件

- composer 内に残る操作が input / model / thinking / send だけになる。
- send で task/run が開始できる。
- model/thinking は UI state として変更できる。

## 実装ステップ 9: SettingsScreen を分離する

### 目的

右上設定ボタンを維持し、既存 LLM 設定画面を `src/modules/nightworkers/components/SettingsScreen.tsx` へ移す。

### 作業

- `LlmSettingsScreen` を `SettingsScreen` として移動する。
- `any` を `LlmSettings` 型に置き換える。
- provider tab の `as any` を union type に置き換える。
- button に `type="button"` を付ける。
- label に `htmlFor` を付ける。

### 型

```ts
export type LlmProvider = 'azure' | 'openai' | 'bedrock' | 'codex';

export type LlmSettings = {
  ACTIVE_LLM_PROVIDER: LlmProvider;
  AZURE_OPENAI_API_KEY: string;
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_DEPLOYMENT_NAME: string;
  AZURE_OPENAI_API_VERSION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  AWS_BEDROCK_MODEL: string;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  CODEX_ACCESS_TOKEN: string;
  CODEX_MODEL: string;
};
```

### 受け入れ条件

- 右上設定ボタンから SettingsScreen が開く。
- 保存 API は既存 `/api/settings/llm` を使う。
- SettingsScreen 内の Biome a11y 指摘が解消される。

## 実装ステップ 10: FolderBrowserDialog を残す

### 目的

project 追加導線は残すが、メイン UX の邪魔をしない。

### 作業

- 既存 folder browser JSX を `FolderBrowserDialog.tsx` に移す。
- `browseLocalFolders` の state は hook に寄せるか、dialog 専用 hook に分ける。
- dialog は project 追加時だけ開く。

### props

```ts
type FolderBrowserDialogProps = {
  open: boolean;
  currentPath: string | null;
  parentPath: string | null;
  directories: Array<{ name: string; path: string }>;
  selectedPath: string;
  isLoading: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onSelectPath: (path: string, name: string) => void;
};
```

### 受け入れ条件

- project 追加が壊れない。
- dialog 内の clickable div / button type 指摘を解消する。

## 実装ステップ 11: Biome 対応

### 最低限直す項目

- `noExplicitAny`
- `noUnusedImports`
- `noUnusedVariables`
- `noStaticElementInteractions`
- `useKeyWithClickEvents`
- `useButtonType`
- `noLabelWithoutControl`
- formatter 差分

### 方針

- session row、project show more、folder browser row は `button type="button"` にする。
- `button` の中にさらに `button` を入れない。row action は sibling にする。
- label は `htmlFor` で input id と結ぶ。
- `runDetails` のような未使用 query は削除する。

### 受け入れ条件

```bash
pnpm exec biome check src/routes/index.tsx src/modules/nightworkers
```

が通る。

## 実装ステップ 12: 検証

### コマンド

```bash
pnpm typecheck
pnpm exec biome check src/routes/index.tsx src/modules/nightworkers
pnpm build:frontend
```

### Playwright 手動確認

一時的に dev server を起動する。

```bash
pnpm dev --host 127.0.0.1 --port 5174
```

確認する画面:

- desktop: 1440 x 900
- wide desktop: 1885 x 1395
- mobile: 390 x 844

確認項目:

- Home 画面に上部 dashboard nav が出ない。
- 左に project/thread sidebar がある。
- 中央が thread timeline として読める。
- run accordion が主表示ではない。
- 変更が ChangeCard として出る。
- composer に添付、音声、diff、repo badge がない。
- composer に model selector と Thinking depth selector がある。
- 右上設定ボタンから SettingsScreen が開く。

## 実装の最小 PR 分割

### PR 1: 分割と型整理

含める:

- `types.ts`
- `utils/diff.ts`
- `utils/time.ts`
- `useNightWorkersWorkspace.ts`
- route entry の縮小
- 見た目はなるべく維持

完了条件:

- `pnpm typecheck`
- 主要画面が表示できる

### PR 2: Shell / Sidebar / Settings 分離

含める:

- `NightWorkersShell`
- `ProjectSidebar`
- `SettingsButton`
- `SettingsScreen`
- Home の上部 nav 非表示

完了条件:

- 右上設定ボタンが動く
- project/thread selection が動く

### PR 3: ThreadTimeline / ChangeCard

含める:

- `ThreadWorkspace`
- `ThreadTimeline`
- `ThreadMessage`
- `ChangeCard`
- run accordion の主表示廃止

完了条件:

- user request、agent result、change card が時系列に出る
- raw log / raw diff が主表示ではない

### PR 4: Composer 単純化

含める:

- `Composer`
- `ModelThinkingControls`
- model selector
- Thinking depth selector
- 添付/音声/repo/diff badge の削除

完了条件:

- composer が input / model / thinking / send に絞られる
- 送信で task/run が開始できる

### PR 5: Biome / responsive cleanup

含める:

- clickable div の解消
- label/input 関連付け
- unused import/variable 削除
- mobile sidebar の最低限対応

完了条件:

- `pnpm exec biome check src/routes/index.tsx src/modules/nightworkers`
- `pnpm build:frontend`
- Playwright screenshot 確認

## 完了条件

- NightWorkers Home が「作業スレッド UI」として成立している。
- project/thread を選択し、thread timeline を読める。
- 入力から作業を開始できる。
- run 結果が agent message と change card として出る。
- composer は input / model / thinking / send に絞られている。
- 右上設定ボタンが残っている。
- 検索、プラグイン、オートメーション、音声、添付、画像、Plan/Goal mode は混ざっていない。
- `pnpm typecheck` が通る。
- `pnpm build:frontend` が通る。
- 対象範囲の Biome check が通る。
