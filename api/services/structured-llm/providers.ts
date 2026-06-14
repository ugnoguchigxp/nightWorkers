import { Codex } from '@openai/codex-sdk';
import { estimateLlmUsage, normalizeProviderUsage } from '../llm-usage';
import { shouldOmitCodexOutputSchema } from './codex-output-schema';
import { emitSupervisorLlmDebugEvent, rejectProviderActivity } from './events';
import { readSchemaFirstFixtureOutput } from './fixture';
import { buildOpenAIChatCompletionBody, readOpenAIChatCompletionStream } from './openai';
import { providerAdapterKey } from './request';
import {
  getStructuredLlmBoolSetting,
  getStructuredLlmSetting,
  readStructuredLlmProviderSettings,
  type StructuredLlmProviderEndpoint,
} from './settings';
import type {
  CallSupervisorOptions,
  NormalizedSupervisorLlmRequest,
  ProviderCallResult,
} from './types';

export type RawLlmCallOptions = CallSupervisorOptions & {
  jsonSchema?: { name: string; schema: unknown };
  label: string;
  normalizedRequest?: NormalizedSupervisorLlmRequest;
};

export async function callProvider(input: {
  provider: string;
  systemPrompt: string;
  userPrompt: string;
  options: RawLlmCallOptions;
  signal: AbortSignal;
  setProviderDebug: (value: Record<string, unknown>) => void;
}): Promise<ProviderCallResult> {
  const settings = readStructuredLlmProviderSettings();
  const isEnabled = (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) =>
    getStructuredLlmBoolSetting(settings, key, fallback);
  const provider = providerAdapterKey(
    input.options.normalizedRequest?.providerId ?? input.provider
  );

  if (provider === 'azure') return callAzureProvider(input, isEnabled, settings);
  if (provider === 'openai') return callOpenAIProvider(input, isEnabled, settings);
  if (provider === 'bedrock') return callBedrockProvider(input, isEnabled, settings);
  if (provider === 'codex') return callCodexProvider(input, isEnabled, settings);
  if (provider === 'fixture' || provider === 'test') return callFixtureProvider(input);

  throw new Error(`Unsupported LLM provider: ${input.provider}`);
}

function callFixtureProvider(input: Parameters<typeof callProvider>[0]): ProviderCallResult {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Fixture/test provider is not available in production.');
  }
  const providerDebug = { provider: input.provider, round: input.options.round ?? null };
  input.setProviderDebug(providerDebug);
  if (input.options.schemaFirst) {
    return buildFixtureProviderResult(
      readSchemaFirstFixtureOutput(input.options.round),
      input,
      providerDebug
    );
  }

  const output = process.env.SUPERVISOR_FIXTURE_OUTPUT;
  if (!output?.trim()) {
    throw new Error('Fixture provider requires SUPERVISOR_FIXTURE_OUTPUT to be set.');
  }
  return buildFixtureProviderResult(output, input, providerDebug);
}

function buildFixtureProviderResult(
  content: string,
  input: Parameters<typeof callProvider>[0],
  providerDebug: Record<string, unknown>
): ProviderCallResult {
  return {
    content,
    usage: estimateLlmUsage({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      responseText: content,
    }),
    model: null,
    providerDebug,
  };
}

