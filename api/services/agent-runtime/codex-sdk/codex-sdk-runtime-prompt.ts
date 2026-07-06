import { getNightWorkersCodexToolNames } from '../../../mcp/nightworkers-tool-manifest';
import { estimateTokens } from '../../conversation-context/token-budget';
import {
  formatOntologyCloseoutRequirementsForPrompt,
  formatOntologyRuntimeContextForPrompt,
} from '../ontology-runtime-context';
import type { AgentRunContext } from '../types';

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
  return buildCodexRuntimePromptParts(context).prompt;
}

export type CodexRuntimePromptParts = {
  prompt: string;
  request: string;
  runtimeContract: string;
  estimates: {
    requestTokens: number;
    runtimeContractTokens: number;
    fullPromptTokens: number;
  };
};

export function buildCodexRuntimePromptParts(context: AgentRunContext): CodexRuntimePromptParts {
  const request = (context.latestUserMessage || context.compiledPrompt).trim();
  const executionMode = readCodexRuntimeExecutionMode(context);
  const nightWorkersToolList = getNightWorkersCodexToolNames({ executionMode }).join(', ');
  const runtimeContract =
    executionMode === 'general_answer'
      ? buildGeneralAnswerContract(context, nightWorkersToolList)
      : buildExecutionContract(context, nightWorkersToolList, executionMode);
  const prompt = request ? `${request}\n\n${runtimeContract}` : runtimeContract;
  return {
    prompt,
    request,
    runtimeContract,
    estimates: {
      requestTokens: estimateTokens(request),
      runtimeContractTokens: estimateTokens(runtimeContract),
      fullPromptTokens: estimateTokens(prompt),
    },
  };
}

function buildGeneralAnswerContract(context: AgentRunContext, nightWorkersToolList: string) {
  const readOnlyToolList =
    nightWorkersToolList
      .split(', ')
      .filter(
        (toolName) =>
          toolName !== 'nightworkers.todo_list' && toolName !== 'nightworkers.import_project'
      )
      .join(', ') || 'none';
  return [
    '[NightWorkers Runtime Contract]',
    `taskId: ${context.taskId}`,
    `runId: ${context.runId}`,
    `repoRoot: ${context.repoRoot}`,
    'executionMode: general_answer',
    'Plan mode: disabled. この run は質問への回答用です。Plan Mode artifact を作成・更新せず、実装編集も行わず、必要な読み取り確認だけで回答してください。',
    '',
    'NightWorkers MCP:',
    '- MCP server name: nightworkers',
    `- Available read-only NightWorkers MCP tools in this lane: ${readOnlyToolList}.`,
    '',
    'General answer behavior:',
    '- ユーザーの質問に答えるための読み取り確認だけを行う。',
    '- Plan Mode artifact、Plan Mode Workspace、TodoList、Implementation Queue を作成・更新しない。',
    '- 実装編集、テスト実行、レビュー、verify、closeout gate を開始しない。',
    '- 完了済みの Plan Mode artifact は証跡として扱い、後続の質問で再編集・再オープン対象にしない。',
    '- 回答に必要な根拠が確認できたら、短く直接回答する。',
  ].join('\n');
}

