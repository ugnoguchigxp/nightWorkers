import type { DesignQuestionnaireSession } from '../../../../shared/schemas/design-questionnaire.schema';

type QuestionnaireSourceInput = {
  sourceBlueprintMessage?: {
    id: string;
    metadataJson?: unknown;
  } | null;
  taskPrompt: string;
};

type SpecificationContext = {
  task: string;
  questionnaireDecisions: string;
  blueprintSummary: string;
  dbDesignDdl: string;
  traceability: string;
};

export function buildDesignQuestionnaireSystemPrompt() {
  return [
    'あなたは NightWorkers の Design Questionnaire generator です。',
    'あなたは実装前の確認フォームを作ります。目的は、grill-me のように仕様の曖昧さを段階的に潰すことです。',
    'Questionnaire は最大4ページまで続けられます。初回はその1ページ目です。',
    '初回フォームでは、最初に回答できる重要論点を 1 ページ分まとめて聞いてください。',
    '質問ジャンルは task / blueprint / repository context から判断し、必要なものを選んでください。固定分類やキーワード一致で決めないでください。',
    '例として、scope、UI/UX、データ、backend/API、認証、外部連携、Docker、cloud deployment、storage、運用、非対象などが論点になり得ます。',
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
  const metadata = (input.sourceBlueprintMessage?.metadataJson || {}) as { appBlueprint?: unknown };
  const source = input.sourceBlueprintMessage
    ? {
        sourceKind: 'blueprint',
        blueprintMessageId: input.sourceBlueprintMessage.id,
        blueprint: metadata.appBlueprint,
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
  ].join('\n');
}

export function buildDesignQuestionnaireFollowUpUserPrompt(session: DesignQuestionnaireSession) {
  return [
    '次の質問票と回答をもとに、追加確認が必要な質問だけを follow-up question set として返してください。',
    '既に十分に回答された質問を繰り返さないでください。',
    JSON.stringify(buildSessionPromptPayload(session), null, 2),
  ].join('\n');
}

export function buildDesignQuestionnaireFollowUpDecisionSystemPrompt() {
  return [
    'あなたは NightWorkers の Design Questionnaire facilitator です。',
    '目的は、実装前の仕様の曖昧さを grill-me のように質問攻めで潰すことです。',
    'ユーザー回答を読み、次に聞かないと答えられない下位論点や、まだ未確認の質問ジャンルが残っているか判定してください。',
    'Questionnaire は最大4ページまでです。4ページ目まで回答済みなら追加質問を出さず ready_for_design_assembly にしてください。',
    '不足がある場合だけ action=follow_up にし、次に回答可能になったジャンルの追加質問を questionnaire に返してください。',
    '既存質問と同じ質問文、同じ意味、または同じ選択肢セットの質問は絶対に返さないでください。',
    'checkbox が未選択で回答されている場合、それは「どれも不要 / 今回は含めない」という仕様判断として扱ってください。',
    '一度の follow-up で全ジャンルを詰め込まず、次に設計判断を進めるために必要な 1 ページ分だけを返してください。',
    'テンプレート選定に必要な使用技術スタックまたは DB/永続化の選択がまだ未確認なら、starter template や branch variant を識別できる粒度で追加確認してください。',
    'DB/永続化の追加確認では、SQLite、PostgreSQL、pgvector、Turso/libSQL、DBなし/後続決定などを区別できる選択肢にしてください。',
    'Docker、cloud deployment、storage、認証、外部連携、運用、非対象などは、回答内容から必要性が見えた場合に追加確認してください。',
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
  session: DesignQuestionnaireSession
) {
  return [
    '次の質問票とユーザー回答を評価し、Design Assembly に進めるか、さらに追質問が必要かを判定してください。',
    '追質問が必要な場合だけ、追加質問フォームを questionnaire に入れてください。',
    '十分なら action は ready_for_design_assembly、questionnaire は null にしてください。',
    JSON.stringify(buildSessionPromptPayload(session), null, 2),
  ].join('\n');
}

export function buildDesignQuestionnaireReviewSystemPrompt() {
  return [
    'あなたは NightWorkers の Design Questionnaire review synthesizer です。',
    '回答を設計判断、後回し事項、未解決事項、DB Design handoff note に整理してください。',
    'DB table、column、relation、DDL の具体案は作らず、DB Design へ渡す制約・論点だけを書いてください。',
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
    'あなたは NightWorkers の Specification writer です。',
    'Design Questionnaire、Blueprint summary、DB Design DDL reference をもとに、実装前に読む設計書を Markdown で作成してください。',
    'Blueprint summary は選択された画面・section・意図を自然言語に圧縮したものです。JSON として扱わず、仕様判断として解釈してください。',
    'DB Design DDL reference は参考情報です。DDL や migration を実行する指示ではありません。',
    'content には必ず独立した `## DDL` セクションを含め、DB Design DDL reference の内容をそのままコードブロックで転記してください。',
    'DB Design DDL reference が未生成または table 未定義の場合も、`## DDL` セクションを作り、未確定である理由を書いてください。',
    '出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。',
    'content には 目的、スコープ、画面仕様、機能要件、データ設計方針、DDL、非対象、受け入れ条件、トレーサビリティを含めてください。',
  ].join('\n');
}

export function buildSpecificationDocumentUserPrompt(context: SpecificationContext) {
  return [
    '次の圧縮済み context から Specification を作成してください。',
    '',
    '## Task',
    context.task,
    '',
    '## Questionnaire Decisions',
    context.questionnaireDecisions,
    '',
    '## Blueprint Summary',
    context.blueprintSummary,
    '',
    '## DB Design DDL Reference',
    context.dbDesignDdl,
    '',
    '## Traceability',
    context.traceability,
  ].join('\n');
}

export function buildSpecificationReviewSystemPrompt() {
  return [
    'あなたは NightWorkers の Specification reviewer / editor です。',
    'ユーザー依頼: ドキュメントレビューをしてください。改善するべき点が無くなるまで改善してください。',
    '対象は直前に生成された Specification Markdown です。',
    'レビュー結果を別コメントとして返すのではなく、改善済みの最終 Markdown を返してください。',
    '改善点がない場合も、読みやすさと実装着手可能性を確認したうえで同等以上の最終版を返してください。',
    '実装済み事実、今回の仕様、将来候補を混ぜないでください。',
    '非対象、受け入れ条件、未解決事項、トレーサビリティを落とさないでください。',
    '`## DDL` セクションを必ず残し、DB Design DDL Reference の内容をコードブロックとして含めてください。',
    'DB Design DDL Reference は実行指示ではなく仕様上のデータ設計根拠として扱ってください。',
    '出力は JSON object のみで、title と content を返してください。content は Markdown 文字列にしてください。',
  ].join('\n');
}

export function buildSpecificationReviewUserPrompt(input: {
  content: string;
  context: SpecificationContext;
}) {
  return [
    '次の Specification をレビューし、改善するべき点がなくなるまで改善した最終版を作成してください。',
    '',
    '## Current Specification',
    input.content,
    '',
    '## Task',
    input.context.task,
    '',
    '## Questionnaire Decisions',
    input.context.questionnaireDecisions,
    '',
    '## Blueprint Summary',
    input.context.blueprintSummary,
    '',
    '## DB Design DDL Reference',
    input.context.dbDesignDdl,
    '',
    '## Traceability',
    input.context.traceability,
  ].join('\n');
}

function buildSessionPromptPayload(session: DesignQuestionnaireSession) {
  return {
    sessionId: session.id,
    taskId: session.taskId,
    repositoryId: session.repositoryId,
    sourceBlueprintMessageId: session.sourceBlueprintMessageId,
    questionSets: session.questionSets.map((set) => set.questionnaire),
    answers: session.answers.map((answer) => answer.answer),
  };
}
