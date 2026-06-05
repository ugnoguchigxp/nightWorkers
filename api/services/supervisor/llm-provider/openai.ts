import { logger } from '../../../lib/logger';
import { buildResponseJsonSchema as buildSchemaFirstResponseJsonSchema } from '../schema-first';
import { createSupervisorResponseDeltaEmitter } from './events';
import type { CallSupervisorOptions } from './types';

export function buildOpenAIChatCompletionBody(input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  round?: 1 | 2;
  schemaFirst?: boolean;
  jsonSchema?: { name: string; schema: unknown };
  responseFormat: 'json_schema' | 'json_object';
  stream: boolean;
}) {
  const jsonSchema =
    input.jsonSchema || buildSchemaFirstResponseJsonSchema(input.round === 1 ? 1 : 2);
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
            json_schema: jsonSchema,
          }
        : { type: 'json_object' },
  };
}

export async function readOpenAIChatCompletionStream(input: {
  response: Response;
  options: CallSupervisorOptions;
  provider: string;
  round?: 1 | 2;
}): Promise<string> {
  if (!input.response.body) {
    throw new Error('OpenAI streaming response did not include a readable body.');
  }

  const decoder = new TextDecoder();
  const reader = input.response.body.getReader();
  const deltaEmitter = createSupervisorResponseDeltaEmitter({
    options: input.options,
    provider: input.provider,
    round: input.round,
  });
  let buffer = '';
  let content = '';

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
        await deltaEmitter.push(delta);
      }
    }
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
  if (buffer.trim()) await processStreamRecord(buffer);
  await deltaEmitter.flush();
  return content;
}
