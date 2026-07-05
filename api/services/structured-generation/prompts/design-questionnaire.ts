import type { DesignQuestionnaireSession } from '../../../../shared/schemas/design-questionnaire.schema';

type QuestionnaireSourceInput = {
  sourceBlueprintMessage?: {
    id: string;
    metadataJson?: unknown;
  } | null;
  taskPrompt: string;
  projectStackContext?: string | null;
  planModeContext?: string | null;
};

type SpecificationContext = {
  task: string;
  projectStackContext: string;
  implementationPlanGuidance: string;
  questionnaireDecisions: string;
  blueprintSummary: string;
  dataModelDdl: string;
  planViewReferences: string;
  planModeReferences: string;
  traceability: string;
};

export function buildDesignQuestionnaireSystemPrompt() {
  return [
    '実装前の確認フォームを作ります。目的は、grill-me のように仕様の曖昧さを段階的に潰すことです。',
    'Questionnaire は最大4ページまで続けられます。初回はその1ページ目です。',
    '初回フォームでは、最初に回答できる重要論点を 1 ページ分まとめて聞いてください。',
    '質問ジャンルは task / blueprint / repository context から判断し、必要なものを選んでください。固定分類やキーワード一致で決めないでください。',
    '例として、scope、UI/UX、データ、backend/API、認証、外部連携、Docker、cloud deployment、storage、運用、非対象などが論点になり得ます。',
    'Questionnaire も後続の設計書と同じく、入力 context に含まれる既存資料と project context を材料にしてください。材料があるのに一般論だけで質問を作らないでください。',
    'auth / permission は対象面が public only または auth only と明確なら質問しないでください。public / protected / auth / admin などの面が混在する、または対象機能をどの面に置くか不明な場合は、初回または follow-up で route / API / data の保護方針を必ず確認してください。',
    'auth / permission の質問は「認証は必要ですか？」だけにせず、既存の public/protected 面、追加 route/API、データの所有境界に結びつく選択肢にしてください。',
    'テンプレート選定のため、使用する技術スタックと DB/永続化の選択が context から確定できない場合は、初回フォームで必ず確認してください。',
    '技術スタックの質問では、Hono + React/Vite、Python/FastAPI + React/Vite、API only、RAG など、starter template や branch variant を識別できる粒度の選択肢にしてください。',
    'DB/永続化の質問では、SQLite、PostgreSQL、pgvector、Turso/libSQL、DBなし/後続決定など、sqlite 等の template variant を識別できる選択肢にしてください。',
    'ただし、現時点の回答がないと答えられない下位論点は初回で無理に聞かず、回答後の follow-up に回してください。',
    'コードや入力contextから合理的に推定できることは、ユーザーに聞かず前提として扱ってください。',
    'ユーザーが Radio button または Checkbox で選べる質問だけを作ってください。',
    '自由記述、説明文、DB設計、分岐条件、id は作らないでください。',
    '質問は原則 8-12 件にしてください。明らかに論点が少ない場合だけ少なくして構いません。',
    '各 options は 2-10 件にしてください。',
    'type は単一選択なら radio、本当に複数の選択肢を同時に採用できる設問だけ checkbox にしてください。',
    '実装深度、優先度、段階、テンプレート/DB の選定など単一軸の判断を checkbox で表現しないでください。',
    'checkbox の質問では、ユーザーが「どれも不要」を表明できる選択肢を必ず1つ含めてください。',
    '選択肢は狭すぎる機能名だけにせず、「最小構成」「後続対応」「今回は含めない」など判断できる粒度を含めてください。',
    'JSON root は {title, questions} のみです。',
    '回答は JSON のみで返してください。',
  ].join('\n');
}

