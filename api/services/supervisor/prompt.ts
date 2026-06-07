import fs from 'node:fs';
import path from 'node:path';
import { getResourceRoot } from '../../runtime/paths';
import { renderCodexAgentsGuidance } from '../codex-global-config/agents-guidance';
import {
  type Round2PromptPacketInput,
  renderSupervisorSystemPrompt,
  type SupervisorPromptPacket,
} from './prompt-packet';
import {
  type JobType,
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

export function loadFlatSkill(jobType: JobType, directory = defaultFlatSkillDirectory()): string {
  const filePath = path.join(directory, `${jobType}.md`);
  return fs.readFileSync(filePath, 'utf8');
}

export function defaultFlatSkillDirectory(): string {
  return path.join(getResourceRoot(), 'api/services/supervisor/skills/flat');
}

export function buildRound1JobTypePrompt(projectRoot: string): string {
  return renderSupervisorSystemPrompt(buildRound1PromptPacket(projectRoot));
}

export function buildRound1PromptPacket(projectRoot: string): SupervisorPromptPacket {
  const codexGuidance = renderCodexAgentsGuidance(projectRoot).text;
  return {
    basePolicy: [
      'jobType と goal を1つずつ選んでください。',
      'goal はこの run で達成する状態を短い一文で書く。',
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

export function buildRound2ToolCallPrompt(input: Round2PromptPacketInput): string {
  return renderSupervisorSystemPrompt(buildRound2PromptPacket(input));
}

export function buildRound2PromptPacket(input: Round2PromptPacketInput): SupervisorPromptPacket {
  const externalAllowedPaths = input.externalAllowedPaths || [];
  const codexGuidance = renderCodexAgentsGuidance(input.projectRoot).text;
  return {
    basePolicy: [
      `jobType=${input.jobType}`,
      '次の toolCall を1つだけ返してください。',
      'JSON のみ。旧 decision 形式や説明用フィールドは出さない。',
      '完了したと判断したら finalize_answer を返す。',
      'finalize_answer.message でプロジェクト内のファイルに触れる場合は、プロジェクトルートからの相対パスで書く。',
      '',
    ],
    roundPolicy: [],
    projectContext: [
      `プロジェクトルート: ${input.projectRoot}`,
      externalAllowedPaths.length > 0
        ? `許可済み外部パス: ${externalAllowedPaths.join(', ')}`
        : '許可済み外部パス: なし',
      '',
    ],
    runtimeContext: [
      ...(codexGuidance ? [codexGuidance] : []),
      '[Skill Access]',
      'SKILL documents are not preloaded.',
      'Use read_skill when procedure detail is needed.',
      'Use search_skill when the appropriate SKILL is unclear.',
      'If loadedSkillSummaries already contains the current jobType and digest, prefer that summary instead of reading again.',
      '',
    ],
    userRequest: [],
    executionEvidence: [
      '[Minimum Execution Contract]',
      '- latestUserMessage is the source user request; if it contains <STATE_CARD>, use its target and Relevant code as current continuity context.',
      '- For major_code_edit, call replace_todo_list before repository edits or verification.',
      '- TodoList is run-internal progress, not a Workbench Task or queue item.',
      '- Mark only active work as running; use passed only after tool evidence shows that Todo is complete.',
      '- If target path is known, read_file before editing.',
      '- Use search_files only when target path is unknown or repository-local search is needed.',
      '- The project root itself is the current workspace even when it is empty.',
      '- Paths outside the project root require explicit user approval in safetyPolicy.externalAllowedPaths before list_dir/read_file/copy_directory/run_command can use them.',
      '- If the requested external source is listed in 許可済み外部パス, treat it as approved and call the appropriate worker tool instead of asking for the same permission again.',
      '- For template imports from an approved external directory, prefer copy_directory over shell cp.',
      '- For template imports, TodoList must include package.json inspection and package-script verification tasks before finalize_answer.',
      '- After copy_directory succeeds, read package.json, choose relevant scripts such as build/lint/typecheck/test/verify, and run them via run_verification when present.',
      '- Do not call finalize_answer while any Todo is pending or running; call complete_todo for each completed Todo first.',
      '- Do not claim tool execution without an observation in toolResults.',
      '- Repository reads/writes must use worker tools. CLI commands are allowed only through run_command/run_verification and only when the command policy accepts the single command.',
      '- After apply_patch succeeds, inspect changed target files before finalize_answer.',
      '',
    ],
    outputContract: [
      '[Allowed Tools]',
      renderToolDefinitions(input.tools),
      '',
      '[Output Schema]',
      '{ "toolCall": { "name": "<tool>", "arguments": { } } }',
    ],
    diagnostics: {
      round: 2,
      projectRoot: input.projectRoot,
      jobType: input.jobType,
      allowedToolNames: input.tools.map((tool) => tool.name),
    },
  };
}