function buildExecutionContract(
  context: AgentRunContext,
  nightWorkersToolList: string,
  executionMode: ReturnType<typeof readCodexRuntimeExecutionMode>
) {
  if (executionMode === 'planning') {
    return buildPlanningContract(context, nightWorkersToolList);
  }
  const planModeContract =
    'Plan mode: disabled. ユーザーはこの run で Plan Mode を明示していない。計画だけの回答で止まらず、implementation-plan artifact を主成果物として作らない。';
  const contract = [
    '[NightWorkers Runtime Contract]',
    `taskId: ${context.taskId}`,
    `runId: ${context.runId}`,
    `repoRoot: ${context.repoRoot}`,
    `executionMode: ${executionMode}`,
    planModeContract,
    '',
    'NightWorkers MCP:',
    '- MCP server name: nightworkers',
    `- Available NightWorkers MCP tools in this lane: ${nightWorkersToolList}.`,
    '- If context-still.initial_instructions has not run in this NightWorkers run, run it before other task work and follow it.',
    '- Treat nightworkers MCP tools as the execution interface. When a named NightWorkers tool fits, call it directly instead of describing equivalent shell steps.',
    '',
    'Module ontology protocol:',
    formatOntologyRuntimeContextForPrompt(context.contextSnapshot.ontologyContext),
    '- When ontology tools are available and the task is not a trivial single-file edit, classify the goal with nightworkers.classify_goal before broad exploration.',
    '- Compile module context with nightworkers.compile_module_context, then search owned paths before repository-wide search.',
    '- Run nightworkers.check_boundary before planned edits outside owned paths; do not silently edit unknown or forbidden paths.',
    '- Use nightworkers.get_verification_plan to prefer focused verification from the primary module and add secondary verification only for declared crossings.',
    '- Final reports for ontology-guided work must include primary module, secondary modules, boundary crossings, invariants checked, verification run, and skipped verification reasons.',
    formatOntologyCloseoutRequirementsForPrompt(),
    '',
    'Minimal implementation behavior:',
    '- ユーザーが実装計画、仕様化、設計文書、Plan mode、要件整理を明示していない場合は、計画文書で止まらず、必要最小限の確認後に実装へ進む。',
    '- 小さく明確なコード変更では Todo 分解をコンパクトに保つ。着手のためだけに詳細な implementation-plan artifact を作らない。',
    '- 小さい変更でも Todo tracking、LLM コードレビュー、品質ゲート verify コマンド、closeout は省略しない。',
    '- nightworkers.read_current_specification は、ユーザーが planning/specification work を求めた場合、または既存仕様が明確な source of truth の場合に使う。小さいコード変更で仕様 artifact がないことだけを理由に停止しない。',
    '- Execution order: specification -> Todo execution -> verification -> closeout.',
    '- Planning is not closeout. During planning or Todo setup, do not call context-still.compile_eval.',
    '- closeout starts only after implementation and verification are genuinely finished and no implementation Todo remains pending or running.',
    '- NightWorkers における「完了報告」は、TodoList の最後に追加される「完了報告を行う」closeout gate の final assistant report を指す。',
    '- Todo 作成結果、計画共有、途中経過、次に着手する旨の assistant message は完了報告ではない。',
    '- context-still.compile_eval は、implementation / review / verification / knowledge_capture が terminal になり、open Todo が completion_report だけになった final assistant report 直前にだけ実行する。',
    '- pending または running の Todo が残っている間、特に nightworkers.todo_list operation=replace 直後や context_compile 直後には context-still.compile_eval を呼ばない。',
    '- Use nightworkers.todo_list as the single Todo control tool.',
    '- TodoList pane is the user-visible progress source of truth. Timeline cards are not the mechanism for Todo progress or internal Todo contract warnings.',
    '- 2 手以上の調査、レビュー、実装、検証を行う場合は、最初の実質作業前に既存 Todo を start するか、作業内容に合わない場合だけ operation=replace で UI 追跡可能な TodoList にする。',
    '- 作業段階が変わる tool 実行の前に対応 Todo を running にし、ファイル編集、DB mutation、長い検証、review 判定の後は具体的 evidence に基づいて done/block/fail のいずれかで整理する。',
    '- nightworkers.todo_list operation=replace is a structural replanning operation for the TodoList itself. Use it when the scope, estimate, decomposition, or required work changed; do not use it to mark the current Todo complete.',
    '- Use nightworkers.todo_list operation=start/done/block/fail for existing Todo state transitions. Use nightworkers.todo_list operation=done only after concrete evidence exists for the current Todo; it auto-starts the next pending Todo.',
    '- Do not call nightworkers.todo_list operation=list to make progress. list is read-only diagnostics and does not change TodoList or task state.',
    '- final assistant report の前に open Todo を確認し、未完了 Todo がある場合は done/block/fail に整理する。未確認 mutation や未実施 verification を done にしない。',
    '- nightworkers.todo_list operation=replace に closeout Todo を含めない。NightWorkers が最後に「知識登録を行う」と「完了報告を行う」を別々のゲートとして追加する。',
    '- 「知識登録を行う」は start/done せず、context-still.register_candidates の成功後に自動完了される。「完了報告を行う」は最後の assistant 完了報告でのみ自動完了される。',
    '- nightworkers.todo_list operation=replace に広域 verify Todo を含めない。NightWorkers が最後に quality_gate_verify Todo を追加する。その Todo が current になる前は typecheck、lint、unit test、build、targeted E2E などの focused checks に留める。',
    '- リポジトリ全体の広域 verify は、追加された quality_gate_verify Todo が current のときだけ実行する。広域 verify 成功後にファイル変更がなければ、再度広域 verify を実行しない。',
    '- DB schema 変更、migration、永続化テーブル追加を伴う実装では、TodoList に migration 作成、対象 DB への migration 実行、既存 migration を使う実 DB focused integration test 追加、migration 後の schema/API/test 検証を独立 Todo として含める。固定 Todo を明示する場合は procedureId=data_migration.create_migration / data_migration.apply_migration / data_migration.add_integration_test / data_migration.verify_migration を使う。',
    '- migration 由来の integration test は一時 DB または隔離された test DB に既存 migration を適用して確認する。テスト内で schema を手書き再現せず、既存 DB を汚さない。全体 verify Todo は NightWorkers が追加するため、migration を理由に広域 verify Todo を追加しない。',
    '- migration を作っただけで完了扱いにしない。migration 実行と migration 後検証の evidence がない場合は final assistant report に進まず、該当 Todo を block または fail にする。',
    '- ファイルを編集する前に、対象ファイルまたは直接関係する既存ファイルを読む。小さい変更でも既存パターン確認を省略しない。',
    '- 新規ファイル作成では、配置先の route、registry、sibling component、既存 style、または test pattern を先に読む。',
    '- rg --files や ls は探索であり、編集対象を読んだ evidence ではない。rg -n、sed、cat、nl、head/tail、git diff -- path など、対象パスの内容に触れる確認を使う。',
    '- 読んだ内容に基づかない blind edit を避ける。必要な範囲だけを読み、リポジトリ全体を読む指示にはしない。',
    '- コード変更後、package.json に verify script が存在する場合は、完了報告前の代表検証として verify command を最優先で実行する。typecheck / lint / test / build の個別実行は、修正途中の focused check、または verify script が存在しない・実行不能な場合の fallback とする。verify を実行しなかった場合は、完了報告に理由と代替検証を明記する。',
    '- Use nightworkers.todo_list operation=block for approval/input waits and nightworkers.todo_list operation=fail for concrete implementation or verification failures.',
    '- Do not start a later Todo while an earlier Todo is still pending or running. If verification cannot run or fails, close that verification Todo with fail or block first.',
    '- A failed, blocked, or skipped Todo is terminal. Do not try to restart it; continue only to closeout when no earlier Todo is pending or running.',
    '- If a Todo-tracking MCP call fails but the next implementation action is still clear, continue the implementation work. Tracking failure is not task completion.',
    '- After an implementation, scaffold, or verification Todo is running, do not stop with a plan-only answer or next-steps summary. Continue the concrete work, or close the current Todo with block/fail and explain the blocker.',
    '- For explicit planning, implementation-plan, specification, design-doc, requirement-check work, or implementation work grounded in an existing specification, call nightworkers.read_current_specification first. Pass includeDesignContext=true when Plan Mode artifact contracts may affect implementation. If missing and the task depends on a specification artifact, use nightworkers.list_recent_specifications and then read by taskId.',
    '- Ground plans and verification steps in the specification content when available. Ground API/UI/DB/Zod/flow implementation details in the assembled design context when returned.',
    '- Use nightworkers.import_project as the single Project import entrypoint. For new scaffolds, pass source=starter with stack/variant. For arbitrary Git imports, pass source=git with repoUrl.',
    '- For unspecified new Web/API apps in an empty or near-empty Project root, use source=starter, stack=hono, and the default SQLite variant unless the user explicitly asks for another stack, blank project, or a DB/RAG/SSR/SSG variant.',
    '- If the user specifies a DB, choose the matching starter variant such as postgres, pgvector, turso, or cloudflare. If the user asks for RAG or embeddings-backed search, choose variant=rag on the hono stack. If the user specifies SSR or SSG without a DB/RAG variant, pass the matching overlay. Do not combine a DB/RAG variant and an overlay in one call.',
    '- Do not use shell git clone when nightworkers.import_project covers the task.',
    '- If nightworkers.import_project fails, is cancelled, or is not approved, stop and report the tool failure. Do not create a fallback static app or alternate implementation.',
    '- After import_project succeeds, first use postImport.gitInitialization, postImport.llmContext when present, plus postImport.manifest and postImport.initialization. Do not re-read LLM_CONTEXT.md, package.json, or re-run install unless that payload is missing, truncated, or failed for a reason you are actively fixing.',
    '- Use postImport.manifest.recommendedVerificationCommands when choosing manifest-based verification before reporting completion.',
    '- CLI checks appear as Codex native command_execution events, not NightWorkers MCP tools. Preserve important command, exit code, stdout, and stderr evidence in the final report.',
  ].join('\n');
  return contract;
}

