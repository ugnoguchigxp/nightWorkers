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

export function loadFlatProcedure(
  jobType: JobType,
  directory = defaultFlatProcedureDirectory()
): string {
  const filePath = path.join(directory, `${jobType}.md`);
  return fs.readFileSync(filePath, 'utf8');
}

export function defaultFlatProcedureDirectory(): string {
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
      input.taskId ? `現在のTask ID: ${input.taskId}` : null,
      externalAllowedPaths.length > 0
        ? `許可済み外部パス: ${externalAllowedPaths.join(', ')}`
        : '許可済み外部パス: なし',
      '',
    ].filter((line): line is string => line !== null),
    runtimeContext: [
      ...(codexGuidance ? [codexGuidance] : []),
      '[Procedure Access]',
      'Procedure documents are not preloaded.',
      'Use read_procedure when procedure detail is needed.',
      'Use search_procedure when the appropriate procedure is unclear.',
      'If loadedProcedureSummaries already contains the current jobType and digest, prefer that summary instead of reading again.',
      '',
    ],
    userRequest: [],
    executionEvidence: [
      '[Minimum Execution Contract]',
      '- latestUserMessage is the source user request; if it contains <STATE_CARD>, use its target and Relevant code as current continuity context.',
      '- Execution order: specification -> Todo execution -> verification -> closeout.',
      '- For major_code_edit, call todo_list operation=replace before repository edits or verification.',
      '- TodoList is run-internal progress, not a Workbench Task or queue item.',
      '- todo_list operation=replace only creates or resets the run-local Todo plan. It does not complete any Todo.',
      '- operation=replace に closeout Todo を含めない。NightWorkers が最後に「知識登録を行う」と「完了報告を行う」を別々のゲートとして追加する。',
      '- 「知識登録を行う」は start/done せず、context-still.register_candidates の成功後に自動完了される。「完了報告を行う」は最後の assistant 完了報告でのみ自動完了される。',
      '- operation=replace に広域 verify Todo を含めない。NightWorkers が最後に quality_gate_verify Todo を追加する。その Todo が current になる前は typecheck、lint、unit test、build、targeted E2E などの focused checks に留める。',
      '- リポジトリ全体の広域 verify は、追加された quality_gate_verify Todo が current のときだけ実行する。広域 verify 成功後にファイル変更がなければ、再度広域 verify を実行しない。',
      '- After operation=replace, leave the first Todo running unless evidence says another Todo should start instead.',
      '- Do not call todo_list operation=done immediately after operation=replace just to acknowledge setup. done requires concrete tool evidence for the current Todo.',
      '- todo_list operation=done completes the current running Todo or the specified running seq and auto-starts the next pending Todo when one exists.',
      '- Use todo_list operation=block for approval/input waits, and operation=fail for concrete implementation or verification failures. Neither auto-starts the next Todo.',
      '- Do not start a later Todo while an earlier Todo is still pending or running. If verification cannot run or fails, close that verification Todo with fail or block before closeout.',
      '- A failed, blocked, or skipped Todo is terminal. Do not restart it; continue only when no earlier Todo remains pending or running.',
      '- Planning is not closeout. Do not call context-still.compile_eval during planning, Todo registration, or immediately after a Todo tracking failure.',
      '- closeout starts only after implementation and verification are genuinely finished and no implementation Todo remains pending or running.',
      '- If todo_list operation=done or operation=start fails but the next implementation action is still unambiguous, continue the implementation work and report the tracking failure separately. Tracking failure is not task completion.',
      '- If target path is known, read_file before editing.',
      '- Use search_files only when target path is unknown or repository-local search is needed.',
      '- The project root itself is the current workspace even when it is empty.',
      '- Empty project roots are valid starting points for new-project or new-file requests; do not mark needs_human solely because no existing files or entry points are present.',
      '- When a project root is empty and the requested output can be created from the specification, continue with import_project, copy_directory, or apply_patch.',
      '- For major_code_edit in an empty Project root, the first todo_list operation=replace must include a dedicated bootstrap Todo that explicitly names the workspace-creation tool you will use, such as import_project, copy_directory, or apply_patch.',
      '- Paths outside the project root require explicit user approval in safetyPolicy.externalAllowedPaths before list_dir/read_file/copy_directory/run_command can use them.',
      '- If the requested external source is listed in 許可済み外部パス, treat it as approved and call the appropriate worker tool instead of asking for the same permission again.',
      '- Treat the worker tools as the execution interface, not as advisory text. When a registered tool matches the task, call that tool instead of describing shell steps that would do the same work.',
      '- For task specification or implementation-plan work, call read_current_specification first and ground the next steps in that artifact instead of guessing from the user message alone.',
      '- Use import_project as the single Project import entrypoint. For new scaffolds, pass source=starter with stack/variant. For arbitrary Git repository imports, pass source=git with repoUrl.',
      '- For unspecified new Web/API apps, prefer import_project with source=starter, stack=hono, and the default SQLite variant unless the user explicitly asks for a blank project or another stack.',
      '- If the user specifies a DB, choose the matching starter variant such as postgres, pgvector, turso, or cloudflare. If the user asks for RAG, knowledge-base search, embeddings-backed document search, or agentic search, choose variant=rag on the hono stack. If the user specifies SSR or SSG without a DB/RAG variant, pass the matching overlay. Do not combine a DB/RAG variant and an overlay in one import_project call.',
      '- Use stack=python when the user explicitly asks for Python/FastAPI, or when the requirements need ML usage or substantial mathematical/scientific computation.',
      '- Do not use run_command git clone when import_project covers the task; import_project owns provenance, target-path policy, and nested .git handling for both standard templates and arbitrary Git imports.',
      '- For template imports from an approved external directory, prefer copy_directory over shell cp.',
      '- For template imports, TodoList must include manifest inspection and verification tasks before finalize_answer.',
      '- After import_project succeeds, first use postImport.llmContext when present, plus postImport.manifest and postImport.initialization. Do not re-read LLM_CONTEXT.md, package.json, or re-run install unless that payload is missing, truncated, or failed for a reason you are actively fixing.',
      '- Use postImport.manifest.recommendedVerificationCommands when choosing manifest-based verification before reporting completion.',
      '- After copy_directory succeeds, read package.json and/or pyproject.toml, choose relevant checks such as build/lint/typecheck/test/verify/pytest/ruff/pyright, and run them via run_verification when present.',
      '- Do not call finalize_answer while any Todo is pending or running; close the current Todo with todo_list operation=done, operation=block, or operation=fail first.',
      '- Do not claim tool execution without an observation in toolResults.',
      '- Repository reads/writes must use worker tools. CLI commands are allowed only through run_command/run_verification and only when the command policy accepts the single command.',
      '- run_command and run_verification return full stdout/stderr by default. Keep that default when exact CLI evidence matters, especially for git, install, build, and verification commands.',
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
