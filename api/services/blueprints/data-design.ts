import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type AppBlueprint,
  appBlueprintSchema,
} from '../../../shared/schemas/app-blueprint.schema';
import { callStructuredJsonLLM, type SupervisorLlmDebugEvent } from '../supervisor/llm-provider';
import { validateAppBlueprint } from './validation';

const blueprintDbDesignTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schema') }),
  z.object({ kind: z.literal('table'), tableName: z.string().min(1) }),
  z.object({ kind: z.literal('relation'), relationId: z.string().min(1) }),
  z.object({ kind: z.literal('binding'), bindingId: z.string().min(1) }),
  z.object({
    kind: z.literal('screen'),
    screenId: z.string().min(1),
    sectionId: z.string().min(1).optional(),
  }),
]);

export const blueprintDbDesignRequestSchema = z.object({
  blueprintId: z.string().min(1),
  target: blueprintDbDesignTargetSchema,
  prompt: z.string().min(1),
  currentBlueprint: appBlueprintSchema,
  validationIssues: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type BlueprintDbDesignRequest = z.infer<typeof blueprintDbDesignRequestSchema>;

export type GeneratedBlueprintDataDesignDraft = {
  blueprint: AppBlueprint;
  validation: ReturnType<typeof validateAppBlueprint>;
  generation: {
    source: 'blueprint-db-design';
    rawOutput?: string;
    promptDiagnostics: {
      schemaIncluded: boolean;
      schemaDigest: string;
      schemaBytes: number;
      currentBlueprintBytes: number;
      validationIssueCount: number;
      target: BlueprintDbDesignRequest['target'];
    };
  };
};

export class BlueprintDataDesignGenerationError extends Error {
  rawOutput?: string;
  promptDiagnostics: GeneratedBlueprintDataDesignDraft['generation']['promptDiagnostics'];

  constructor(
    message: string,
    input: {
      rawOutput?: string;
      promptDiagnostics: GeneratedBlueprintDataDesignDraft['generation']['promptDiagnostics'];
    }
  ) {
    super(message);
    this.name = 'BlueprintDataDesignGenerationError';
    this.rawOutput = input.rawOutput;
    this.promptDiagnostics = input.promptDiagnostics;
  }
}

export function parseBlueprintDbDesignRequestPrompt(prompt: string): BlueprintDbDesignRequest {
  const markerMatch = prompt.match(/```json blueprint-db-design-request\s*([\s\S]*?)\s*```/i);
  const jsonText = markerMatch?.[1]?.trim() || extractJsonCandidate(prompt);
  if (!jsonText) throw new Error('DB Design request JSON was not found.');
  return blueprintDbDesignRequestSchema.parse(JSON.parse(jsonText));
}

export async function generateBlueprintDataDesignDraft(input: {
  taskId: string;
  request: BlueprintDbDesignRequest;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<GeneratedBlueprintDataDesignDraft> {
  const appBlueprintJsonSchema = renderAppBlueprintJsonSchema();
  const promptDiagnostics = buildPromptDiagnostics(appBlueprintJsonSchema, input.request);
  const rawOutput = await callStructuredJsonLLM(
    buildBlueprintDataDesignSystemPrompt(appBlueprintJsonSchema),
    buildBlueprintDataDesignUserPrompt(input.request),
    {
      schemaName: 'app_blueprint_data_design',
      schema: z.toJSONSchema(appBlueprintSchema),
      emitEvent: input.emitEvent,
      taskId: input.taskId,
      runId: null,
    }
  );

  try {
    const candidate = extractJsonCandidate(rawOutput);
    if (!candidate) throw new Error('Blueprint DB Design LLM output did not contain JSON.');
    const blueprint = appBlueprintSchema.parse(JSON.parse(candidate));
    const validation = validateAppBlueprint(blueprint);
    if (!validation.valid) {
      throw new Error(
        `LLM-generated DB Design Blueprint failed validation: ${validation.issues
          .map((issue) => `${issue.path}:${issue.code}`)
          .join(', ')}`
      );
    }
    return {
      blueprint,
      validation,
      generation: {
        source: 'blueprint-db-design',
        rawOutput,
        promptDiagnostics,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BlueprintDataDesignGenerationError(message, { rawOutput, promptDiagnostics });
  }
}

function buildBlueprintDataDesignSystemPrompt(appBlueprintJsonSchema: string): string {
  return [
    '[SystemContext]',
    'あなたは AppBlueprint の DB Design を改善するデータ設計エージェントです。',
    '現在の Blueprint をもとに databaseSchema と dataBindings を再設計してください。',
    'この作業は設計契約の更新であり、SQL、migration、Drizzle schema、物理 DB 操作は作りません。',
    '',
    '[Output Contract]',
    'AppBlueprint JSON だけを返してください。markdown、説明文、コードフェンスは不要です。',
    'JSON は下の [AppBlueprint JSON Schema] に厳密に従ってください。',
    '',
    '[Rules]',
    '- 完全な revised AppBlueprint を返してください。patch や diff は返さない。',
    '- id/name/version/designPreset/screens は、DB 設計や binding 整合に必要な場合だけ変更してください。',
    '- databaseSchema.tables、databaseSchema.relations、dataBindings を相互整合させてください。',
    '- screen.sections[].dataBindingId を使う場合、その binding は dataBindings[] に存在させてください。',
    '- dataBindings[].table は databaseSchema.tables[].name に一致させてください。',
    '- dataBindings[].fields と sort は対象 table の columns[].name だけを使ってください。',
    '- table/column/relation/binding id は ^[a-z][a-z0-9-]*$ に合わせてください。',
    '- 各 table には primaryKey な column を最低1つ含めてください。',
    '- SQL、DDL、migration、runtime DB call、Drizzle code は返さないでください。',
    '',
    '[AppBlueprint JSON Schema]',
    appBlueprintJsonSchema,
  ].join('\n');
}

function buildBlueprintDataDesignUserPrompt(request: BlueprintDbDesignRequest): string {
  return JSON.stringify(
    {
      source: 'blueprint-db-design',
      target: request.target,
      latestUserInstruction: request.prompt,
      currentBlueprint: request.currentBlueprint,
      validationIssues: request.validationIssues,
    },
    null,
    2
  );
}

function renderAppBlueprintJsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(appBlueprintSchema), null, 2);
}

function buildPromptDiagnostics(
  schema: string,
  request: BlueprintDbDesignRequest
): GeneratedBlueprintDataDesignDraft['generation']['promptDiagnostics'] {
  const currentBlueprintText = JSON.stringify(request.currentBlueprint);
  return {
    schemaIncluded: true,
    schemaDigest: createHash('sha256').update(schema).digest('hex'),
    schemaBytes: Buffer.byteLength(schema, 'utf8'),
    currentBlueprintBytes: Buffer.byteLength(currentBlueprintText, 'utf8'),
    validationIssueCount: request.validationIssues.length,
    target: request.target,
  };
}

function extractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim();
  return null;
}