async function callCodexProvider(
  input: Parameters<typeof callProvider>[0],
  isEnabled: (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) => boolean,
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): Promise<ProviderCallResult> {
  const endpoint = getResolvedProviderEndpoint(input, settings);
  if (!endpoint?.enabled && !isEnabled('CODEX_ENABLED', false)) {
    throw new Error('Codex provider is inactive. Enable CODEX_ENABLED first.');
  }
  const model =
    input.options.normalizedRequest?.modelOrDeployment ||
    endpoint?.models[0] ||
    getStructuredLlmSetting(settings, 'CODEX_MODEL', 'gpt-5.4-mini');
  const accessToken = endpoint?.apiKey || getStructuredLlmSetting(settings, 'CODEX_ACCESS_TOKEN');
  const modelReasoningEffort = toCodexReasoningEffort(
    input.options.normalizedRequest?.thinkingDepth ||
      getStructuredLlmSetting(settings, 'CODEX_MODEL_REASONING_EFFORT') ||
      'low'
  );
  const codex = new Codex({
    env: {
      ...sanitizeCodexProviderEnv(process.env),
      ...(accessToken ? { CODEX_ACCESS_TOKEN: accessToken } : {}),
    },
    config: {
      features: { mcp: false },
      mcp_servers: {},
    },
  });
  const thread = codex.startThread({
    model,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    workingDirectory: input.options.workingDirectory || process.cwd(),
    skipGitRepoCheck: true,
    modelReasoningEffort,
  });
  const omitOutputSchema = shouldOmitCodexOutputSchema(input.options.jsonSchema?.name);
  const runOptions: { outputSchema?: unknown; signal: AbortSignal } = {
    signal: input.signal,
  };
  const outputSchema = input.options.jsonSchema?.schema;
  if (!omitOutputSchema && outputSchema !== undefined) {
    runOptions.outputSchema = outputSchema;
  }
  const turn = await thread.run(
    [
      { type: 'text', text: input.systemPrompt },
      { type: 'text', text: input.userPrompt },
    ],
    runOptions
  );
  const content = turn.finalResponse || '';
  const providerDebug = {
    provider: 'codex',
    providerEndpointId: endpoint?.id ?? null,
    providerMode: omitOutputSchema ? 'prompt_validated_json' : 'structured_output',
    model,
    modelReasoningEffort,
    outputSchemaOmittedFor: omitOutputSchema ? input.options.jsonSchema?.name : null,
    hasUsage: Boolean(turn.usage),
    itemCount: turn.items.length,
  };
  input.setProviderDebug(providerDebug);
  return {
    content,
    usage: normalizeProviderUsage({
      provider: 'codex',
      rawUsage: turn.usage,
      fallback: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        responseText: content,
      },
    }),
    model,
    providerDebug,
  };
}

function sanitizeCodexProviderEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return (
        typeof value === 'string' &&
        key !== 'CODEX_THREAD_ID' &&
        key !== 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE' &&
        key !== 'CODEX_SHELL' &&
        key !== 'CODEX_CI'
      );
    })
  );
}

