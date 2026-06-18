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
  ProviderToolCall,
  ProviderToolDefinition,
  ProviderToolMessage,
  ProviderToolTurnResult,
  RawToolTurnCallOptions,
} from './tool-calls';
import type {
  CallSupervisorOptions,
  NormalizedSupervisorLlmRequest,
  ProviderCallResult,
} from './types';

type OpenAIResponseFormat = 'json_schema' | 'json_object';
type OpenAIChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<OpenAIChatCompletionToolCall>;
    };
  }>;
  usage?: unknown;
};
type OpenAIChatCompletionToolCall = {
  id?: string;
  type?: string;
  function?: {
    name?: string | null;
    arguments?: string | null;
  };
};

const OPENAI_TRANSIENT_RETRY_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 1500;

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

export async function callProviderToolTurn(input: {
  provider: string;
  messages: ProviderToolMessage[];
  tools: ProviderToolDefinition[];
  systemPrompt: string;
  userPrompt: string;
  options: RawToolTurnCallOptions;
  signal: AbortSignal;
  setProviderDebug: (value: Record<string, unknown>) => void;
}): Promise<ProviderToolTurnResult> {
  const settings = readStructuredLlmProviderSettings();
  const isEnabled = (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) =>
    getStructuredLlmBoolSetting(settings, key, fallback);
  const provider = providerAdapterKey(input.options.normalizedRequest.providerId ?? input.provider);

  if (provider === 'openai') {
    return callOpenAIProviderToolTurn(input, isEnabled, settings);
  }
  if (provider === 'azure') {
    return callAzureProviderToolTurn(input, isEnabled, settings);
  }

  const providerDebug = {
    provider,
    providerEndpointId: input.options.normalizedRequest.providerEndpointId ?? null,
    mode: 'provider_native_tools',
    supported: false,
  };
  input.setProviderDebug(providerDebug);
  return {
    type: 'unsupported',
    reason: `Provider does not support native tool turn runtime yet: ${provider}`,
    providerDebug,
  };
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
  const localCompatibleEndpoint =
    endpointConfig?.kind === 'local' || endpointConfig?.kind === 'openai-compatible';
  const streamResponses =
    typeof settings.OPENAI_STREAMING_ENABLED === 'boolean'
      ? settings.OPENAI_STREAMING_ENABLED
      : !localCompatibleEndpoint && isEnabled('OPENAI_STREAMING_ENABLED', true);
  const reasoningEffort = toOpenAIReasoningEffort(input.options.normalizedRequest?.thinkingDepth);
  const apiKeyRequired = !endpointConfig || endpointConfig.kind === 'openai';
  if (apiKeyRequired && !apiKey) {
    throw new Error('OpenAI API key is not configured in environment variables.');
  }
  const headers = buildOpenAICompatibleHeaders(apiKey);
  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const attempts: Array<{
    responseFormat: OpenAIResponseFormat;
    stream: boolean;
    reason: string;
  }> = [];
  const fetchCompletion = async (inputOverride: {
    responseFormat: OpenAIResponseFormat;
    stream: boolean;
    reason: string;
  }) => {
    attempts.push(inputOverride);
    return fetch(url, {
      method: 'POST',
      signal: input.signal,
      headers,
      body: JSON.stringify(
        buildOpenAIChatCompletionBody({
          model,
          systemPrompt: input.systemPrompt,
          userPrompt: input.userPrompt,
          round: input.options.round,
          schemaFirst: input.options.schemaFirst,
          jsonSchema: input.options.jsonSchema,
          responseFormat: inputOverride.responseFormat,
          stream: inputOverride.stream,
          reasoningEffort,
        })
      ),
    });
  };

  let responseFormat: OpenAIResponseFormat = 'json_schema';
  let activeStreamResponses = streamResponses;
  let response: Response;
  try {
    response = await fetchCompletion({
      responseFormat,
      stream: activeStreamResponses,
      reason: 'initial',
    });
  } catch (error) {
    if (!localCompatibleEndpoint) throw error;
    await emitOpenAICompatibilityRetryEvents(input.options, {
      reason: 'transport_error',
      errorMessage: error instanceof Error ? error.message : String(error),
      fromResponseFormat: responseFormat,
      fromStream: activeStreamResponses,
    });
    responseFormat = 'json_object';
    activeStreamResponses = false;
    response = await fetchCompletion({
      responseFormat,
      stream: activeStreamResponses,
      reason: 'local_transport_compatibility_retry',
    });
  }

  if (!response.ok && response.status === 400) {
    await emitSchemaRetryEvents(input.options, 'OpenAI', response.status);
    responseFormat = 'json_object';
    if (localCompatibleEndpoint) activeStreamResponses = false;
    response = await fetchCompletion({
      responseFormat,
      stream: activeStreamResponses,
      reason: 'schema_400_retry',
    });
  }

  if (!response.ok) {
    response = await retryOpenAITransientUnavailableOnce({
      response,
      input,
      fetchCompletion,
      responseFormat,
      stream: activeStreamResponses,
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI call failed with status ${response.status}: ${errorText}`);
  }
  let streamResult: { content: string; usage: unknown | null } | null = null;
  let responseData: OpenAIChatCompletionResponse | null = null;
  if (activeStreamResponses) {
    try {
      streamResult = await readOpenAIChatCompletionStream({
        response,
        options: input.options,
        normalizedRequest: input.options.normalizedRequest,
        provider: 'openai',
        round: input.options.round,
      });
    } catch (error) {
      if (!localCompatibleEndpoint) throw error;
      await emitOpenAICompatibilityRetryEvents(input.options, {
        reason: 'stream_read_error',
        errorMessage: error instanceof Error ? error.message : String(error),
        fromResponseFormat: responseFormat,
        fromStream: activeStreamResponses,
      });
      responseFormat = 'json_object';
      activeStreamResponses = false;
      response = await fetchCompletion({
        responseFormat,
        stream: activeStreamResponses,
        reason: 'local_stream_compatibility_retry',
      });
      if (!response.ok) {
        response = await retryOpenAITransientUnavailableOnce({
          response,
          input,
          fetchCompletion,
          responseFormat,
          stream: activeStreamResponses,
        });
      }
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI call failed with status ${response.status}: ${errorText}`);
      }
      responseData = await response.json();
    }
  } else {
    responseData = await response.json();
  }
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
  const content = activeStreamResponses
    ? streamResult?.content || ''
    : responseData?.choices?.[0]?.message?.content || '';
  const rawUsage = activeStreamResponses ? streamResult?.usage : responseData?.usage;
  const providerDebug = {
    provider: 'openai',
    providerEndpointId: endpointConfig?.id ?? null,
    status: response.status,
    model,
    streamed: activeStreamResponses,
    responseFormat,
    reasoningEffort,
    hasChoices: Boolean(responseData?.choices || streamResult),
    hasUsage: Boolean(rawUsage),
    attempts,
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

async function callAzureProviderToolTurn(
  input: Parameters<typeof callProviderToolTurn>[0],
  isEnabled: (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) => boolean,
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): Promise<ProviderToolTurnResult> {
  const endpointConfig = getResolvedProviderEndpoint(input, settings);
  if (!endpointConfig?.enabled && !isEnabled('AZURE_OPENAI_ENABLED', false)) {
    throw new Error('Azure provider is inactive. Enable AZURE_OPENAI_ENABLED first.');
  }
  const apiKey =
    endpointConfig?.apiKey || getStructuredLlmSetting(settings, 'AZURE_OPENAI_API_KEY');
  const endpoint =
    input.options.normalizedRequest.endpoint ||
    endpointConfig?.endpoint ||
    getStructuredLlmSetting(settings, 'AZURE_OPENAI_ENDPOINT');
  const deploymentName =
    input.options.normalizedRequest.modelOrDeployment ||
    endpointConfig?.models[0] ||
    getStructuredLlmSetting(settings, 'AZURE_OPENAI_DEPLOYMENT_NAME', 'gpt-5-mini');
  const apiVersion =
    input.options.normalizedRequest.apiVersion ||
    endpointConfig?.apiVersion ||
    getStructuredLlmSetting(settings, 'AZURE_OPENAI_API_VERSION', '2024-05-01-preview');
  if (!apiKey || !endpoint) {
    throw new Error('Azure OpenAI credentials are not configured in environment variables.');
  }
  const reasoningEffort = toOpenAIReasoningEffort(input.options.normalizedRequest.thinkingDepth);
  const cleanEndpoint = endpoint.replace(/\/+$/, '');
  const url = `${cleanEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  const response = await fetch(url, {
    method: 'POST',
    signal: input.signal,
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      messages: toOpenAIToolMessages(input.messages),
      tools: input.tools.map(toOpenAIToolDefinition),
      tool_choice: input.options.toolChoice ?? 'auto',
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Azure OpenAI native tool call failed with status ${response.status}: ${errorText}`
    );
  }

  const responseData = (await response.json()) as OpenAIChatCompletionResponse;
  const message = responseData.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = (message?.tool_calls ?? []).flatMap(toProviderToolCall);
  const providerDebug = {
    provider: 'azure-openai',
    providerEndpointId: endpointConfig?.id ?? null,
    mode: 'provider_native_tools',
    status: response.status,
    deploymentName,
    apiVersion,
    reasoningEffort,
    hasChoices: Boolean(responseData.choices),
    hasUsage: Boolean(responseData.usage),
    toolCallCount: toolCalls.length,
  };
  input.setProviderDebug(providerDebug);

  return {
    type: 'supported',
    content,
    toolCalls,
    usage: normalizeProviderUsage({
      provider: 'azure-openai',
      rawUsage: responseData.usage,
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

async function callOpenAIProviderToolTurn(
  input: Parameters<typeof callProviderToolTurn>[0],
  isEnabled: (key: Parameters<typeof getStructuredLlmBoolSetting>[1], fallback: boolean) => boolean,
  settings: ReturnType<typeof readStructuredLlmProviderSettings>
): Promise<ProviderToolTurnResult> {
  const endpointConfig = getResolvedProviderEndpoint(input, settings);
  if (!endpointConfig?.enabled && !isEnabled('OPENAI_ENABLED', true)) {
    throw new Error('OpenAI provider is inactive. Enable OPENAI_ENABLED first.');
  }
  const apiKey = endpointConfig?.apiKey || getStructuredLlmSetting(settings, 'OPENAI_API_KEY');
  const baseURL =
    input.options.normalizedRequest.endpoint ||
    endpointConfig?.baseUrl ||
    getStructuredLlmSetting(settings, 'OPENAI_BASE_URL', 'https://api.openai.com/v1');
  const model =
    input.options.normalizedRequest.modelOrDeployment ||
    endpointConfig?.models[0] ||
    getStructuredLlmSetting(settings, 'OPENAI_MODEL', 'gpt-4o-mini');
  const reasoningEffort = toOpenAIReasoningEffort(input.options.normalizedRequest.thinkingDepth);
  const apiKeyRequired = !endpointConfig || endpointConfig.kind === 'openai';
  if (apiKeyRequired && !apiKey) {
    throw new Error('OpenAI API key is not configured in environment variables.');
  }

  const url = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    signal: input.signal,
    headers: buildOpenAICompatibleHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: toOpenAIToolMessages(input.messages),
      tools: input.tools.map(toOpenAIToolDefinition),
      tool_choice: input.options.toolChoice ?? 'auto',
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI native tool call failed with status ${response.status}: ${errorText}`);
  }

  const responseData = (await response.json()) as OpenAIChatCompletionResponse;
  const message = responseData.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : '';
  const toolCalls = (message?.tool_calls ?? []).flatMap(toProviderToolCall);
  const providerDebug = {
    provider: 'openai',
    providerEndpointId: endpointConfig?.id ?? null,
    mode: 'provider_native_tools',
    status: response.status,
    model,
    reasoningEffort,
    hasChoices: Boolean(responseData.choices),
    hasUsage: Boolean(responseData.usage),
    toolCallCount: toolCalls.length,
  };
  input.setProviderDebug(providerDebug);

  return {
    type: 'supported',
    content,
    toolCalls,
    usage: normalizeProviderUsage({
      provider: 'openai',
      rawUsage: responseData.usage,
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

function toOpenAIToolMessages(messages: ProviderToolMessage[]) {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments ?? {}),
                },
              })),
            }
          : {}),
      };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function toOpenAIToolDefinition(tool: ProviderToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toProviderToolCall(call: OpenAIChatCompletionToolCall): ProviderToolCall[] {
  const name = call.function?.name;
  if (!name) return [];
  return [
    {
      id: call.id || `call_${Date.now()}`,
      name,
      arguments: parseToolArguments(call.function?.arguments ?? ''),
    },
  ];
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

async function retryOpenAITransientUnavailableOnce(input: {
  response: Response;
  input: Parameters<typeof callProvider>[0];
  fetchCompletion: (override: {
    responseFormat: OpenAIResponseFormat;
    stream: boolean;
    reason: string;
  }) => Promise<Response>;
  responseFormat: OpenAIResponseFormat;
  stream: boolean;
}): Promise<Response> {
  const errorText = await input.response.text();
  if (!isOpenAITransientUnavailable(input.response.status, errorText)) {
    return new Response(errorText, {
      status: input.response.status,
      statusText: input.response.statusText,
      headers: input.response.headers,
    });
  }

  await emitOpenAITransientRetryEvents(input.input.options, {
    status: input.response.status,
    errorText,
    responseFormat: input.responseFormat,
    stream: input.stream,
    retryDelayMs: OPENAI_TRANSIENT_RETRY_DELAY_MS,
  });
  if (OPENAI_TRANSIENT_RETRY_DELAY_MS > 0) {
    await sleep(OPENAI_TRANSIENT_RETRY_DELAY_MS, input.input.signal);
  }
  return input.fetchCompletion({
    responseFormat: input.responseFormat,
    stream: input.stream,
    reason: 'transient_unavailable_retry',
  });
}

function buildOpenAICompatibleHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
  input: { options: { normalizedRequest?: NormalizedSupervisorLlmRequest } },
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

function isOpenAITransientUnavailable(status: number, errorText: string) {
  if (status !== 503) return false;
  return /loading model|unavailable_error/i.test(errorText);
}

function truncateProviderErrorText(value: string) {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

async function sleep(ms: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true }
    );
  });
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

async function emitOpenAITransientRetryEvents(
  options: CallSupervisorOptions,
  input: {
    status: number;
    errorText: string;
    responseFormat: OpenAIResponseFormat;
    stream: boolean;
    retryDelayMs: number;
  }
) {
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.retry_scheduled',
    severity: 'warning',
    message: `OpenAI provider returned transient ${input.status}; retrying the same request.`,
    data: {
      round: options.round ?? null,
      status: input.status,
      reason: 'transient_unavailable',
      errorText: truncateProviderErrorText(input.errorText),
      responseFormat: input.responseFormat,
      stream: input.stream,
      retryDelayMs: input.retryDelayMs,
    },
  });
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.retry_started',
    severity: 'info',
    message: 'OpenAI transient unavailable retry started.',
    data: { round: options.round ?? null, reason: 'transient_unavailable' },
  });
}

async function emitOpenAICompatibilityRetryEvents(
  options: CallSupervisorOptions,
  input: {
    reason: 'transport_error' | 'stream_read_error';
    errorMessage: string;
    fromResponseFormat: OpenAIResponseFormat;
    fromStream: boolean;
  }
) {
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.retry_scheduled',
    severity: 'warning',
    message:
      'OpenAI-compatible local endpoint failed during structured chat completion; retrying with non-stream json_object.',
    data: {
      round: options.round ?? null,
      reason: input.reason,
      errorMessage: input.errorMessage,
      fromResponseFormat: input.fromResponseFormat,
      fromStream: input.fromStream,
      retryResponseFormat: 'json_object',
      retryStream: false,
    },
  });
  await emitSupervisorLlmDebugEvent(options, {
    type: 'model.retry_started',
    severity: 'info',
    message: 'OpenAI-compatible local json_object non-stream retry started.',
    data: { round: options.round ?? null, reason: input.reason },
  });
}
