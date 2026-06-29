import {
  defaultProjectEvaluationDimensions,
  type ProjectEvaluationBundle,
  type ProjectEvaluationDimensionKey,
  type ProjectEvaluationRun,
  projectEvaluationDimensionLabels,
} from '../../../shared/schemas/project-evaluation.schema';

function selectedDimensionLines(keys: readonly ProjectEvaluationDimensionKey[]) {
  return keys.map((key) => `- ${key}: ${projectEvaluationDimensionLabels[key]}`).join('\n');
}

export function buildProjectEvaluationSystemPrompt() {
  return [
    'あなたは NightWorkers の Project Evaluation 専用 judge です。',
    '与えられた repository bundle だけを根拠に評価し、ファイル変更、コマンド実行、外部アクセスは要求しないでください。',
    '確認できない点は点数を盛らず、concerns と nextEvidenceToCollect に残してください。',
    '出力は指定 JSON schema だけにしてください。説明文や Markdown は含めないでください。',
  ].join('\n');
}

export function buildProjectEvaluationUserPrompt(input: {
  bundle: ProjectEvaluationBundle;
  baselinePrompt?: string;
}) {
  return [
    '次の NightWorkers Project を評価してください。',
    '',
    `評価観点:\n${selectedDimensionLines(defaultProjectEvaluationDimensions)}`,
    '',
    input.baselinePrompt ? `追加観点:\n${input.baselinePrompt}` : null,
    '',
    '採点方針:',
    '- overallScore と各 score は 0-100。',
    '- confidence は 0-1。',
    '- source sampling や runtime verification がない項目は confidence を上げすぎない。',
    '- rationale は NightWorkers Task に落とせる粒度で、抽象論だけにしない。',
    '',
    `Repository bundle JSON:\n${JSON.stringify(input.bundle, null, 2)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildProjectImprovementSystemPrompt() {
  return [
    'あなたは NightWorkers の Project Evaluation から改善候補を生成する専用 planner です。',
    '保存済み evaluation と選択された評価軸だけを主入力にし、未選択軸を主目的にしないでください。',
    '各 idea は NightWorkers Task に変換できる agentPrompt、expectedOutcome、implementationFocus、scoreImpacts を必ず持たせてください。',
    '出力は指定 JSON schema だけにしてください。説明文や Markdown は含めないでください。',
  ].join('\n');
}

export function buildProjectImprovementUserPrompt(input: {
  evaluation: ProjectEvaluationRun;
  bundle: ProjectEvaluationBundle;
  dimensionKeys: ProjectEvaluationDimensionKey[];
}) {
  const selectedDimensions = input.evaluation.dimensions.filter((dimension) =>
    input.dimensionKeys.includes(dimension.key)
  );
  return [
    '次の保存済み評価から focused improvement ideas を生成してください。',
    '',
    `選択評価軸:\n${selectedDimensionLines(input.dimensionKeys)}`,
    '',
    '要求:',
    '- 選択軸ごとに 100 点へ近づく候補を複数出す。',
    '- 1 idea は単独で実行可能な粒度にする。',
    '- agentPrompt は日本語で、実装者がそのまま Task として実行できる内容にする。',
    '- expectedOutcome と implementationFocus は検証しやすい表現にする。',
    '',
    `Selected dimensions JSON:\n${JSON.stringify(selectedDimensions, null, 2)}`,
    '',
    `Evaluation JSON:\n${JSON.stringify(input.evaluation, null, 2)}`,
    '',
    `Bundle summary JSON:\n${JSON.stringify(
      {
        repository: input.bundle.repository,
        scripts: input.bundle.inputs.scripts,
        missingInputs: input.bundle.missingInputs,
        notVerified: input.bundle.notVerified,
      },
      null,
      2
    )}`,
  ].join('\n');
}
