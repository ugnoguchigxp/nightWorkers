import { createHash, randomUUID } from 'node:crypto';
import type { CodexOptions, Thread, ThreadEvent, Usage } from '@openai/codex-sdk';
import { z } from 'zod';
import { appendLlmTrace, appendSupervisorTrace, logger } from '../../lib/logger';
import { listMcpServers } from '../mcp/mcp-settings';
import { buildCodexTurnPrompt } from './prompt';
import {
  defaultSupervisorRoutingHypothesis,
  supervisorModes,
  supervisorOverlays,
  supervisorPhases,
  supervisorWorkKinds,
} from './skills/types';
import { isTemporarilyBlockedExternalToolName } from './TEMP_DISABLE_EXTERNAL_MCP_TOOLS';
import { buildTestProviderDecision } from './test-provider';

const supervisorToolNames = [
  'list_dir',
  'find_file',
  'read_file',
  'inspect_structure',
  'search_files',
  'search_web',
  'fetch_content',
  'apply_patch',
  'replace_content',
  'run_command',
  'run_verification',
  'mcp_call_tool',
  'git_status',
  'git_diff',
] as const;

const supervisorRoutingHypothesisSchema = z
  .object({
    primaryMode: z.enum(supervisorModes).default(defaultSupervisorRoutingHypothesis.primaryMode),
    secondaryModes: z.array(z.enum(supervisorModes)).default([]),
    phase: z.enum(supervisorPhases).default(defaultSupervisorRoutingHypothesis.phase),
    workKinds: z.array(z.enum(supervisorWorkKinds)).default([]),
    overlays: z.array(z.enum(supervisorOverlays)).default([]),
    subtype: z.string().optional(),
    requiredEvidence: z.array(z.string()).default([]),
    nextSkillFiles: z.array(z.string()).default(defaultSupervisorRoutingHypothesis.nextSkillFiles),
    confidence: z.number().min(0).max(1).default(defaultSupervisorRoutingHypothesis.confidence),
  })
  .optional();

const supervisorDecisionBaseSchema = z.object({
  phase: z.enum(['observe', 'plan', 'act', 'verify', 'report', 'stop']),
  workflow: z.enum(['general', 'evidence_review', 'code_change', 'research']).default('general'),
  routingHypothesis: supervisorRoutingHypothesisSchema,
  instruction: z.string().default(''),
  rationale: z.string().default(''),
  finalResponse: z.string().default(''),
  expectedEvidence: z.array(z.string()).default([]),
  terminalState: z
    .enum([
      'needs_review',
      'completed',
      'blocked',
      'failed',
      'timed_out',
      'cancelled',
      'needs_human',
    ])
    .optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).default('low'),
  toolCall: z
    .object({
      name: z.enum(supervisorToolNames),
      arguments: z.any().default({}),
    })
    .nullable()
    .optional(),
});

const round2DecisionSchema = supervisorDecisionBaseSchema.extend({
  toolCall: z
    .object({
      name: z.enum(supervisorToolNames),
      arguments: z.any().default({}),
    })
    .nullable()
    .optional(),
});

export const supervisorDecisionSchema = supervisorDecisionBaseSchema;

export type SupervisorDecision = z.infer<typeof supervisorDecisionSchema>;

type CallSupervisorOptions = {
  tolerateSchemaFailure?: boolean;
  round?: 1 | 2 | 3;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
  timeoutMs?: number;
  workingDirectory?: string;
};

export type SupervisorLlmDebugEvent = {
  type:
    | 'model.request_started'
    | 'model.retry_scheduled'
    | 'model.retry_started'
    | 'model.response_delta'
    | 'model.response_finished'
    | 'model.response_parse_failed'
    | 'model.response_repaired';
  severity: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  data?: Record<string, unknown>;
};

const codexSupervisorFeatureOverrides = {
  image_generation: false,
  plugins: false,
  computer_use: false,
  browser_use: false,
  browser_use_external: false,
  in_app_browser: false,
  multi_agent: false,
  workspace_dependencies: false,
  tool_search: false,
} satisfies Record<string, boolean>;

export function buildCodexSupervisorSdkOptions(accessToken: string): CodexOptions {
  const sdkOptions: CodexOptions = {
    config: {
      features: codexSupervisorFeatureOverrides,
    },
  };
  if (!accessToken) return sdkOptions;

  const mergedEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      const [, value] = entry;
      return typeof value === 'string';
    })
  );
  sdkOptions.env = {
    ...mergedEnv,
    CODEX_ACCESS_TOKEN: accessToken,
  };
  return sdkOptions;
}

export function buildCodexSupervisorThreadOptions(
  model?: string,
  workingDirectory = process.cwd()
) {
  const configuredEffort = process.env.CODEX_MODEL_REASONING_EFFORT;
  const modelReasoningEffort = isCodexReasoningEffort(configuredEffort) ? configuredEffort : 'low';
  return {
    model,
    sandboxMode: 'workspace-write' as const,
    approvalPolicy: 'never' as const,
    networkAccessEnabled: false,
    webSearchMode: 'disabled' as const,
    workingDirectory,
    skipGitRepoCheck: true,
    modelReasoningEffort,
  };
}

function isCodexReasoningEffort(
  value: string | undefined
): value is 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  );
}

const fixtureCodingRound2Calls = new Map<string, number>();

