import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  type AppBlueprint,
  appBlueprintSchema,
} from '../../../shared/schemas/app-blueprint.schema';
import { blueprintCatalog } from '../blueprint-catalog';
import { defaultDesignPreset } from '../design-governance';
import { callSupervisorLLM, type SupervisorLlmDebugEvent } from '../supervisor/llm-provider';
import {
  renderSupervisorSkillDocuments,
  resolveSupervisorSkillDocuments,
  summarizeSupervisorSkillDocuments,
} from '../supervisor/skills/registry';
import type { SupervisorRoutingHypothesis } from '../supervisor/skills/types';
import { validateAppBlueprint } from './validation';

type BlueprintSkillDocumentsSummary = ReturnType<typeof summarizeSupervisorSkillDocuments>;

export type BlueprintPromptDiagnostics = {
  schemaIncluded: boolean;
  schemaDigest: string;
  schemaBytes: number;
  catalogComponentCount: number;
  skillDocumentCount: number;
  skillDocuments: BlueprintSkillDocumentsSummary;
};

export type GeneratedBlueprintDraft = {
  blueprint: AppBlueprint;
  validation: ReturnType<typeof validateAppBlueprint>;
  generation: {
    source: 'llm';
    degradedReasons: string[];
    rawOutput?: string;
    skillDocuments: BlueprintSkillDocumentsSummary;
    promptDiagnostics: BlueprintPromptDiagnostics;
  };
};

export class BlueprintDraftGenerationError extends Error {
  rawOutput?: string;
  promptDiagnostics: BlueprintPromptDiagnostics;

  constructor(
    message: string,
    input: { rawOutput?: string; promptDiagnostics: BlueprintPromptDiagnostics }
  ) {
    super(message);
    this.name = 'BlueprintDraftGenerationError';
    this.rawOutput = input.rawOutput;
    this.promptDiagnostics = input.promptDiagnostics;
  }
}

