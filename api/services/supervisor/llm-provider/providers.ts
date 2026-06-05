import { estimateLlmUsage, normalizeProviderUsage } from '../../llm-usage';
import {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
  buildCodexTurnPrompt,
  readCodexStreamedTurn,
} from './codex';
import { emitSupervisorLlmDebugEvent } from './events';
import { readSchemaFirstFixtureOutput } from './fixture';
import { buildOpenAIChatCompletionBody, readOpenAIChatCompletionStream } from './openai';
import type { CallSupervisorOptions, ProviderCallResult } from './types';

export type RawLlmCallOptions = CallSupervisorOptions & {
  jsonSchema?: { name: string; schema: unknown };
  label: string;
};

export async function callProvider(input: {
  provider: string;
  systemPrompt: string;
  userPrompt: string;
  options: RawLlmCallOptions;
  signal: AbortSignal;
  setProviderDebug: (value: Record<string, unknown>) => void;
}): Promise<ProviderCallResult> {
  const isEnabled = (key: string, fallback: boolean) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    return raw.toLowerCase() === 'true';
  };

  if (input.provider === 'azure') return callAzureProvider(input, isEnabled);
  if (input.provider === 'openai') return callOpenAIProvider(input, isEnabled);
  if (input.provider === 'bedrock') return callBedrockProvider(input, isEnabled);
  if (input.provider === 'codex') return callCodexProvider(input, isEnabled);
  if (input.provider === 'fixture' || input.provider === 'test') return callFixtureProvider(input);

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

async function callAzureProvider(
  input: Parameters<typeof callProvider>[0],
  isEnabled: (key: string, fallback: boolean) => boolean
): Promise<ProviderCallResult> {
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
    signal: input.signal,
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userPrompt },
      ],
      temperature: 0.1,
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
        response_format: { type: 'json_object' },
      }),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure OpenAI call failed with status ${response.status}: ${errorText}`);
  }
  const responseData = await response.json();
  const providerDebug = {
    provider: 'azure',
    status: response.status,
    deploymentName,
    hasChoices: Boolean(responseData?.choices),
  };
  input.setProviderDebug(providerDebug);
  const content = responseData.choices?.[0]?.message?.content || '';
  return {
    content,
    usage: normalizeProviderUsage({
      provider: 'azure',
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
  isEnabled: (key: string, fallback: boolean) => boolean
): Promise<ProviderCallResult> {
  if (!isEnabled('OPENAI_ENABLED', true)) {
    throw new Error('OpenAI provider is inactive. Enable OPENAI_ENABLED first.');
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const streamResponses = isEnabled('OPENAI_STREAMING_ENABLED', true);
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
        provider: 'openai',
        round: input.options.round,
      })
    : null;
  const responseData = streamResponses ? null : await response.json();
  const content = streamResponses
    ? streamResult?.content || ''
    : responseData?.choices?.[0]?.message?.content || '';
  const rawUsage = streamResponses ? streamResult?.usage : responseData?.usage;
  const providerDebug = {
    provider: 'openai',
    status: response.status,
    model,
    streamed: streamResponses,
    responseFormat,
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
  isEnabled: (key: string, fallback: boolean) => boolean
): Promise<ProviderCallResult> {
  if (!isEnabled('AWS_BEDROCK_ENABLED', false)) {
    throw new Error('Bedrock provider is inactive. Enable AWS_BEDROCK_ENABLED first.');
  }
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
  const region = process.env.AWS_REGION || 'us-east-1';
  const modelId = process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
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
  const content = res.output?.message?.content?.[0]?.text || '';
  const providerDebug = {
    provider: 'bedrock',
    modelId,
    hasOutput: Boolean(res.output),
    hasUsage: Boolean((res as any).usage),
  };
  input.setProviderDebug(providerDebug);
  return {
    content,
    usage: normalizeProviderUsage({
      provider: 'bedrock',
      rawUsage: (res as any).usage,
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

async function callCodexProvider(
  input: Parameters<typeof callProvider>[0],
  isEnabled: (key: string, fallback: boolean) => boolean
): Promise<ProviderCallResult> {
  if (!isEnabled('CODEX_ENABLED', false)) {
    throw new Error('Codex provider is inactive. Enable CODEX_ENABLED first.');
  }
  const { Codex } = await import('@openai/codex-sdk');
  const accessToken = process.env.CODEX_ACCESS_TOKEN || '';
  const configuredModel = process.env.CODEX_MODEL || undefined;
  const sdkOptions = buildCodexSupervisorSdkOptions(accessToken);
  const codex = new Codex(sdkOptions);
  const threadOptions = buildCodexSupervisorThreadOptions(
    configuredModel,
    input.options.workingDirectory
  );
  const thread = codex.startThread(threadOptions);
  const useStructuredOutput = isEnabled('CODEX_STRUCTURED_OUTPUT_ENABLED', false);
  const turn = await readCodexStreamedTurn({
    thread,
    prompt: buildCodexTurnPrompt(input.systemPrompt, input.userPrompt),
    outputSchema: useStructuredOutput ? input.options.jsonSchema?.schema : undefined,
    signal: input.signal,
    options: input.options,
  });
  const providerDebug = {
    provider: 'codex',
    model: configuredModel || null,
    structuredOutput: useStructuredOutput,
    modelReasoningEffort: threadOptions.modelReasoningEffort,
    workingDirectory: threadOptions.workingDirectory,
    usage: turn.usage,
    hasContent: Boolean(turn.content),
  };
  input.setProviderDebug(providerDebug);
  const content = turn.content || '';
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
    model: configuredModel || null,
    providerDebug,
  };
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