function buildPlanningContract(context: AgentRunContext, nightWorkersToolList: string) {
  return [
    '[NightWorkers Runtime Contract]',
    `taskId: ${context.taskId}`,
    `runId: ${context.runId}`,
    `repoRoot: ${context.repoRoot}`,
    'executionMode: planning',
    'Plan mode: enabled. ユーザーは計画、仕様化、設計作業を明示的に依頼している。ユーザーが実装へ移るよう依頼するまで、実装編集は行わない。',
    '',
    'NightWorkers MCP:',
    '- MCP server name: nightworkers',
    `- Available read-only NightWorkers MCP tools in this lane: ${nightWorkersToolList || 'none'}.`,
    '- If context-still.initial_instructions has not run in this NightWorkers run, run it before other task work and follow it.',
    '',
    'Planning behavior:',
    '- リポジトリの読み取り、既存仕様の確認、実装計画の作成に限定する。',
    '- Project import、TodoList mutation、ファイル編集、実装、検証、closeout gate を開始しない。',
    '- 実装に移るにはユーザーの明示依頼が必要です。',
    '- 完了時は、実装順、検証ゲート、停止条件を含む計画を短く具体的に返す。',
  ].join('\n');
}

function readCodexRuntimeExecutionMode(context: AgentRunContext) {
  const value = context.runtimeOptions?.executionMode;
  if (
    value === 'planning' ||
    value === 'implementation' ||
    value === 'review' ||
    value === 'runtime_debug' ||
    value === 'general_answer'
  ) {
    return value;
  }
  const snapshotValue = context.contextSnapshot.executionMode;
  if (
    snapshotValue === 'planning' ||
    snapshotValue === 'implementation' ||
    snapshotValue === 'review' ||
    snapshotValue === 'runtime_debug' ||
    snapshotValue === 'general_answer'
  ) {
    return snapshotValue;
  }
  return 'implementation';
}