async function callAzureProvider(
  input: Parameters<typeof callProvider>[0],
  isEnabled: (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) => boolean,
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): Promise<ProviderCallResult> {
  const endpointConfig = getResolvedProviderEndpoint(input, settings);
  if (!endpointConfig?.enabled && !isEnabled('AZURE_OPENAI_ENABLED', false)) {
    throw new Error('Azure provider is inactive. Enable AZURE_OPENAI_ENABLED first.');
  }
  const apiKey =
    endpointConfig?.apiKey || getStructuredLlmSetting(settings, 'AZURE_OPENAI_API_KEY');
  const endpoint =
    input.options.normalizedRequest?.endpoint ||
    endpointConfig?.endpoint ||
    getStructuredLlmSetting(settings, 'AZURE_OPENAI_ENDPOINT');
  const deploymentName =
    input.options.normalizedRequest?.modelOrDeployment ||
    endpointConfig?.models[0] ||
    getStructuredLlmSetting(settings, 'AZURE_OPENAI_DEPLOYMENT_NAME', 'gpt-5-mini');
  const apiVersion =
    input.options.normalizedRequest?.apiVersion ||
    endpointConfig?.apiVersion ||
    getStructuredLlmSetting(settings, 'AZURE_OPENAI_API_VERSION', '2024-05-01-preview');
  if (!apiKey || !endpoint) {
    throw new Error('Azure OpenAI credentials are not configured in environment variables.');
  }
  const reasoningEffort = toOpenAIReasoningEffort(input.options.normalizedRequest?.thinkingDepth);

  const cleanEndpoint = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  const url = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  let response = await fetch(url, {
    method: 'POST',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      temperature: 0.1,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      response_format: { type: 'json_schema', json_schema: input.options.jsonSchema },
    }),
  });

  if (!response.ok && response.status === 400) {
    await emitSchemaRetryEvents(input.options, 'Azure OpenAI', response.status);
    response = await fetch(url, {
      method: 'POST',
      signal: input.signal,
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userPrompt },
        ],
        temperature: 0.1,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        response_format: { type: 'json_object' },
      }),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure OpenAI call failed with status ${response.status}: ${errorText}`);
  }
  const responseData = await response.json();
  const message = responseData?.choices?.[0]?.message;
  if (message?.tool_calls && input.options.normalizedRequest) {
    await rejectProviderActivity({
      options: input.options,
      request: input.options.normalizedRequest,
      activityType: 'tool_call',
      toolName: message.tool_calls?.[0]?.function?.name ?? null,
      preview: JSON.stringify(message.tool_calls),
    });
  }
  const providerDebug = {
    provider: 'azure-openai',
    providerEndpointId: endpointConfig?.id ?? null,
    status: response.status,
    deploymentName,
    apiVersion,
    reasoningEffort,
    hasChoices: Boolean(responseData?.choices),
  };
  input.setProviderDebug(providerDebug);
  const content = responseData.choices?.[0]?.message?.content || '';
  return {
    content,
    usage: normalizeProviderUsage({
      provider: 'azure-openai',
      rawUsage: responseData?.usage,
      fallback: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        responseText: content,
      },
    }),
    model: deploymentName,
    providerDebug,
  };
}

async function callOpenAIProvider(
  input: Parameters<typeof callProvider>[0],
  isEnabled: (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) => boolean,
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): Promise<ProviderCallResult> {
  const endpointConfig = getResolvedProviderEndpoint(input, settings);
  if (!endpointConfig?.enabled && !isEnabled('OPENAI_ENABLED', true)) {
    throw new Error('OpenAI provider is inactive. Enable OPENAI_ENABLED first.');
  }
  const apiKey = endpointConfig?.apiKey || getStructuredLlmSetting(settings, 'OPENAI_API_KEY');
  const baseURL =
    input.options.normalizedRequest?.endpoint ||
    endpointConfig?.baseUrl ||
    getStructuredLlmSetting(settings, 'OPENAI_BASE_URL', 'https://api.openai.com/v1');
  const model =
    input.options.normalizedRequest?.modelOrDeployment ||
    endpointConfig?.models[0] ||
    getStructuredLlmSetting(settings, 'OPENAI_MODEL', 'gpt-4o-mini');
  const streamResponses = isEnabled('OPENAI_STREAMING_ENABLED', true);
  const reasoningEffort = toOpenAIReasoningEffort(input.options.normalizedRequest?.thinkingDepth);
  if (!apiKey) throw new Error('OpenAI API key is not configured in environment variables.');

  let responseFormat: 'json_schema' | 'json_object' = 'json_schema';
  let response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(
      buildOpenAIChatCompletionBody({
        model,
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        round: input.options.round,
        schemaFirst: input.options.schemaFirst,
        jsonSchema: input.options.jsonSchema,
        responseFormat,
        stream: streamResponses,
        reasoningEffort,
      })
    ),
  });

  if (!response.ok && response.status === 400) {
    await emitSchemaRetryEvents(input.options, 'OpenAI', response.status);
    responseFormat = 'json_object';
    response = await fetch(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      signal: input.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(
        buildOpenAIChatCompletionBody({
          model,
          systemPrompt: input.systemPrompt,
          userPrompt: input.userPrompt,
          round: input.options.round,
          schemaFirst: input.options.schemaFirst,
          jsonSchema: input.options.jsonSchema,
          responseFormat,
          stream: streamResponses,
          reasoningEffort,
        })
      ),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI call failed with status ${response.status}: ${errorText}`);
  }
  const streamResult = streamResponses
    ? await readOpenAIChatCompletionStream({
        response,
        options: input.options,
        normalizedRequest: input.options.normalizedRequest,
        provider: 'openai',
        round: input.options.round,
      })
    : null;
  const responseData = streamResponses ? null : await response.json();
  const message = responseData?.choices?.[0]?.message;
  if (message?.tool_calls && input.options.normalizedRequest) {
    await rejectProviderActivity({
      options: input.options,
      request: input.options.normalizedRequest,
      activityType: 'tool_call',
      toolName: message.tool_calls?.[0]?.function?.name ?? null,
      preview: JSON.stringify(message.tool_calls),
    });
  }
  const content = streamResponses
    ? streamResult?.content || ''
    : responseData?.choices?.[0]?.message?.content || '';
  const rawUsage = streamResponses ? streamResult?.usage : responseData?.usage;
  const providerDebug = {
    provider: 'openai',
    providerEndpointId: endpointConfig?.id ?? null,
    status: response.status,
    model,
    streamed: streamResponses,
    responseFormat,
    reasoningEffort,
    hasChoices: Boolean(responseData?.choices || streamResult),
    hasUsage: Boolean(rawUsage),
  };
  input.setProviderDebug(providerDebug);
  return {
    content,
    usage: normalizeProviderUsage({
      provider: 'openai',
      rawUsage,
      fallback: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        responseText: content,
      },
    }),
    model,
    providerDebug,
  };
}

