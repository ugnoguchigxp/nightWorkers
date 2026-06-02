import type { FinalJudgment } from './types';

export function renderFinalMessage(judgment: FinalJudgment): string {
  const sections = [
    `【${judgment.title}】`,
    judgment.conclusion || '最終判断本文がありません。',
    '',
    `- 証拠: ${judgment.evidenceSummary.length ? judgment.evidenceSummary.join(' / ') : 'none'}`,
    `- 実施内容: ${judgment.actionsTaken.length ? judgment.actionsTaken.join(' / ') : 'none'}`,
    `- 残リスク: ${judgment.residualRisk.length ? judgment.residualRisk.join(' / ') : 'none'}`,
  ];

  if (judgment.issues.length) {
    sections.push('', `- 課題: ${judgment.issues.join(' / ')}`);
  }
  if (judgment.debugReason) {
    sections.push('', `- 補足: ${judgment.debugReason}`);
  }

  return sections.join('\n');
}