export function buildDesignQuestionnaireInitialUserPrompt(input: QuestionnaireSourceInput) {
  const metadata = (input.sourceBlueprintMessage?.metadataJson || {}) as {
    appBlueprint?: unknown;
    mockBlueprint?: unknown;
  };
  const source = input.sourceBlueprintMessage
    ? {
        sourceKind: 'blueprint',
        blueprintMessageId: input.sourceBlueprintMessage.id,
        blueprint: metadata.appBlueprint || metadata.mockBlueprint,
      }
    : {
        sourceKind: 'plan_mode_intake',
        prompt: input.taskPrompt,
      };
  return [
    input.sourceBlueprintMessage
      ? '次の App Blueprint artifact を入力に、実装前に決めたい質問フォームを生成してください。'
      : '次の Plan mode intake を入力に、実装前に決めたい質問フォームを生成してください。',
    '',
    JSON.stringify(source, null, 2),
    '',
    '## Project Stack Context',
    input.projectStackContext?.trim() || 'Project stack は未検出です。',
    '',
    '## Plan Mode Context',
    input.planModeContext?.trim() || 'Plan Mode の追加 context は未検出です。',
  ].join('\n');
}

export function buildDesignQuestionnaireFollowUpUserPrompt(
  session: DesignQuestionnaireSession,
  projectStackContext?: string | null,
  planModeContext?: string | null
) {
  return [
    '次の質問票と回答をもとに、追加確認が必要な質問だけを follow-up question set として返してください。',
    'answeredQuestions は既に回答済みの仕様判断です。選択肢が「未定」「後続決定」でも、その質問自体は回答済みとして扱ってください。',
    'answeredQuestions と同じ質問、同じ判断軸、同じ意味の言い換え、同じ選択肢集合の質問は絶対に繰り返さないでください。',
    '追加質問は unansweredQuestions と answeredQuestions のどちらにも存在しない新しい判断軸だけにしてください。',
    '',
    '## Project Stack Context',
    projectStackContext?.trim() || 'Project stack は未検出です。',
    '',
    '## Plan Mode Context',
    planModeContext?.trim() || 'Plan Mode の追加 context は未検出です。',
    '',
    JSON.stringify(buildSessionPromptPayload(session), null, 2),
  ].join('\n');
}

export function buildDesignQuestionnaireFollowUpDecisionSystemPrompt() {
  return [
    '目的は、実装前の仕様の曖昧さを grill-me のように質問攻めで潰すことです。',
    'ユーザー回答を読み、次に聞かないと答えられない下位論点や、まだ未確認の質問ジャンルが残っているか判定してください。',
    'Questionnaire は最大4ページまでです。4ページ目まで回答済みなら追加質問を出さず ready_for_design_assembly にしてください。',
    'answeredQuestions は既に回答済みの仕様判断です。選択肢が「未定」「後続決定」でも、その質問自体は回答済みとして扱い、同じ判断軸を言い換えて再質問しないでください。',
    '不足がある場合だけ action=follow_up にし、次に回答可能になったジャンルの追加質問を questionnaire に返してください。',
    '既存質問と同じ質問文、同じ意味、または同じ選択肢セットの質問は絶対に返さないでください。',
    'checkbox が未選択で回答されている場合、それは「どれも不要 / 今回は含めない」という仕様判断として扱ってください。',
    '一度の follow-up で全ジャンルを詰め込まず、次に設計判断を進めるために必要な 1 ページ分だけを返してください。',
    'テンプレート選定に必要な使用技術スタックまたは DB/永続化の選択がまだ未確認なら、starter template や branch variant を識別できる粒度で追加確認してください。',
    'DB/永続化の追加確認では、SQLite、PostgreSQL、pgvector、Turso/libSQL、DBなし/後続決定などを区別できる選択肢にしてください。',
    'Docker、cloud deployment、storage、認証、外部連携、運用、非対象などは、回答内容または Plan Mode Context から必要性が見えた場合に追加確認してください。',
    'public / protected / auth / admin などの面が混在する、または対象機能の配置が未回答なら、auth / permission の確認を follow-up に含めてください。明確に public only または auth only なら繰り返し聞かないでください。',
    'コードや既存回答から合理的に推定できることは、ユーザーに聞かず前提として扱ってください。',
    '追加質問はユーザーが Radio button または Checkbox で選べるものだけにしてください。',
    '自由記述、説明文、DB設計、分岐条件、id は作らないでください。',
    '追加質問は原則 4-10 件、各 options は 2-10 件にしてください。',
    '追加質問でも、type は単一選択なら radio、本当に複数の選択肢を同時に採用できる設問だけ checkbox にしてください。',
    '実装深度、優先度、段階、テンプレート/DB の選定など単一軸の判断を checkbox で表現しないでください。',
    'すでに回答から十分に判断できる内容を繰り返さないでください。',
    '十分であれば action=ready_for_design_assembly とし、questionnaire は null にしてください。',
    '回答は JSON のみで返してください。',
  ].join('\n');
}