async function callBedrockProvider(
  input: Parameters<typeof callProvider>[0],
  isEnabled: (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) => boolean,
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): Promise<ProviderCallResult> {
  const endpointConfig = getResolvedProviderEndpoint(input, settings);
  if (!endpointConfig?.enabled && !isEnabled('AWS_BEDROCK_ENABLED', false)) {
    throw new Error('Bedrock provider is inactive. Enable AWS_BEDROCK_ENABLED first.');
  }
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const region =
    input.options.normalizedRequest?.region ||
    endpointConfig?.region ||
    getStructuredLlmSetting(settings, 'AWS_REGION', 'us-east-1');
  const modelId =
    input.options.normalizedRequest?.modelOrDeployment ||
    endpointConfig?.models[0] ||
    getStructuredLlmSetting(
      settings,
      'AWS_BEDROCK_MODEL',
      'anthropic.claude-3-5-sonnet-20241022-v2:0'
    );
  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId: getStructuredLlmSetting(settings, 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: getStructuredLlmSetting(settings, 'AWS_SECRET_ACCESS_KEY'),
    },
  });
  const res = await client.send(
    new ConverseCommand({
      modelId,
      messages: [{ role: 'user', content: [{ text: input.userPrompt }] }],
      system: [{ text: input.systemPrompt }],
      inferenceConfig: { temperature: 0.1 },
    }),
    { abortSignal: input.signal }
  );
  const toolUse = res.output?.message?.content?.find((block) => Boolean(block.toolUse));
  if (toolUse && input.options.normalizedRequest) {
    await rejectProviderActivity({
      options: input.options,
      request: input.options.normalizedRequest,
      activityType: 'tool_use',
      toolName: toolUse.toolUse?.name ?? null,
      preview: JSON.stringify(toolUse),
    });
  }
  const content = res.output?.message?.content?.[0]?.text || '';
  const usage = readProviderUsage(res);
  const providerDebug = {
    provider: 'bedrock',
    providerEndpointId: endpointConfig?.id ?? null,
    modelId,
    hasOutput: Boolean(res.output),
    hasUsage: Boolean(usage),
  };
  input.setProviderDebug(providerDebug);
  return {
    content,
    usage: normalizeProviderUsage({
      provider: 'bedrock',
      rawUsage: usage,
      fallback: {
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        responseText: content,
      },
    }),
    model: modelId,
    providerDebug,
  };
}

function getResolvedProviderEndpoint(
  input: Parameters<typeof callProvider>[0],
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): StructuredLlmProviderEndpoint | null {
  const endpointId = input.options.normalizedRequest?.providerEndpointId;
  if (!endpointId) return null;
  return settings.providerEndpoints?.find((endpoint) => endpoint.id === endpointId) || null;
}

function toCodexReasoningEffort(
  value: string | null | undefined
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  if (value === 'very_high' || value === 'xhigh') return 'xhigh';
  return 'low';
}

function toOpenAIReasoningEffort(
  value: string | null | undefined
): 'low' | 'medium' | 'high' | undefined {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  if (value === 'very_high') return 'high';
  return undefined;
}

function readProviderUsage(value: unknown): unknown {
  return value && typeof value === 'object' && 'usage' in value
    ? (value as { usage?: unknown }).usage
    : null;
}

async function emitSchemaRetryEvents(
  options: CallSupervisorOptions,
  providerLabel: string,
  status: number
) {
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.retry_scheduled',
    severity: 'warning',
    message: `${providerLabel} json_schema request failed with 400; retrying with json_object.`,
    data: { round: options.round ?? null, status },
  });
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.retry_started',
    severity: 'info',
    message: `${providerLabel} json_object retry started.`,
    data: { round: options.round ?? null },
  });
}
