import { randomUUID } from 'node:crypto';
import { appendLlmTrace, appendSupervisorTrace, logger } from '../../../lib/logger';
import { estimateTokens } from '../../conversation-context/token-budget';
import type { NormalizedLlmUsage } from '../../llm-usage';
import { recordLlmUsage } from '../../llm-usage';
import {
  type AgentToolCallEnvelope,
  buildResponseJsonSchema as buildSchemaFirstResponseJsonSchema,
  type JobTypeSelection,
  parseSupervisorOutput,
} from '../schema-first';
import { emitSupervisorLlmDebugEvent } from './events';
import { createSupervisorLlmAbortSignal, digestLlmText, jsonFixWrapper } from './json';
import { callProvider, type RawLlmCallOptions } from './providers';
import type { CallSupervisorOptions, StructuredJsonLlmOptions } from './types';

export {
  buildCodexSupervisorSdkOptions,
  buildCodexSupervisorThreadOptions,
  buildCodexTurnPrompt,
} from './codex';
export type { SupervisorLlmDebugEvent } from './types';

export async function callSupervisorLLM(
  systemPrompt: string,
  userPrompt: string,
  options: CallSupervisorOptions & { schemaFirst: true; round: 1 | 2 }
): Promise<JobTypeSelection | AgentToolCallEnvelope> {
  const rawContent = await callRawJsonLLM(systemPrompt, userPrompt, {
    ...options,
    jsonSchema: buildSchemaFirstResponseJsonSchema(options.round),
    label: 'supervisor',
  });
  const parsedJson = await parseJsonContent(rawContent, options, 'Supervisor LLM');
  try {
    return parseSupervisorOutput(parsedJson.parsedJson, options.round);
  } catch (err) {
    await emitSupervisorLlmDebugEvent(options, {
      type: 'model.response_parse_failed',
      severity: 'error',
      message: 'Schema-first LLM response failed schema validation.',
      data: {
        round: options.round,
        errorMessage: err instanceof Error ? err.message : String(err),
        rawContentPreview: rawContent.slice(0, 500),
      },
    });
    throw err;
  }
}

export async function callStructuredJsonLLM(
  systemPrompt: string,
  userPrompt: string,
  options: StructuredJsonLlmOptions
): Promise<string> {
  const rawContent = await callRawJsonLLM(systemPrompt, userPrompt, {
    ...options,
    jsonSchema: { name: options.schemaName, schema: options.schema },
    label: options.schemaName,
  });
  const parsedJson = await parseJsonContent(rawContent, options, options.schemaName);
  return parsedJson.sourceText;
}

async function callRawJsonLLM(
  systemPrompt: string,
  userPrompt: string,
  options: RawLlmCallOptions
): Promise<string> {
  const provider = process.env.ACTIVE_LLM_PROVIDER || 'azure';
  const startedAt = Date.now();
  const callId = randomUUID();
  const requestSignal = createSupervisorLlmAbortSignal(options);
  let rawContent = '';
  let providerDebug: Record<string, unknown> = {};
  let providerModel: string | null | undefined = null;
  let providerUsage: NormalizedLlmUsage | null = null;

  appendLlmTrace('request', {
    callId,
    provider,
    round: options.round ?? null,
    label: options.label,
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
      label: options.label,
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
      label: options.label,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    },
  });

  try {
    const providerResult = await callProvider({
      provider,
      systemPrompt,
      userPrompt,
      options,
      signal: requestSignal,
      setProviderDebug: (value) => {
        providerDebug = value;
      },
    });
    rawContent = providerResult.content;
    providerDebug = providerResult.providerDebug ?? providerDebug;
    providerModel = providerResult.model;
    providerUsage = providerResult.usage;
    providerDebug = { ...providerDebug, normalizedUsage: providerUsage };
  } catch (error) {
    appendLlmTrace('provider_error', {
      callId,
      provider,
      round: options.round ?? null,
      label: options.label,
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
      label: options.label,
      durationMs: Date.now() - startedAt,
      providerDebug,
    });
    throw new Error('LLM returned an empty message response.');
  }

  if (options.taskId && providerUsage) {
    const promptPartTokenEstimates = {
      ...options.promptPartTokenEstimates,
      systemPromptTokens:
        options.promptPartTokenEstimates?.systemPromptTokens ?? estimateTokens(systemPrompt),
      userPromptTokens:
        options.promptPartTokenEstimates?.userPromptTokens ?? estimateTokens(userPrompt),
    };
    await recordLlmUsage({
      taskId: options.taskId,
      runId: options.runId ?? null,
      callId,
      provider,
      model: providerModel ?? null,
      label: options.label,
      round: options.round ?? null,
      usage: providerUsage,
      promptPartTokenEstimates,
      durationMs: Date.now() - startedAt,
      metadataJson: {
        schemaFirst: Boolean(options.schemaFirst),
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        systemPromptBytes: Buffer.byteLength(systemPrompt, 'utf8'),
        userPromptBytes: Buffer.byteLength(userPrompt, 'utf8'),
        systemPromptSha256: digestLlmText(systemPrompt),
        userPromptSha256: digestLlmText(userPrompt),
      },
    });
  }

  appendLlmTrace('response', {
    callId,
    provider,
    round: options.round ?? null,
    label: options.label,
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
      label: options.label,
      rawContentLength: rawContent.length,
      rawContent,
      durationMs: Date.now() - startedAt,
      providerDebug,
    },
  });

  return rawContent;
}

async function parseJsonContent(rawContent: string, options: CallSupervisorOptions, label: string) {
  const jsonFix = jsonFixWrapper(rawContent);
  if (!jsonFix) {
    await emitSupervisorLlmDebugEvent(options, {
      type: 'model.response_parse_failed',
      severity: 'error',
      message: `${label} JSON parse failed and automatic repair did not produce JSON.`,
      data: { round: options.round ?? null, rawContentPreview: rawContent.slice(0, 500) },
    });
    appendSupervisorTrace('json_parse_failed', {
      round: options.round,
      errorMessage: 'JSON parse failed and automatic repair did not produce JSON',
      rawContentPreview: rawContent.slice(0, 1000),
    });
    throw new Error(`${label} response JSON parse failed.`);
  }
  if (jsonFix.repaired) {
    await emitSupervisorLlmDebugEvent(options, {
      type: 'model.response_repaired',
      severity: 'warning',
      message: `${label} response JSON was repaired before schema validation.`,
      data: {
        round: options.round ?? null,
        repairKind: jsonFix.repairKind,
        rawContentLength: rawContent.length,
        repairedContentLength: jsonFix.sourceText.length,
      },
    });
  }
  return jsonFix;
}