export function buildDesignQuestionnaireFollowUpDecisionUserPrompt(
  session: DesignQuestionnaireSession,
  projectStackContext?: string | null,
  planModeContext?: string | null
) {
  return [
    '次の質問票とユーザー回答を評価し、Design Assembly に進めるか、さらに追質問が必要かを判定してください。',
    '追質問が必要な場合だけ、追加質問フォームを questionnaire に入れてください。',
    'answeredQuestions に含まれる質問と回答は必ず引き継ぎ、同じ質問や同じ判断軸を再生成しないでください。',
    '十分なら action は ready_for_design_assembly、questionnaire は null にしてください。',
    '',
    '## Project Stack Context',
    projectStackContext?.trim() || 'Project stack は未検出です。',
    '',
    '## Plan Mode Context',
    planModeContext?.trim() || 'Plan Mode の追加 context は未検出です。',
    '',
    JSON.stringify(buildSessionPromptPayload(session), null, 2),
  ].join('\n');
}

export function buildDesignQuestionnaireReviewSystemPrompt() {
  return [
    '回答を設計判断、後回し事項、未解決事項、Data Model handoff note に整理してください。',
    'DB table、column、relation、DDL の具体案は作らず、Data Model へ渡す制約・論点だけを書いてください。',
    'sourceQuestionIds と unresolvedQuestionIds を必ず保持してください。',
  ].join('\n');
}

export function buildDesignQuestionnaireReviewUserPrompt(session: DesignQuestionnaireSession) {
  return JSON.stringify(
    {
      sessionId: session.id,
      sourceBlueprintMessageId: session.sourceBlueprintMessageId,
      questionSets: session.questionSets.map((set) => set.questionnaire),
      answers: session.answers.map((answer) => answer.answer),
    },
    null,
    2
  );
}

export function buildSpecificationDocumentSystemPrompt() {
  return [
    'Design Questionnaire、Blueprint summary、Data Model DDL reference、Implementation Plan Guidance をもとに、実装前に読む実装計画書を Markdown で作成してください。',
    '目的は、後続のコーディングエージェントが迷わず実装、検証、完了判定できることです。必要な判断だけを短く、実装順に読める計画にしてください。',
    '文体はストレートにしてください。背景説明、評価理由、Evidence の再掲、装飾的な言い回し、同じ内容の重複を避けてください。',
    '実装対象は Task と Target Project Context に記載されたプロジェクトです。生成・管理システム名を、実装対象アプリ名や実装先として本文に書かないでください。',
    'Target Project Context の Project name/root が NightWorkers 自体を指す場合を除き、本文で NightWorkers / NightWorker を実装対象名として使わないでください。',
    'Blueprint summary は選択された画面・section・component・copy・sample・props 要約です。JSON として扱わず、画面再現に必要な仕様判断として解釈してください。',
    'Questionnaire Decisions を採用判断の正としてください。Data Model DDL reference と衝突する場合は Questionnaire を優先し、DDL 側の対象外要素は実装対象にしないでください。',
    'Data Model DDL reference は参考情報です。DDL や migration を実行する指示ではありません。DB 変更が必要な場合だけ、既存 tooling に従う schema/migration 作成・適用・検証ステップを書いてください。',
    'Plan Mode References は入力専用の関連資料 context です。最終文書に全件列挙せず、設計判断と契約の確定に使ってください。',
    '既生成資料は正本として信頼し、同じ内容を推測し直さないでください。矛盾がある場合は、最新ユーザー指示、Questionnaire Decisions、各 domain の専用 view、既存 repository context の順に優先してください。',
    '未決定事項は極力作らず、既存資料から合理的に決められる場合は前提として固定してください。実装を始めると危険な矛盾または欠落だけを未解決として短く残してください。',
    'Plan View References に API Contract や Zod Schema がある場合は、`## 契約` の API と validation/error handling に反映してください。参照 ID の列挙ではなく、request / response / error / schema 名 / 適用先 / 主要 rule を短く契約化してください。',
    'content の見出しは原則 `## 目的`, `## スコープ`, `## タスク分類`, `## 実装計画`, `## 契約`, `## DDL`, `## 検証計画`, `## 完了条件`, `## トレーサビリティ` だけにしてください。',
    '`## 目的` は 1-2 文にしてください。',
    '`## スコープ` は対象 / 非対象を短い箇条書きにしてください。',
    '`## タスク分類` は分類と理由を 2-3 行で書いてください。',
    '`## 実装計画` は番号付きで DB / API / UI / test / verification の順に、各項目 1-2 文で書いてください。',
    '`## 契約` は DB、API、UI、validation/error handling を分け、実装者が迷う path/method/state/schema/error を具体名で書いてください。',
    '`## 契約` の API 項目には、endpoint / method / request body / response body / error body / auth or permission を必要最小限で含めてください。API が対象外なら書かないでください。',
    '`## 契約` の UI 項目には、Blueprint の画面 path、採用 section 名、component、主な表示文言、サンプルデータ、主要 state を短く含めてください。',
    '`## DDL` は Data Model DDL reference をコードブロックで載せます。ただし Questionnaire と矛盾する table/column がある場合は、コードブロック前に「参考。今回の採用対象外: ...」と短く明記してください。',
    '`## 検証計画` はコマンドまたは既存 script 名、期待結果、失敗時の確認観点を短く書いてください。',
    '`## 完了条件` は検証済み事実だけで書いてください。',
    '`## トレーサビリティ` は実装判断に直接効いた主要 source ID だけにしてください。関連資料の全件記録や not generated の列挙は不要です。',
    '画面仕様、機能要件、データ設計方針、参考情報、Evidence などの追加見出しは、重複になる場合は作らないでください。',
    '出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。',
  ].join('\n');
}