function getFixtureLatestUserMessage(userPrompt: string): string {
  try {
    const parsed = JSON.parse(userPrompt) as { latestUserMessage?: unknown };
    if (typeof parsed.latestUserMessage === 'string') return parsed.latestUserMessage;
  } catch {
    // Round 1 receives the original prompt, not the JSON Round 2 envelope.
  }
  return userPrompt;
}

function buildFixtureCodingDecision(userPrompt: string, round?: 1 | 2 | 3) {
  const latestUserMessage = getFixtureLatestUserMessage(userPrompt);
  const key = latestUserMessage.slice(0, 500);

  if (round === 1) {
    return {
      phase: 'plan',
      workflow: 'code_change',
      instruction: 'E2E_SIMPLE_CODING_FIXTURE: update the tracked greeting file.',
      rationale: 'The fixture plans a deterministic coding task.',
      finalResponse: '',
      expectedEvidence: ['src/greeting.txt contains fixture output', 'apply_patch tool result'],
      riskLevel: 'low',
      toolCall: null,
    };
  }

  if (round === 2) {
    const callCount = fixtureCodingRound2Calls.get(key) ?? 0;
    fixtureCodingRound2Calls.set(key, callCount + 1);
    if (callCount === 0) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Apply the deterministic fixture patch.',
        rationale: 'A simple coding task should produce a concrete file change.',
        finalResponse: '',
        expectedEvidence: ['src/greeting.txt contains fixture output'],
        riskLevel: 'low',
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              'diff --git a/src/greeting.txt b/src/greeting.txt',
              '--- a/src/greeting.txt',
              '+++ b/src/greeting.txt',
              '@@ -1 +1,2 @@',
              '-TODO',
              '+Hello from NightWorkers fixture',
              '+E2E_SIMPLE_CODING_FIXTURE',
              '',
            ].join('\n'),
          },
        },
      };
    }
  }

  return {
    phase: 'stop',
    workflow: 'code_change',
    instruction: 'Fixture coding task complete.',
    rationale: 'The deterministic patch was already requested.',
    finalResponse: 'Fixture coding task completed with an updated greeting file.',
    expectedEvidence: ['src/greeting.txt contains fixture output'],
    terminalState: 'completed',
    riskLevel: 'low',
    toolCall: null,
  };
}

function getDecisionSchema(round?: 1 | 2 | 3) {
  if (round === 2) return round2DecisionSchema;
  return supervisorDecisionBaseSchema;
}

function getAllowedToolNamesByRound(round?: 1 | 2 | 3): string[] {
  return [...supervisorToolNames];
}

function normalizeLegacyDecisionShape(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = input as Record<string, unknown>;

  // Already close to target shape
  if ('phase' in obj || 'toolCall' in obj) return obj;

  const status = typeof obj.status === 'string' ? obj.status.toLowerCase() : '';
  const message = typeof obj.message === 'string' ? obj.message : '';
  const created = Array.isArray(obj.created) ? obj.created : [];

  // Common alternate format: { status: "completed", created: [...] }
  if (status) {
    return {
      phase: status === 'completed' ? 'stop' : 'plan',
      workflow: 'general',
      instruction: message || '',
      rationale: `Normalized legacy decision format. status=${status}`,
      finalResponse: message || (created.length > 0 ? `created: ${created.join(', ')}` : ''),
      expectedEvidence: [],
      terminalState: status === 'completed' ? 'completed' : undefined,
      riskLevel: 'low',
      toolCall: null,
    };
  }

  return obj;
}

function stringifyExpectedEvidenceItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) return JSON.stringify(item);

  const record = item as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : '';
  const lines = typeof record.lines === 'string' ? record.lines : '';
  const focus = typeof record.focus === 'string' ? record.focus : '';
  const label = [path, lines, focus].filter(Boolean).join(': ');
  if (label) return label;

  return JSON.stringify(record);
}

