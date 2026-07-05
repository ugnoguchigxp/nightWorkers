import type {
  Mission,
  MissionDecompositionPlanningResult,
  MissionDeterministicCheckReport,
} from '../../../shared/schemas/mission-planner.schema';
import type {
  MissionGoal,
  ProjectSignalSnapshot,
} from '../../../shared/schemas/project-detail.schema';

export function buildMissionPlannerInputBundle(input: {
  mission: Mission;
  sourceGoals: MissionGoal[];
  signal: ProjectSignalSnapshot;
  contextStillGuardrails?: unknown;
}) {
  return {
    schemaVersion: 'nightworkers.mission-planner-input/v1',
    mission: {
      id: input.mission.id,
      title: input.mission.title,
      goalText: input.mission.goalText,
      nonGoals: input.mission.nonGoals,
      sourceGoalIds: input.mission.sourceGoalIds,
    },
    sourceGoals: input.sourceGoals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      goalText: goal.goalText,
      active: goal.active,
    })),
    projectSignalSnapshot: input.signal,
    contextStillGuardrails: input.contextStillGuardrails ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function buildMissionDraftSystemPrompt() {
  return [
    'ユーザーの広い goal を、実装可能な Mission planning unit に正規化してください。',
    'この段階では Task を作らず、Mission title / goal / non-goals / clarification の必要性だけを判断します。',
    'プロンプト文言と出力本文は日本語を維持してください。',
  ].join('\n');
}

export function buildMissionDraftUserPrompt(input: { inputBundle: unknown }) {
  return JSON.stringify(
    {
      instruction:
        'Mission draft を作成してください。blockingClarification が true の場合は task decomposition に進めません。',
      requiredOutput: {
        schemaVersion: 'nightworkers.mission-draft/v1',
        mission: { title: 'string', goal: 'string', nonGoals: ['string'] },
        blockingClarification: 'boolean',
        clarificationQuestions: ['string'],
        riskNotes: ['string'],
      },
      inputBundle: input.inputBundle,
    },
    null,
    2
  );
}

export function buildMissionCandidatesSystemPrompt() {
  return [
    '設定済み Mission Goal と repository signal から、中間目標としてレビューできる Mission 候補だけを JSON schema に従って返してください。',
    'ユーザーが Mission を白紙から作る前提にしないでください。Mission 候補は LLM が初期案として作ります。',
    '候補は Task ではありません。Task proposal は候補が人間に選ばれた後の分解 stage で作ります。',
    'repositorySnapshot.llmContextFiles がある場合はそれを最優先の実装状態として扱い、無い場合だけ README / sourceExcerpts / recentCommitDiffs を補助根拠にしてください。',
    '候補は Goal 達成までの中間目標、作業パッケージ、または複数 Task の workflow として意味がある粒度にしてください。',
    'プロンプト文言と出力本文は日本語を維持してください。',
  ].join('\n');
}

export function buildMissionCandidatesUserPrompt(input: {
  inputBundle: unknown;
  existingMissions: Array<{ id: string; title: string; status: string }>;
}) {
  return JSON.stringify(
    {
      instruction:
        'Mission 候補を作成してください。既存 Mission と title が重なる候補は返さないでください。',
      requiredOutput: {
        schemaVersion: 'nightworkers.mission-candidates/v1',
        candidates: [
          {
            title: 'string',
            goalText: 'string',
            nonGoals: ['string'],
            sourceGoalIds: ['MissionGoal.id'],
            rationale: 'string',
          },
        ],
      },
      generationRules: [
        'Mission は Goal の言い換えではなく、Goal 達成に向けた中間目標または workflow 単位にする。',
        'Task まで細かくしない。Task proposal は後続の分解で作る。',
        'sourceGoalIds は必ず1件以上入れ、inputBundle.sourceGoals に含まれる id だけを使う。',
        'Goal 本体の実装状態は projectSignalSnapshot.repositorySnapshot から判断する。',
        '根拠が薄い場合は、大きすぎる Mission を作らず、確認しやすい候補へ分割する。',
      ],
      existingMissions: input.existingMissions,
      inputBundle: input.inputBundle,
    },
    null,
    2
  );
}

export function buildMissionStructureSystemPrompt() {
  return [
    'Mission draft を Objective、Work Package、Replanning Unit に分解してください。',
    'この段階では Task proposal を作らず、構造だけを設計します。',
    'Work Package は suggestedPlanMode、risk、approvalRequired、verificationGate を持たせてください。',
  ].join('\n');
}

export function buildMissionStructureUserPrompt(input: {
  missionDraft: unknown;
  inputBundle: unknown;
}) {
  return JSON.stringify(
    {
      instruction:
        'Mission draft と repository signal から structure decomposition を作成してください。',
      requiredOutput: {
        schemaVersion: 'nightworkers.mission-structure/v1',
        objectives: ['MissionDecompositionPlanningResult.objectives item'],
        workPackages: ['MissionDecompositionPlanningResult.workPackages item'],
        replanningUnits: ['MissionDecompositionPlanningResult.replanningUnits item'],
      },
      missionDraft: input.missionDraft,
      inputBundle: input.inputBundle,
    },
    null,
    2
  );
}

export function buildMissionTaskProposalsSystemPrompt() {
  return [
    'Mission structure から、ユーザーが選択して Task 化できる proposal を作成してください。',
    'Task proposal はまだ Task ではありません。Queue に直接入れない前提で、initialPrompt を Worker / Plan mode がそのまま使える日本語指示にしてください。',
    'initialPrompt には 目的 / 対象範囲 / 非目標 / 実装方針 / 完了条件 / 検証 / 注意点 を含めてください。',
    'dependency がある proposal は sequence scheduling hint を持たせ、高リスクまたは承認必須の proposal は normal scheduling にしないでください。',
  ].join('\n');
}

export function buildMissionTaskProposalsUserPrompt(input: {
  missionDraft: unknown;
  structure: unknown;
  inputBundle: unknown;
  existingTaskTitles: string[];
}) {
  return JSON.stringify(
    {
      instruction:
        'Task proposals を作成してください。既存 Task title と重複しないようにしてください。',
      requiredOutput: {
        schemaVersion: 'nightworkers.mission-task-proposals/v1',
        taskProposals: ['MissionDecompositionPlanningResult.taskProposals item'],
      },
      missionDraft: input.missionDraft,
      structure: input.structure,
      inputBundle: input.inputBundle,
      existingTaskTitles: input.existingTaskTitles,
    },
    null,
    2
  );
}

export function buildMissionEvaluationSystemPrompt() {
  return [
    '既存の planning result を評価してください。代替 proposal を新規発明してはいけません。',
    'deterministic checks は構造 gate です。goal alignment、分解品質、依存関係、検証容易性、リスク制御、再計画可能性、Plan mode fit を評価してください。',
    'review_ready または needs_human_approval だけが review_pending に進めます。',
  ].join('\n');
}

export function buildMissionEvaluationUserPrompt(input: {
  mission: Mission;
  planningResult: MissionDecompositionPlanningResult;
  deterministicChecks: MissionDeterministicCheckReport;
  signal: ProjectSignalSnapshot;
  existingTaskTitles: string[];
}) {
  return JSON.stringify(
    {
      instruction: 'Mission Decomposition Evaluation を返してください。',
      mission: input.mission,
      planningResult: input.planningResult,
      deterministicChecks: input.deterministicChecks,
      projectSignalSnapshot: input.signal,
      existingTaskTitles: input.existingTaskTitles,
      requiredOutput: 'nightworkers.mission-decomposition-evaluation/v1',
    },
    null,
    2
  );
}