export function buildSpecificationDocumentUserPrompt(context: SpecificationContext) {
  return [
    '次の圧縮済み context から Specification を作成してください。',
    '',
    '## Task',
    context.task,
    '',
    '## Target Project Context',
    context.projectStackContext,
    '',
    '## Implementation Plan Guidance',
    context.implementationPlanGuidance,
    '',
    '## Questionnaire Decisions',
    context.questionnaireDecisions,
    '',
    '## Blueprint Summary',
    context.blueprintSummary,
    '',
    '## Data Model DDL Reference',
    context.dataModelDdl,
    '',
    '## Plan View References',
    context.planViewReferences,
    '',
    '## Plan Mode References',
    context.planModeReferences,
    '',
    '## Traceability',
    context.traceability,
  ].join('\n');
}

function buildSessionPromptPayload(session: DesignQuestionnaireSession) {
  const allQuestions = session.questionSets.flatMap((set) =>
    (set.questionnaire?.questionSets || []).flatMap((questionSet) => questionSet.questions)
  );
  const questionById = new Map(allQuestions.map((question) => [question.id, question]));
  const answeredQuestionIds = new Set(session.answers.map((answer) => answer.questionId));
  return {
    sessionId: session.id,
    taskId: session.taskId,
    repositoryId: session.repositoryId,
    sourceBlueprintMessageId: session.sourceBlueprintMessageId,
    questionSets: session.questionSets.map((set) => set.questionnaire),
    answers: session.answers.map((answer) => answer.answer),
    answeredQuestions: session.answers.map((answer) => {
      const question = questionById.get(answer.questionId);
      const optionById = new Map((question?.options || []).map((option) => [option.id, option]));
      return {
        questionId: answer.questionId,
        question: question?.question ?? null,
        topic: question?.topic ?? null,
        answerType: question?.answerType ?? null,
        selectedOptionLabels: answer.answer.selectedOptionIds.map(
          (optionId) => optionById.get(optionId)?.label ?? optionId
        ),
        rankedOptionLabels: answer.answer.rankedOptionIds.map(
          (optionId) => optionById.get(optionId)?.label ?? optionId
        ),
        booleanValue: answer.answer.booleanValue ?? null,
        freeText: answer.answer.freeText ?? null,
        deferred: answer.answer.deferred,
      };
    }),
    unansweredQuestions: allQuestions
      .filter((question) => !answeredQuestionIds.has(question.id))
      .map((question) => ({
        questionId: question.id,
        question: question.question,
        topic: question.topic,
        answerType: question.answerType,
        optionLabels: (question.options || []).map((option) => option.label),
      })),
  };
}
