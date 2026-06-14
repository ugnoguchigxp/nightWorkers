import { getNightWorkersCodexToolNames } from '../../../mcp/nightworkers-tool-manifest';
import type { AgentRunContext } from '../types';

export function buildCodexRuntimePrompt(context: AgentRunContext): string {
  const request = (context.latestUserMessage || context.compiledPrompt).trim();
  const nightWorkersToolList = getNightWorkersCodexToolNames().join(', ');
  const contract = [
    '[NightWorkers Runtime Contract]',
    `taskId: ${context.taskId}`,
    `runId: ${context.runId}`,
    `repoRoot: ${context.repoRoot}`,
    '',
    'NightWorkers MCP:',
    '- MCP server name: nightworkers',
    `- Available NightWorkers MCP tools in this lane: ${nightWorkersToolList}.`,
    '- If context-still.initial_instructions has not run in this NightWorkers run, run it before other task work and follow it.',
    '- Treat nightworkers MCP tools as the execution interface. When a named NightWorkers tool fits, call it directly instead of describing equivalent shell steps.',
    '',
    'Minimal implementation behavior:',
    '- ユーザーが実装計画、仕様化、設計文書、Plan mode、要件整理を明示していない場合は、計画文書で止まらず、必要最小限の確認後に実装へ進む。',
    '- 小さく明確なコード変更では Todo 分解をコンパクトに保つ。着手のためだけに詳細な implementation-plan artifact を作らない。',
    '- 小さい変更でも Todo tracking、LLM コードレビュー、品質ゲート verify、closeout は省略しない。',
    '- nightworkers.read_current_specification は、ユーザーが planning/specification work を求めた場合、または既存仕様が明確な source of truth の場合に使う。小さいコード変更で仕様 artifact がないことだけを理由に停止しない。',
    '- Execution order: specification -> Todo execution -> verification -> closeout.',
    '- Planning is not closeout. During planning or Todo setup, do not call context-still.compile_eval.',
    '- closeout starts only after implementation and verification are genuinely finished and no implementation Todo remains pending or running.',
    '- Use nightworkers.todo_list as the single Todo control tool.',
    '- For multi-step work, call nightworkers.todo_list operation=replace once near the start. This defines or refreshes the Todo plan; it does not complete any Todo and cannot reopen completed, failed, blocked, or skipped Todos.',
    '- operation=replace に closeout Todo を含めない。NightWorkers が最後に「知識登録を行う」と「完了報告を行う」を別々のゲートとして追加する。',
    '- 「知識登録を行う」は start/done せず、context-still.register_candidates の成功後に自動完了される。「完了報告を行う」は最後の assistant 完了報告でのみ自動完了される。',
    '- operation=replace に広域 verify Todo を含めない。NightWorkers が最後に quality_gate_verify Todo を追加する。その Todo が current になる前は typecheck、lint、unit test、build、targeted E2E などの focused checks に留める。',
    '- リポジトリ全体の広域 verify は、追加された quality_gate_verify Todo が current のときだけ実行する。広域 verify 成功後にファイル変更がなければ、再度広域 verify を実行しない。',
    '- Use operation=done only after concrete evidence exists for the current Todo. done auto-starts the next pending Todo.',
    '- Use operation=block for approval/input waits and operation=fail for concrete implementation or verification failures.',
    '- Do not start a later Todo while an earlier Todo is still pending or running. If verification cannot run or fails, close that verification Todo with fail or block first.',
    '- A failed, blocked, or skipped Todo is terminal. Do not try to restart it; continue only to closeout when no earlier Todo is pending or running.',
    '- If a Todo-tracking MCP call fails but the next implementation action is still clear, continue the implementation work. Tracking failure is not task completion.',
    '- After an implementation, scaffold, or verification Todo is running, do not stop with a plan-only answer or next-steps summary. Continue the concrete work, or close the current Todo with block/fail and explain the blocker.',
    '- For explicit planning, implementation-plan, specification, design-doc, requirement-check work, or implementation work grounded in an existing specification, call nightworkers.read_current_specification first. If missing and the task depends on a specification artifact, use nightworkers.list_recent_specifications and then read by taskId.',
    '- Ground plans and verification steps in the specification content when available.',
    '- Use nightworkers.import_project as the single Project import entrypoint. For new scaffolds, pass source=starter with stack/variant. For arbitrary Git imports, pass source=git with repoUrl.',
    '- For unspecified new Web/API apps in an empty or near-empty Project root, use source=starter, stack=hono, and the default SQLite variant unless the user explicitly asks for another stack, blank project, or a DB/RAG/SSR/SSG variant.',
    '- If the user specifies a DB, choose the matching starter variant such as postgres, pgvector, turso, or cloudflare. If the user asks for RAG or embeddings-backed search, choose variant=rag on the hono stack. If the user specifies SSR or SSG without a DB/RAG variant, pass the matching overlay. Do not combine a DB/RAG variant and an overlay in one call.',
    '- Do not use shell git clone when nightworkers.import_project covers the task.',
    '- If nightworkers.import_project fails, is cancelled, or is not approved, stop and report the tool failure. Do not create a fallback static app or alternate implementation.',
    '- After import_project succeeds, first use postImport.gitInitialization, postImport.llmContext when present, plus postImport.manifest and postImport.initialization. Do not re-read LLM_CONTEXT.md, package.json, or re-run install unless that payload is missing, truncated, or failed for a reason you are actively fixing.',
    '- Use postImport.manifest.recommendedVerificationCommands when choosing manifest-based verification before reporting completion.',
    '- CLI checks appear as Codex native command_execution events, not NightWorkers MCP tools. Preserve important command, exit code, stdout, and stderr evidence in the final report.',
  ].join('\n');
  return request ? `${request}\n\n${contract}` : contract;
}