export async function generatePlanModeBlueprintDraft(input: {
  taskId: string;
  title: string;
  prompt: string;
  routing?: SupervisorRoutingHypothesis;
  emitEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<GeneratedBlueprintDraft> {
  const skillDocuments = resolveSupervisorSkillDocuments(input.routing || blueprintRoutingFallback);
  const skillDocumentSummary = summarizeSupervisorSkillDocuments(skillDocuments);
  const appBlueprintJsonSchema = renderAppBlueprintJsonSchema();
  const promptDiagnostics = buildPromptDiagnostics(appBlueprintJsonSchema, skillDocumentSummary);
  const decision = await callSupervisorLLM(
    buildBlueprintSystemPrompt({
      skillContext: renderSupervisorSkillDocuments(skillDocuments),
      appBlueprintJsonSchema,
    }),
    buildBlueprintUserPrompt(input),
    {
      round: 2,
      tolerateSchemaFailure: false,
      emitEvent: input.emitEvent,
    }
  );
  const rawOutput = decision.finalResponse || decision.instruction;

  try {
    const { blueprint, validation } = parseAndValidateBlueprintOutput(rawOutput);
    return {
      blueprint,
      validation,
      generation: {
        source: 'llm',
        degradedReasons: [],
        rawOutput,
        skillDocuments: skillDocumentSummary,
        promptDiagnostics,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BlueprintDraftGenerationError(message, { rawOutput, promptDiagnostics });
  }
}

function parseAndValidateBlueprintOutput(rawOutput: string): {
  blueprint: AppBlueprint;
  validation: ReturnType<typeof validateAppBlueprint>;
} {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) throw new Error('Blueprint LLM output did not contain JSON.');
  const blueprint = appBlueprintSchema.parse(JSON.parse(candidate));
  const validation = validateAppBlueprint(blueprint);
  if (!validation.valid) {
    throw new Error(
      `LLM-generated Blueprint failed validation: ${validation.issues
        .map((issue) => `${issue.path}:${issue.code}`)
        .join(', ')}`
    );
  }
  return { blueprint, validation };
}

function extractJsonCandidate(raw: string): string | null {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) return raw.slice(first, last + 1).trim();
  return null;
}

const blueprintRoutingFallback: SupervisorRoutingHypothesis = {
  primaryMode: 'planning',
  secondaryModes: ['review'],
  phase: 'plan',
  workKinds: ['blueprint', 'ui_ux'],
  overlays: ['user_facing_change'],
  subtype: 'app_blueprint',
  requiredEvidence: ['latest user request'],
  nextSkillFiles: ['references/work_kinds/blueprint.md'],
  confidence: 0.7,
};

function buildBlueprintSystemPrompt(input: {
  skillContext: string;
  appBlueprintJsonSchema: string;
}): string {
  return [
    '[SystemContext]',
    'あなたは AppBlueprint JSON を生成する画面デザインエージェントです。',
    'ユーザーの依頼をもとに、実装前に確認できる高品質な画面構成、主要セクション、見た目の意図、サンプル表示内容、実装タスクを作ってください。',
    '',
    '[Output Contract]',
    'finalResponse に AppBlueprint JSON だけを入れてください。markdown、説明文、コードフェンスは不要です。',
    'JSON は下の [AppBlueprint JSON Schema] に厳密に従ってください。',
    '',
    '[Schema Rules]',
    '- id、screen/section/action/binding/task/hook id、table/column/relation 名は ^[a-z][a-z0-9-]*$ に合わせる。',
    '- screens は最低1件。screen は id/name/path/componentName/sections/actions を持つ。',
    '- componentName は blueprint-catalog.schema.ts の enum から選ぶ。',
    `- designPreset はこの既知presetをそのまま使う: ${JSON.stringify(defaultDesignPreset)}。`,
    '- componentName/source は下の Catalog の組み合わせだけを使う。未掲載のcomponent/source/themeを作らない。',
    '- 画面名、セクション名、コンポーネント選択、余白感、情報密度、サンプル表示内容は、ユーザー依頼の業務・ユーザー・利用シーンに合わせて自律的に決める。',
    '- 通常の Blueprint 生成では DB/DDL/data model/data binding を設計しない。databaseSchema は必ず {"tables":[],"relations":[]}、dataBindings は必ず [] にする。',
    '- 通常の Blueprint 生成では section.dataBindingId を使わない。デザイン確認に必要なサンプル表示は section.props の title、description、items、columns、rows、links、actions、data に入れる。',
    '- DB table/column/relation/binding/DDL の考案は DB Design workflow の担当。必要性がある場合も implementationTasks に「DB Design で検討する」作業として残すだけにする。',
    '- implementationTasks[].affectedDomains は blueprint-ui、blueprint-data、blueprint-binding、blueprints、blueprint-task-planning などから選ぶ。',
    '- section.props は空にしない。プレビューに出せるtitle、description、items、columns、rows、links、actions、dataなどを、選んだcomponentNameに自然な形で入れる。',
    '- description には、なぜその画面構成がよいか、ユーザーが最初に見るべき情報、優先アクションが分かる文を入れる。',
    '',
    '[Catalog]',
    renderBlueprintCatalogPrompt(),
    '',
    '[AppBlueprint JSON Schema]',
    input.appBlueprintJsonSchema,
    '',
    '[Skill Context]',
    input.skillContext,
    '',
    '[Decision JSON Wrapper]',
    'この呼び出し自体は SupervisorDecision JSON で返してください。phase="stop"、workflow="general"、terminalState="completed"、toolCall=null とし、finalResponse に AppBlueprint JSON 文字列を入れてください。',
  ].join('\n');
}

function buildBlueprintUserPrompt(input: {
  taskId: string;
  title: string;
  prompt: string;
  routing?: SupervisorRoutingHypothesis;
}): string {
  return JSON.stringify(
    {
      taskId: input.taskId,
      title: input.title,
      userRequest: input.prompt,
      routingHypothesis: input.routing || null,
      requiredArtifact: 'AppBlueprint JSON',
    },
    null,
    2
  );
}

function renderBlueprintCatalogPrompt(): string {
  return blueprintCatalog
    .map((definition) =>
      [
        definition.name,
        `placement=${definition.placement}`,
        `sources=${definition.allowedSources.join('|')}`,
        `variants=${definition.variants.join('|')}`,
      ].join(' ')
    )
    .join('\n');
}

function renderAppBlueprintJsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(appBlueprintSchema), null, 2);
}

function buildPromptDiagnostics(
  schema: string,
  skillDocuments: BlueprintSkillDocumentsSummary
): BlueprintPromptDiagnostics {
  return {
    schemaIncluded: true,
    schemaDigest: createHash('sha256').update(schema).digest('hex'),
    schemaBytes: Buffer.byteLength(schema, 'utf8'),
    catalogComponentCount: blueprintCatalog.length,
    skillDocumentCount: skillDocuments.length,
    skillDocuments,
  };
}
