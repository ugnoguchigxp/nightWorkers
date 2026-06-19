import { renderCodexAgentsGuidance } from '../codex-global-config/agents-guidance';
import { renderSupervisorSystemPrompt, type SupervisorPromptPacket } from './prompt-packet';
import {
  jobTypeDescriptions,
  jobTypes,
  renderToolDefinitions,
  toolRegistry,
} from './prompt-tool-registry';

export {
  getAllowedToolsForJobType,
  getExecutableWorkerToolName,
  initiallyImplementedJobTypes,
  type JobType,
  jobTypeDescriptions,
  jobTypes,
  renderToolDefinitions,
  type SupervisorToolName,
  type TodoToolName,
  type ToolDefinition,
  toolRegistry,
  validateToolCallForJobType,
} from './prompt-tool-registry';

export function buildRound1JobTypePrompt(projectRoot: string): string {
  return renderSupervisorSystemPrompt(buildRound1PromptPacket(projectRoot));
}

export function buildRound1PromptPacket(projectRoot: string): SupervisorPromptPacket {
  const codexGuidance = renderCodexAgentsGuidance(projectRoot).text;
  return {
    basePolicy: [
      'jobType と goal を1つずつ選んでください。',
      'goal はこの run で達成する状態を短い一文で書く。',
      'planning は、ユーザーが計画、実装計画、設計方針、仕様策定、質問票化、事前整理を明示した場合だけ選んでください。',
      '修正、実装、確認、調査、レビュー、テスト、設定変更、依存更新、リファクタを依頼している場合は planning ではなく、実行可能な jobType を選んでください。',
      'JSON のみ。旧 decision 形式や toolCall は出さない。',
      '',
    ],
    roundPolicy: [],
    projectContext: [`プロジェクトルート: ${projectRoot}`, ''],
    runtimeContext: [
      ...(codexGuidance ? [codexGuidance] : []),
      '[Job Types]',
      jobTypes.map((jobType) => `- ${jobType}: ${jobTypeDescriptions[jobType]}`).join('\n'),
      '',
      '[Tool Overview]',
      renderToolDefinitions(Object.values(toolRegistry)),
      '',
    ],
    userRequest: [],
    executionEvidence: [],
    outputContract: [
      '[Output Schema]',
      '{ "jobType": "<job type>", "goal": "<short concrete goal>" }',
    ],
    diagnostics: {
      round: 1,
      projectRoot,
    },
  };
}
