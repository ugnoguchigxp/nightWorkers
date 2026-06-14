import { describe, expect, it } from 'vitest';
import { callStructuredJsonLLM, callSupervisorLLM } from '../../api/services/structured-llm';
import { installStructuredLlmEnvHooks } from './structured-llm-test-env';

describe('Supervisor LLM schema-first parsing', () => {
  installStructuredLlmEnvHooks();

  it('requires explicit fixture JSON instead of falling back to hardcoded tool calls', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
    delete process.env.SUPERVISOR_FIXTURE_ROUND2_OUTPUT;

    await expect(
      callSupervisorLLM('system', JSON.stringify({ toolResults: [] }), {
        round: 2,
        schemaFirst: true,
      })
    ).rejects.toThrow(/SUPERVISOR_FIXTURE_ROUND2_OUTPUT/);
  });

  it('uses explicit fixture JSON for structured JSON calls', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
      title: 'Configured fixture output',
      items: ['one'],
    });

    const rawOutput = await callStructuredJsonLLM('system', 'user', {
      schemaName: 'example_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'items'],
        properties: {
          title: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
      },
    });

    expect(JSON.parse(rawOutput)).toEqual({
      title: 'Configured fixture output',
      items: ['one'],
    });
  });

  it('rejects non-JSON structured fixture output', async () => {
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_OUTPUT = 'plain fixture text';

    await expect(
      callStructuredJsonLLM('system', 'user', {
        schemaName: 'example_schema',
        schema: { type: 'object' },
      })
    ).rejects.toThrow(/response JSON parse failed/);
  });
});