function normalizeDecisionForSchema(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const obj = { ...(input as Record<string, unknown>) };

  const phaseMap: Record<string, 'observe' | 'plan' | 'act' | 'verify' | 'report' | 'stop'> = {
    observe: 'observe',
    plan: 'plan',
    act: 'act',
    verify: 'verify',
    report: 'report',
    stop: 'stop',
    continue: 'act',
    execute: 'act',
    action: 'act',
    tool: 'act',
    done: 'stop',
    completed: 'stop',
    finish: 'stop',
  };

  if (typeof obj.phase === 'string') {
    const normalizedPhase = phaseMap[obj.phase.toLowerCase().trim()];
    if (normalizedPhase) obj.phase = normalizedPhase;
  }

  // 欠損/型崩れを受けてもパーサで落とさず継続できるよう補正
  if (typeof obj.finalResponse !== 'string') obj.finalResponse = '';
  if (typeof obj.instruction !== 'string') obj.instruction = '';
  if (typeof obj.rationale !== 'string') obj.rationale = '';
  if (typeof obj.workflow !== 'string') obj.workflow = 'general';
  if (
    !obj.routingHypothesis ||
    typeof obj.routingHypothesis !== 'object' ||
    Array.isArray(obj.routingHypothesis)
  ) {
    obj.routingHypothesis = { ...defaultSupervisorRoutingHypothesis };
  } else {
    const routing = { ...(obj.routingHypothesis as Record<string, unknown>) };
    if (routing.subtype === null || typeof routing.subtype !== 'string') {
      delete routing.subtype;
    }
    obj.routingHypothesis = routing;
  }
  if (!Array.isArray(obj.expectedEvidence)) {
    obj.expectedEvidence = [];
  } else {
    obj.expectedEvidence = obj.expectedEvidence.map(stringifyExpectedEvidenceItem);
  }

  if (obj.terminalState === null || obj.phase !== 'stop') {
    delete obj.terminalState;
  }

  // toolCall が配列で返ってきた場合は先頭のみ採用
  if (Array.isArray(obj.toolCall)) {
    const first = obj.toolCall[0];
    obj.toolCall = first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
  }

  // toolCall が説明文字列の場合は「未指定」として扱う
  if (typeof obj.toolCall === 'string') {
    obj.toolCall = null;
  }

  if (obj.toolCall && typeof obj.toolCall === 'object') {
    const toolCall = { ...(obj.toolCall as Record<string, unknown>) };
    // 互換: { tool: "...", purpose: "..." } -> { name, arguments }
    if (typeof toolCall.name !== 'string' && typeof toolCall.tool === 'string') {
      toolCall.name = toolCall.tool;
    }
    // 互換: { args: {...} } -> { arguments: {...} }
    if (
      (!toolCall.arguments ||
        typeof toolCall.arguments !== 'object' ||
        Array.isArray(toolCall.arguments)) &&
      toolCall.args &&
      typeof toolCall.args === 'object' &&
      !Array.isArray(toolCall.args)
    ) {
      toolCall.arguments = toolCall.args;
    }
    // 互換: 非許可ツール名を許可名へマッピング
    if (typeof toolCall.name === 'string') {
      const toolName = toolCall.name;
      const mappedToolName: Record<string, string> = {
        exec_command: 'run_command',
        command: 'run_command',
        shell: 'run_command',
        web_search: 'search_web',
        search: 'search_web',
        fetch_url: 'fetch_content',
        web_fetch: 'fetch_content',
      };
      const mapped = mappedToolName[toolName];
      if (mapped) toolCall.name = mapped;

      const normalizedName = typeof toolCall.name === 'string' ? toolCall.name : toolName;
      if (normalizedName.startsWith('mcp__')) {
        const match = /^mcp__([a-z][a-z0-9_]*)__([^.\s]+)$/.exec(normalizedName);
        const server = match
          ? listMcpServers().find((candidate) => candidate.toolPrefix === match[1])
          : null;
        if (server && match) {
          toolCall.name = 'mcp_call_tool';
          toolCall.arguments = {
            serverId: server.id,
            toolName: match[2],
            arguments:
              toolCall.arguments &&
              typeof toolCall.arguments === 'object' &&
              !Array.isArray(toolCall.arguments)
                ? toolCall.arguments
                : {},
          };
        } else {
          obj.toolCall = null;
          return obj;
        }
      }

      // 未対応の外部 namespace / dotted 形式は許可対象外として無効化する
      const nextName = typeof toolCall.name === 'string' ? toolCall.name : normalizedName;
      if (isTemporarilyBlockedExternalToolName(nextName)) {
        obj.toolCall = null;
        return obj;
      }
    }
    if (
      !toolCall.arguments ||
      typeof toolCall.arguments !== 'object' ||
      Array.isArray(toolCall.arguments)
    ) {
      toolCall.arguments = {};
    }
    obj.toolCall = toolCall;
  }

  return obj;
}

function hasRoundObservations(userPrompt: string): boolean {
  try {
    const parsed = JSON.parse(userPrompt) as { observations?: unknown };
    return Array.isArray(parsed.observations) && parsed.observations.length > 0;
  } catch {
    return false;
  }
}

function buildResponseJsonSchema(round?: 1 | 2 | 3) {
  const allowedTools = getAllowedToolNamesByRound(round);
  return {
    name: `supervisor_round_${round || 1}`,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'phase',
        'workflow',
        'instruction',
        'rationale',
        'finalResponse',
        'expectedEvidence',
        'terminalState',
        'riskLevel',
        'routingHypothesis',
        'toolCall',
      ],
      properties: {
        phase: { type: 'string', enum: ['observe', 'plan', 'act', 'verify', 'report', 'stop'] },
        workflow: {
          type: 'string',
          enum: ['general', 'evidence_review', 'code_change', 'research'],
        },
        routingHypothesis: {
          type: 'object',
          additionalProperties: false,
          required: [
            'primaryMode',
            'secondaryModes',
            'phase',
            'workKinds',
            'overlays',
            'subtype',
            'requiredEvidence',
            'nextSkillFiles',
            'confidence',
          ],
          properties: {
            primaryMode: { type: 'string', enum: [...supervisorModes] },
            secondaryModes: {
              type: 'array',
              items: { type: 'string', enum: [...supervisorModes] },
            },
            phase: { type: 'string', enum: [...supervisorPhases] },
            workKinds: { type: 'array', items: { type: 'string', enum: [...supervisorWorkKinds] } },
            overlays: { type: 'array', items: { type: 'string', enum: [...supervisorOverlays] } },
            subtype: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            requiredEvidence: { type: 'array', items: { type: 'string' } },
            nextSkillFiles: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
        instruction: { type: 'string' },
        rationale: { type: 'string' },
        finalResponse: { type: 'string' },
        expectedEvidence: { type: 'array', items: { type: 'string' } },
        terminalState: {
          anyOf: [
            {
              type: 'string',
              enum: [
                'needs_review',
                'completed',
                'blocked',
                'failed',
                'timed_out',
                'cancelled',
                'needs_human',
              ],
            },
            { type: 'null' },
          ],
        },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
        toolCall: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'arguments'],
              properties: {
                name: { type: 'string', enum: allowedTools },
                arguments: { type: 'object' },
              },
            },
          ],
        },
      },
    },
  };
}

function tryExtractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim();
  return null;
}

function buildOpenAIChatCompletionBody(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  round?: 1 | 2 | 3;
  responseFormat: 'json_schema' | 'json_object';
  stream: boolean;
}) {
  return {
    model: input.model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    temperature: 0.1,
    stream: input.stream,
    response_format:
      input.responseFormat === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: buildResponseJsonSchema(input.round),
          }
        : { type: 'json_object' },
  };
}

async function emitSupervisorLlmDebugEvent(
  options: CallSupervisorOptions,
  event: SupervisorLlmDebugEvent
) {
  if (!options.emitEvent) return;
  try {
    await options.emitEvent(event);
  } catch (err) {
    logger.warn(
      {
        eventType: event.type,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      'Supervisor LLM debug event emission failed'
    );
  }
}

function emitBufferedResponseDelta(input: {
  options: CallSupervisorOptions;
  provider: string;
  round?: 1 | 2 | 3;
  text: string;
  force?: boolean;
}) {
  if (!input.text) return;
  void emitSupervisorLlmDebugEvent(input.options, {
    type: 'model.response_delta',
    severity: 'debug',
    message: input.text,
    data: {
      provider: input.provider,
      round: input.round ?? null,
      text: input.text,
      forced: Boolean(input.force),
    },
  });
}

async function readOpenAIChatCompletionStream(input: {
  response: Response;
  options: CallSupervisorOptions;
  provider: string;
  round?: 1 | 2 | 3;
}): Promise<string> {
  if (!input.response.body) {
    throw new Error('OpenAI streaming response did not include a readable body.');
  }

  const decoder = new TextDecoder();
  const reader = input.response.body.getReader();
  let buffer = '';
  let content = '';
  let pendingDelta = '';

  const processStreamRecord = async (record: string) => {
    const lines = record
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'));
    for (const line of lines) {
      const payload = line.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        logger.warn({ payloadPreview: payload.slice(0, 200) }, 'OpenAI stream chunk parse failed');
        continue;
      }
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        content += delta;
        pendingDelta += delta;
        flushDelta(false);
      }
    }
  };

  const flushDelta = (force = false) => {
    if (!pendingDelta) return;
    if (!force && pendingDelta.length < 24 && !pendingDelta.includes('\n')) return;
    const text = pendingDelta;
    pendingDelta = '';
    emitBufferedResponseDelta({
      options: input.options,
      provider: input.provider,
      round: input.round,
      text,
      force,
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const records = buffer.split(/\r?\n\r?\n/);
    buffer = records.pop() ?? '';
    for (const record of records) {
      await processStreamRecord(record);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processStreamRecord(buffer);
  }
  flushDelta(true);
  return content;
}

function getSupervisorLlmTimeoutMs(options: CallSupervisorOptions): number {
  if (options.timeoutMs && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    return Math.floor(options.timeoutMs);
  }
  const configured = Number(process.env.SUPERVISOR_LLM_TIMEOUT_MS || 120_000);
  if (!Number.isFinite(configured) || configured <= 0) return 120_000;
  return Math.floor(configured);
}

function createSupervisorLlmAbortSignal(options: CallSupervisorOptions): AbortSignal {
  return AbortSignal.timeout(getSupervisorLlmTimeoutMs(options));
}

function digestLlmText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readCodexStreamedTurn(input: {
  thread: Thread;
  prompt: string;
  outputSchema?: unknown;
  signal: AbortSignal;
  options: CallSupervisorOptions;
  provider: string;
  model?: string;
  structuredOutput: boolean;
}): Promise<{ finalResponse: string; usage: Usage | null }> {
  const { events } = await input.thread.runStreamed(input.prompt, {
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    signal: input.signal,
  });
  let finalResponse = '';
  let usage: Usage | null = null;
  const agentMessageTextById = new Map<string, string>();
  let latestAgentMessageText = '';

  const handleItemEvent = (event: Extract<ThreadEvent, { type: `item.${string}` }>) => {
    const item = event.item;
    if (item.type !== 'agent_message') return;
    const previous = agentMessageTextById.get(item.id) || '';
    const current = item.text || '';
    if (current.length > previous.length) {
      emitBufferedResponseDelta({
        options: input.options,
        provider: input.provider,
        round: input.options.round,
        text: current.slice(previous.length),
        force: event.type === 'item.completed',
      });
    }
    agentMessageTextById.set(item.id, current);
    if (current.trim()) latestAgentMessageText = current;
    if (event.type === 'item.completed') finalResponse = current;
  };

  for await (const event of events) {
    if (
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed'
    ) {
      handleItemEvent(event);
    } else if (event.type === 'turn.completed') {
      usage = event.usage;
    } else if (event.type === 'turn.failed') {
      throw new Error(event.error.message);
    } else if (event.type === 'error') {
      throw new Error(event.message);
    }
  }

  return { finalResponse: finalResponse || latestAgentMessageText, usage };
}

export async function callSupervisorLLM(
  systemPrompt: string,
  userPrompt: string,
  options: CallSupervisorOptions = {}
): Promise<SupervisorDecision> {
  const provider = userPrompt.includes('NIGHTWORKERS_TEST_AGENT_SCENARIO=')
    ? 'test'
    : process.env.ACTIVE_LLM_PROVIDER || 'azure';
  const isEnabled = (key: string, fallback: boolean) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    return raw.toLowerCase() === 'true';
  };
  let rawContent = '';
  let providerDebug: Record<string, unknown> = {};
  const startedAt = Date.now();
  const callId = randomUUID();
  const requestSignal = createSupervisorLlmAbortSignal(options);
  appendLlmTrace('request', {
    callId,
    provider,
    round: options.round ?? null,
    systemPrompt,
    userPrompt,
    systemPromptLength: systemPrompt.length,
    userPromptLength: userPrompt.length,
    systemPromptBytes: Buffer.byteLength(systemPrompt, 'utf8'),
    userPromptBytes: Buffer.byteLength(userPrompt, 'utf8'),
    systemPromptSha256: digestLlmText(systemPrompt),
    userPromptSha256: digestLlmText(userPrompt),
  });
  logger.debug(
    {
      provider,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    },
    'Supervisor LLM call start'
  );
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.request_started',
    severity: 'info',
    message: `Supervisor LLM request started. provider=${provider} round=${options.round ?? 'unknown'}`,
    data: {
      provider,
      round: options.round ?? null,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    },
  });

  try {
    if (provider === 'azure') {
      if (!isEnabled('AZURE_OPENAI_ENABLED', false)) {
        throw new Error('Azure provider is inactive. Enable AZURE_OPENAI_ENABLED first.');
      }
      const apiKey = process.env.AZURE_OPENAI_API_KEY;
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5-mini';
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview';

      if (!apiKey || !endpoint) {
        throw new Error('Azure OpenAI credentials are not configured in environment variables.');
      }

      const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
      const url = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

      let response = await fetch(url, {
        method: 'POST',
        signal: requestSignal,
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          response_format: {
            type: 'json_schema',
            json_schema: buildResponseJsonSchema(options.round),
          },
        }),
      });

      if (!response.ok && response.status === 400) {
        logger.warn(
          { provider: 'azure', round: options.round, status: response.status },
          'json_schema rejected, fallback to json_object'
        );
        await emitSupervisorLlmDebugEvent(options, {
          type: 'model.retry_scheduled',
          severity: 'warning',
          message: 'Azure OpenAI json_schema request failed with 400; retrying with json_object.',
          data: { provider: 'azure', round: options.round ?? null, status: response.status },
        });
        await emitSupervisorLlmDebugEvent(options, {
          type: 'model.retry_started',
          severity: 'info',
          message: 'Azure OpenAI json_object retry started.',
          data: { provider: 'azure', round: options.round ?? null },
        });
        response = await fetch(url, {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
          },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Azure OpenAI call failed with status ${response.status}: ${errorText}`);
      }

      const responseData = await response.json();
      providerDebug = {
        provider: 'azure',
        status: response.status,
        deploymentName,
        hasChoices: Boolean(responseData?.choices),
      };
      rawContent = responseData.choices?.[0]?.message?.content || '';
    } else if (provider === 'openai') {
      if (!isEnabled('OPENAI_ENABLED', true)) {
        throw new Error('OpenAI provider is inactive. Enable OPENAI_ENABLED first.');
      }
      const apiKey = process.env.OPENAI_API_KEY;
      const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const streamResponses = isEnabled('OPENAI_STREAMING_ENABLED', true);

      if (!apiKey) {
        throw new Error('OpenAI API key is not configured in environment variables.');
      }

      let responseFormat: 'json_schema' | 'json_object' = 'json_schema';
      let response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: requestSignal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(
          buildOpenAIChatCompletionBody({
            model,
            systemPrompt,
            userPrompt,
            round: options.round,
            responseFormat,
            stream: streamResponses,
          })
        ),
      });

      if (!response.ok && response.status === 400) {
        logger.warn(
          { provider: 'openai', round: options.round, status: response.status },
          'json_schema rejected, fallback to json_object'
        );
        await emitSupervisorLlmDebugEvent(options, {
          type: 'model.retry_scheduled',
          severity: 'warning',
          message: 'OpenAI json_schema request failed with 400; retrying with json_object.',
          data: { provider: 'openai', round: options.round ?? null, status: response.status },
        });
        await emitSupervisorLlmDebugEvent(options, {
          type: 'model.retry_started',
          severity: 'info',
          message: 'OpenAI json_object retry started.',
          data: { provider: 'openai', round: options.round ?? null },
        });
        responseFormat = 'json_object';
        response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          signal: requestSignal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(
            buildOpenAIChatCompletionBody({
              model,
              systemPrompt,
              userPrompt,
              round: options.round,
              responseFormat,
              stream: streamResponses,
            })
          ),
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI call failed with status ${response.status}: ${errorText}`);
      }

      const responseData = streamResponses ? null : await response.json();
      providerDebug = {
        provider: 'openai',
        status: response.status,
        model,
        streamed: streamResponses,
        responseFormat,
        hasChoices: Boolean(responseData?.choices),
      };
      rawContent = streamResponses
        ? await readOpenAIChatCompletionStream({
            response,
            options,
            provider: 'openai',
            round: options.round,
          })
        : responseData?.choices?.[0]?.message?.content || '';
    } else if (provider === 'bedrock') {
      if (!isEnabled('AWS_BEDROCK_ENABLED', false)) {
        throw new Error('Bedrock provider is inactive. Enable AWS_BEDROCK_ENABLED first.');
      }
      const { BedrockRuntimeClient, ConverseCommand } = await import(
        '@aws-sdk/client-bedrock-runtime'
      );
      const region = process.env.AWS_REGION || 'us-east-1';
      const modelId = process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0';

      const client = new BedrockRuntimeClient({
        region,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
        },
      });

      const command = new ConverseCommand({
        modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: userPrompt }],
          },
        ],
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          temperature: 0.1,
        },
      });

      const res = await client.send(command, { abortSignal: requestSignal });
      providerDebug = {
        provider: 'bedrock',
        modelId,
        hasOutput: Boolean(res.output),
      };
      rawContent = res.output?.message?.content?.[0]?.text || '';
    } else if (provider === 'codex') {
      if (!isEnabled('CODEX_ENABLED', false)) {
        throw new Error('Codex provider is inactive. Enable CODEX_ENABLED first.');
      }
      const { Codex } = await import('@openai/codex-sdk');
      const accessToken = process.env.CODEX_ACCESS_TOKEN || '';
      const configuredModel = process.env.CODEX_MODEL || undefined;
      const allowedCodexModels = new Set([
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
      ]);
      if (configuredModel && !allowedCodexModels.has(configuredModel.toLowerCase())) {
        throw new Error(
          `Unsupported CODEX_MODEL: "${configuredModel}". Allowed models: ${Array.from(allowedCodexModels).join(', ')}`
        );
      }

      const sdkOptions = buildCodexSupervisorSdkOptions(accessToken);
      const prompt = buildCodexTurnPrompt(systemPrompt, userPrompt);
      const codex = new Codex(sdkOptions);
      const useStructuredOutput = isEnabled('CODEX_STRUCTURED_OUTPUT_ENABLED', false);

      const runWithModel = async (model?: string) => {
        const threadOptions = buildCodexSupervisorThreadOptions(model, options.workingDirectory);
        const thread = codex.startThread(threadOptions);
        const turn = await readCodexStreamedTurn({
          thread,
          prompt,
          outputSchema: useStructuredOutput
            ? buildResponseJsonSchema(options.round).schema
            : undefined,
          signal: requestSignal,
          options,
          provider: 'codex',
          model,
          structuredOutput: useStructuredOutput,
        });
        providerDebug = {
          provider: 'codex',
          model: model || null,
          structuredOutput: useStructuredOutput,
          modelReasoningEffort: threadOptions.modelReasoningEffort,
          workingDirectory: threadOptions.workingDirectory,
          usage: turn.usage,
          hasFinalResponse: Boolean(turn.finalResponse),
        };
        return turn.finalResponse || '';
      };

      rawContent = await runWithModel(configuredModel);
    } else if (provider === 'fixture' || provider === 'test') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Fixture/test provider is not available in production.');
      }
      const isAgentOutcomeTestProvider =
        provider === 'test' || userPrompt.includes('NIGHTWORKERS_TEST_AGENT_SCENARIO=');
      providerDebug = {
        provider,
        round: options.round ?? null,
        mode: isAgentOutcomeTestProvider
          ? 'agent_outcome'
          : userPrompt.includes('E2E_SIMPLE_CODING_FIXTURE')
            ? 'simple_coding'
            : 'stop_without_evidence',
      };
      rawContent = JSON.stringify(
        isAgentOutcomeTestProvider
          ? buildTestProviderDecision(userPrompt, options.round)
          : userPrompt.includes('E2E_OBJECT_EVIDENCE_FIXTURE')
            ? {
                phase: 'plan',
                workflow: 'evidence_review',
                instruction: 'Review object evidence fixture.',
                rationale:
                  'The fixture returns structured expected evidence like Codex sometimes does.',
                finalResponse: '',
                expectedEvidence: [
                  {
                    path: 'spec/implementation-queue-redesign-plan.md',
                    lines: '1-200',
                    focus: 'implementation plan consistency',
                  },
                  {
                    path: 'api/services/supervisor/llm-provider.ts',
                    focus: 'supervisor decision parsing',
                  },
                ],
                riskLevel: 'medium',
                toolCall: null,
              }
            : userPrompt.includes('E2E_MCP_NAMESPACED_TOOL_FIXTURE')
              ? {
                  phase: 'act',
                  workflow: 'research',
                  instruction: 'Call the configured MCP fixture tool.',
                  rationale: 'The fixture returns a namespaced MCP tool name for normalization.',
                  finalResponse: '',
                  expectedEvidence: ['MCP tool result'],
                  riskLevel: 'low',
                  toolCall: {
                    name: 'mcp__fixture_server__lookup',
                    arguments: {
                      query: 'nightworkers',
                    },
                  },
                }
              : userPrompt.includes('E2E_SIMPLE_CODING_FIXTURE')
                ? buildFixtureCodingDecision(userPrompt, options.round)
                : options.round === 1
                  ? {
                      phase: 'plan',
                      workflow: 'evidence_review',
                      instruction: 'Review the requested specification document.',
                      rationale: 'The fixture intentionally plans without a tool call.',
                      finalResponse: '',
                      expectedEvidence: ['spec document contents'],
                      riskLevel: 'medium',
                      toolCall: null,
                    }
                  : options.round === 2
                    ? hasRoundObservations(userPrompt)
                      ? {
                          phase: 'stop',
                          workflow: 'evidence_review',
                          instruction: 'Fixture review complete.',
                          rationale:
                            'The fixture stops after repository evidence has been supplied.',
                          finalResponse: [
                            'Fixture review completed after reading repository evidence.',
                            'Finding: spec/jsonl-replay-import-regression-implementation-plan.md:1 has been inspected and the fixture confirms the requested document review path can finish with concrete evidence.',
                            'Risk: low; the run includes a read_file tool result before completion.',
                          ].join(' '),
                          expectedEvidence: ['spec document contents'],
                          terminalState: 'completed',
                          riskLevel: 'low',
                          toolCall: null,
                        }
                      : {
                          phase: 'act',
                          workflow: 'evidence_review',
                          instruction: 'Read the fixture specification document before review.',
                          rationale:
                            'The evidence_review prompt requires repository evidence before stopping.',
                          finalResponse: '',
                          expectedEvidence: ['spec document contents'],
                          riskLevel: 'medium',
                          toolCall: {
                            name: 'read_file',
                            arguments: {
                              filePath:
                                'spec/jsonl-replay-import-regression-implementation-plan.md',
                            },
                          },
                        }
                    : {
                        phase: 'stop',
                        workflow: 'general',
                        instruction: 'Fixture smoke complete.',
                        rationale: 'Fixture provider returned a smoke response.',
                        finalResponse: 'Fixture smoke complete.',
                        expectedEvidence: [],
                        terminalState: 'completed',
                        riskLevel: 'low',
                        toolCall: null,
                      }
      );
    } else {
      throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  } catch (error) {
    appendLlmTrace('provider_error', {
      callId,
      provider,
      round: options.round ?? null,
      durationMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      providerDebug,
    });
    throw error;
  }

  if (!rawContent) {
    appendLlmTrace('empty_response', {
      callId,
      provider,
      round: options.round ?? null,
      durationMs: Date.now() - startedAt,
      providerDebug,
    });
    logger.error(
      {
        provider,
        providerDebug,
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
      },
      'Supervisor LLM returned empty response'
    );
    throw new Error('LLM returned an empty message response.');
  }

  logger.debug(
    {
      provider,
      rawContentLength: rawContent.length,
      rawContentPreview: rawContent.slice(0, 500),
    },
    'Supervisor LLM raw response received'
  );
  appendLlmTrace('response', {
    callId,
    provider,
    round: options.round ?? null,
    durationMs: Date.now() - startedAt,
    rawContent,
    rawContentLength: rawContent.length,
    rawContentBytes: Buffer.byteLength(rawContent, 'utf8'),
    rawContentSha256: digestLlmText(rawContent),
    providerDebug,
  });
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.response_finished',
    severity: 'info',
    message: `Supervisor LLM response received. provider=${provider} bytes=${Buffer.byteLength(rawContent, 'utf8')}`,
    data: {
      provider,
      round: options.round ?? null,
      rawContentLength: rawContent.length,
      durationMs: Date.now() - startedAt,
      providerDebug,
    },
  });

  try {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch (parseErr) {
      const candidate = tryExtractJsonCandidate(rawContent);
      if (!candidate) {
        await emitSupervisorLlmDebugEvent(options, {
          type: 'model.response_parse_failed',
          severity: 'error',
          message: 'Supervisor LLM JSON parse failed and no extractable candidate was found.',
          data: {
            provider,
            round: options.round ?? null,
            errorMessage: parseErr instanceof Error ? parseErr.message : String(parseErr),
            rawContentPreview: rawContent.slice(0, 500),
          },
        });
        throw new Error('JSON parse failed and no extractable JSON candidate found');
      }
      await emitSupervisorLlmDebugEvent(options, {
        type: 'model.response_repaired',
        severity: 'warning',
        message: 'Supervisor LLM response was repaired by extracting a JSON candidate.',
        data: {
          provider,
          round: options.round ?? null,
          rawContentLength: rawContent.length,
          candidateLength: candidate.length,
        },
      });
      parsedJson = JSON.parse(candidate);
    }
    const normalization = (() => {
      let phaseAutofilled = false;
      if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson))
        return parsedJson;
      const obj = normalizeDecisionForSchema(normalizeLegacyDecisionShape(parsedJson)) as Record<
        string,
        unknown
      >;
      if (!('phase' in obj)) {
        phaseAutofilled = true;
        if (obj.toolCall && typeof obj.toolCall === 'object') {
          return { normalizedJson: { ...obj, phase: 'act' }, phaseAutofilled };
        }
        return { normalizedJson: { ...obj, phase: 'stop' }, phaseAutofilled };
      }
      return { normalizedJson: obj, phaseAutofilled };
    })();
    const normalizedJson =
      normalization && typeof normalization === 'object' && 'normalizedJson' in normalization
        ? (normalization as { normalizedJson: unknown }).normalizedJson
        : normalization;
    const phaseAutofilled =
      normalization && typeof normalization === 'object' && 'phaseAutofilled' in normalization
        ? Boolean((normalization as { phaseAutofilled?: boolean }).phaseAutofilled)
        : false;

    const parsed = getDecisionSchema(options.round).safeParse(normalizedJson);

    if (parsed.success) {
      const isEmptyStopDecision =
        parsed.data.phase === 'stop' &&
        !parsed.data.finalResponse?.trim() &&
        !parsed.data.instruction?.trim() &&
        !parsed.data.rationale?.trim();

      logger.info(
        {
          provider,
          rawContentLength: rawContent.length,
          rawContentPreview: rawContent.slice(0, 300),
        },
        'Supervisor LLM raw output summary'
      );

      if (isEmptyStopDecision) {
        logger.warn(
          {
            provider,
            phaseAutofilled,
            rawContentPreview: rawContent.slice(0, 300),
          },
          phaseAutofilled
            ? 'Supervisor LLM returned insufficient structured decision (phase autofilled)'
            : 'Supervisor LLM returned empty stop decision'
        );

        if (options.tolerateSchemaFailure) {
          return {
            phase: 'plan',
            workflow: parsed.data.workflow || 'general',
            instruction: '',
            rationale: '',
            finalResponse: rawContent,
            expectedEvidence: [],
            riskLevel: 'medium',
            toolCall: null,
          };
        }

        return {
          phase: 'stop',
          workflow: parsed.data.workflow || 'general',
          instruction: '',
          rationale: '',
          finalResponse: rawContent,
          expectedEvidence: [],
          terminalState: 'needs_human',
          riskLevel: 'high',
        };
      }

      logger.info(
        {
          provider,
          phase: parsed.data.phase,
          terminalState: parsed.data.terminalState,
          hasToolCall: Boolean(parsed.data.toolCall),
          toolCallName: parsed.data.toolCall?.name ?? null,
          toolCallArguments: parsed.data.toolCall?.arguments ?? null,
        },
        'Supervisor LLM response parsed'
      );

      return parsed.data;
    }

    console.warn('LLM output format validation failed. Issues:', parsed.error.format());
    await emitSupervisorLlmDebugEvent(options, {
      type: 'model.response_parse_failed',
      severity: 'error',
      message: 'Supervisor LLM response failed schema validation.',
      data: {
        provider,
        round: options.round ?? null,
        issues: parsed.error.issues,
        rawContentPreview: rawContent.slice(0, 500),
      },
    });
    logger.warn(
      {
        provider,
        issues: parsed.error.issues,
      },
      'Supervisor LLM schema validation failed'
    );
    appendSupervisorTrace('schema_validation_failed', {
      round: options.round,
      provider,
      issues: parsed.error.issues,
      rawContentPreview: rawContent.slice(0, 1000),
    });
    // Fallback: return a safe terminal state to let humans intervene
    if (options.tolerateSchemaFailure) {
      return {
        phase: 'plan',
        workflow: 'general',
        instruction: '',
        rationale: '',
        finalResponse: rawContent,
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      };
    }

    return {
      phase: 'stop',
      workflow: 'general',
      instruction: '',
      rationale: '',
      finalResponse: rawContent,
      expectedEvidence: [],
      terminalState: 'needs_human',
      riskLevel: 'high',
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const plain = rawContent.trim();
    if (plain.length > 0) {
      await emitSupervisorLlmDebugEvent(options, {
        type: 'model.response_parse_failed',
        severity: 'error',
        message: 'Supervisor LLM returned plain text instead of the required decision JSON.',
        data: {
          provider,
          round: options.round ?? null,
          rawContentLength: plain.length,
        },
      });
      logger.info(
        {
          provider,
          rawContentLength: plain.length,
          rawContentPreview: plain.slice(0, 500),
        },
        'Supervisor LLM plain-text response rejected'
      );
      return {
        phase: 'stop',
        workflow: 'general',
        instruction: '',
        rationale: '',
        finalResponse: plain,
        expectedEvidence: [],
        terminalState: 'needs_human',
        riskLevel: 'high',
        toolCall: null,
      };
    }

    console.error('Failed to parse LLM decision JSON:', rawContent);
    await emitSupervisorLlmDebugEvent(options, {
      type: 'model.response_parse_failed',
      severity: 'error',
      message: 'Supervisor LLM JSON parse failed.',
      data: {
        provider,
        round: options.round ?? null,
        errorMessage,
        rawContentPreview: rawContent.slice(0, 500),
      },
    });
    logger.error(
      {
        provider,
        errorMessage,
        rawContentPreview: rawContent.slice(0, 500),
      },
      'Supervisor LLM JSON parse failed'
    );
    appendSupervisorTrace('json_parse_failed', {
      round: options.round,
      provider,
      errorMessage,
      rawContentPreview: rawContent.slice(0, 1000),
    });
    return {
      phase: 'stop',
      workflow: 'general',
      instruction: '',
      rationale: '',
      finalResponse: rawContent,
      expectedEvidence: [],
      terminalState: 'needs_human',
      riskLevel: 'high',
    };
  }
}
