import type {
  FinalJudgment,
  FinalJudgmentInput,
  FinalJudgmentSource,
  SupervisorResultLike,
} from './types';

function buildResidualRisk(level: SupervisorResultLike['riskLevel']) {
  if (level === 'high') {
    return ['high', 'LLM の判断またはツール実行の再確認を推奨します。'];
  }
  if (level === 'medium') {
    return ['medium', '実行結果を確認してから完了扱いしてください。'];
  }
  return ['low', '残リスクは低いです。'];
}

function buildTitle(status: FinalJudgment['status']) {
  if (status === 'completed') return '実行完了';
  if (status === 'needs_review') return 'レビュー待ちで完了';
  if (status === 'needs_human') return '人手確認が必要';
  if (status === 'blocked') return 'ブロックにより停止';
  if (status === 'timed_out') return 'タイムアウト';
  if (status === 'cancelled') return 'キャンセル';
  return '実行失敗';
}

function resolveSource(supervisor: SupervisorResultLike, finalReport: string): FinalJudgmentSource {
  if (finalReport.trim()) return 'supervisor_final_response';
  if (supervisor.stoppedBy === 'llm_error' || supervisor.terminalState === 'failed') {
    return 'llm_repair_finalizer';
  }
  return 'deterministic_fallback';
}

export function buildFinalJudgment(input: FinalJudgmentInput): FinalJudgment {
  const finalReport = String(input.supervisor.finalReport || '').trim();
  const summary = String(
    input.outcomeSummary || input.supervisor.summary || 'Supervisor ループの最終結果が未提供です。'
  );
  const title = buildTitle(input.outcomeStatus);
  const source = resolveSource(input.supervisor, finalReport);

  const actionsTaken = [
    `Supervisor 終端ステータス: ${input.supervisor.terminalState || input.outcomeStatus}`,
    `停止要因: ${input.supervisor.stoppedBy || 'decision'}`,
  ];
  if (input.decisionTrace) {
    actionsTaken.push(`決定トレース: ${input.decisionTrace}`);
  }

  const conclusion = finalReport || `${title}: ${summary}`;
  const evidenceSummary = [
    `最終状態: ${input.outcomeStatus}`,
    `停止要因: ${input.supervisor.stoppedBy || 'decision'}`,
  ];
  const issues =
    input.outcomeStatus === 'completed' || input.outcomeStatus === 'needs_review'
      ? []
      : [input.outcomeSummary || summary, `ターミナルステータス: ${input.outcomeStatus}`];

  return {
    version: 1,
    runId: input.runId,
    taskId: input.taskId,
    status: input.outcomeStatus,
    title,
    conclusion,
    evidenceSummary,
    actionsTaken,
    issues,
    residualRisk: buildResidualRisk(input.supervisor.riskLevel),
    debugReason: input.supervisor.finalReport ? null : `最終回答を補完（source=${source}）`,
    source,
    createdAt: new Date().toISOString(),
  };
}
