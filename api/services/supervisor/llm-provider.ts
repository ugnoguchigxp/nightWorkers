import { z } from 'zod';
import { appendSupervisorTrace, logger } from '../../lib/logger';
import { buildCodexTurnPrompt } from './prompt';
import { isTemporarilyBlockedExternalToolName } from './TEMP_DISABLE_EXTERNAL_MCP_TOOLS';

const supervisorDecisionBaseSchema = z.object({
  phase: z.enum(['observe', 'plan', 'act', 'verify', 'report', 'stop']),
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
      name: z.enum([
        'list_dir',
        'find_file',
        'read_file',
        'search_files',
        'apply_patch',
        'replace_content',
        'run_command',
        'git_status',
        'git_diff',
      ]),
      arguments: z.any().default({}),
    })
    .nullable()
    .optional(),
});

const round2DecisionSchema = supervisorDecisionBaseSchema.extend({
  toolCall: z
    .object({
      name: z.enum([
        'list_dir',
        'find_file',
        'read_file',
        'search_files',
        'git_status',
        'apply_patch',
        'replace_content',
        'run_command',
        'git_diff',
      ]),
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
  requireToolCall?: boolean;
};

function getDecisionSchema(round?: 1 | 2 | 3) {
  if (round === 2) return round2DecisionSchema;
  return supervisorDecisionBaseSchema;
}

function getAllowedToolNamesByRound(round?: 1 | 2 | 3): string[] {
  if (round === 2)
    return [
      'list_dir',
      'find_file',
      'read_file',
      'search_files',
      'git_status',
      'apply_patch',
      'replace_content',
      'run_command',
      'git_diff',
    ];
  return [
    'list_dir',
    'find_file',
    'read_file',
    'search_files',
    'apply_patch',
    'replace_content',
    'run_command',
    'git_status',
    'git_diff',
  ];
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
  if (!Array.isArray(obj.expectedEvidence)) obj.expectedEvidence = [];

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
      };
      const mapped = mappedToolName[toolName];
      if (mapped) toolCall.name = mapped;

      // 外部MCP名や namespaced 形式は許可対象外として無効化する
      const normalizedName = typeof toolCall.name === 'string' ? toolCall.name : toolName;
      if (isTemporarilyBlockedExternalToolName(normalizedName)) {
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
        'instruction',
        'rationale',
        'finalResponse',
        'expectedEvidence',
        'riskLevel',
      ],
      properties: {
        phase: { type: 'string', enum: ['observe', 'plan', 'act', 'verify', 'report', 'stop'] },
        instruction: { type: 'string' },
        rationale: { type: 'string' },
        finalResponse: { type: 'string' },
        expectedEvidence: { type: 'array', items: { type: 'string' } },
        terminalState: {
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

export async function callSupervisorLLM(
  systemPrompt: string,
  userPrompt: string,
  options: CallSupervisorOptions = {}
): Promise<SupervisorDecision> {
  const provider = process.env.ACTIVE_LLM_PROVIDER || 'azure';
  const isEnabled = (key: string, fallback: boolean) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    return raw.toLowerCase() === 'true';
  };
  let rawContent = '';
  let providerDebug: Record<string, unknown> = {};
  logger.debug(
    {
      provider,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    },
    'Supervisor LLM call start'
  );

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
      response = await fetch(url, {
        method: 'POST',
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

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured in environment variables.');
    }

    let response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
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
        { provider: 'openai', round: options.round, status: response.status },
        'json_schema rejected, fallback to json_object'
      );
      response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
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
      throw new Error(`OpenAI call failed with status ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();
    providerDebug = {
      provider: 'openai',
      status: response.status,
      model,
      hasChoices: Boolean(responseData?.choices),
    };
    rawContent = responseData.choices?.[0]?.message?.content || '';
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

    const res = await client.send(command);
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
      'gpt-5.2',
    ]);
    if (configuredModel && !allowedCodexModels.has(configuredModel.toLowerCase())) {
      throw new Error(
        `Unsupported CODEX_MODEL: "${configuredModel}". Allowed models: ${Array.from(allowedCodexModels).join(', ')}`
      );
    }

    const sdkOptions: { env?: Record<string, string> } = {};
    if (accessToken) {
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
    }
    const prompt = buildCodexTurnPrompt(systemPrompt, userPrompt);
    const codex = new Codex(sdkOptions);

    const runWithModel = async (model?: string) => {
      const thread = codex.startThread({
        model,
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
      });
      const turn = await thread.run(prompt);
      providerDebug = {
        provider: 'codex',
        model: model || null,
        hasFinalResponse: Boolean(turn.finalResponse),
      };
      return turn.finalResponse || '';
    };

    rawContent = await runWithModel(configuredModel);
  } else {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  if (!rawContent) {
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

  try {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawContent);
    } catch {
      const candidate = tryExtractJsonCandidate(rawContent);
      if (!candidate) throw new Error('JSON parse failed and no extractable JSON candidate found');
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
            instruction: 'Empty stop decision detected. Continue to next round.',
            rationale: 'Model returned stop with empty payload.',
            finalResponse: '',
            expectedEvidence: [],
            riskLevel: 'medium',
            toolCall: null,
          };
        }

        return {
          phase: 'stop',
          instruction: 'Safety system interrupted due to empty stop decision.',
          rationale: 'Model returned stop without any meaningful response fields.',
          finalResponse: '応答内容が空だったため処理を中断しました。',
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

      if (options.requireToolCall && parsed.data.phase !== 'stop' && !parsed.data.toolCall) {
        appendSupervisorTrace('missing_tool_call', {
          round: options.round,
          phase: parsed.data.phase,
          instruction: parsed.data.instruction,
          rationale: parsed.data.rationale,
          riskLevel: parsed.data.riskLevel,
        });
        logger.warn(
          {
            provider,
            round: options.round,
            rawContentPreview: rawContent.slice(0, 300),
          },
          'Supervisor decision missing required toolCall'
        );
        if (options.tolerateSchemaFailure) {
          return {
            phase: 'plan',
            instruction: 'toolCall required but missing. Continue to next round.',
            rationale: 'Execution round requires an explicit tool call.',
            finalResponse: '',
            expectedEvidence: [],
            riskLevel: 'medium',
            toolCall: null,
          };
        }
        return {
          phase: 'stop',
          instruction: 'Safety system interrupted due to missing toolCall.',
          rationale: 'Execution round requires a toolCall but none was provided.',
          finalResponse:
            '必要なツール呼び出しが生成されなかったため中断しました。LLM最終回答は実行ラウンドで必須のtoolCallを返せておらず、実行継続条件を満たしていません。',
          expectedEvidence: [],
          terminalState: 'needs_human',
          riskLevel: 'high',
          toolCall: null,
        };
      }

      return parsed.data;
    }

    console.warn('LLM output format validation failed. Issues:', parsed.error.format());
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
        instruction: 'Schema mismatch in previous round. Continue to next round.',
        rationale: `LLM response schema mismatch tolerated. Raw content: ${rawContent}`,
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      };
    }

    return {
      phase: 'stop',
      instruction: 'Safety system interrupted execution due to formatting errors.',
      rationale: `LLM response failed to match schema. Raw content: ${rawContent}`,
      finalResponse:
        '内部形式エラーのため処理を中断しました。LLM最終回答が要求スキーマに一致せず、必要なキーまたは許可ツール名が不正でした。',
      expectedEvidence: [],
      terminalState: 'needs_human',
      riskLevel: 'high',
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Plain-text fallback: conversational responses are allowed when no tool is needed.
    const plain = rawContent.trim();
    if (plain.length > 0) {
      logger.info(
        {
          provider,
          rawContentLength: plain.length,
          rawContentPreview: plain.slice(0, 500),
        },
        'Supervisor LLM plain-text response accepted'
      );
      return {
        phase: 'stop',
        instruction: 'Conversation response completed without tool execution.',
        rationale: 'Model returned plain-text response; no tool call was required.',
        finalResponse: plain,
        expectedEvidence: [],
        terminalState: 'completed',
        riskLevel: 'low',
        toolCall: null,
      };
    }

    console.error('Failed to parse LLM decision JSON:', rawContent);
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
      instruction: 'Safety system interrupted execution due to JSON syntax errors.',
      rationale: `LLM response failed to parse as JSON. Raw content: ${rawContent}. Error: ${errorMessage}`,
      finalResponse: '内部JSONエラーのため処理を中断しました。',
      expectedEvidence: [],
      terminalState: 'needs_human',
      riskLevel: 'high',
    };
  }
}
