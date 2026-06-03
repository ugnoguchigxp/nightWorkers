import {
  type AppBlueprint,
  appBlueprintSchema,
} from '../../../shared/schemas/app-blueprint.schema';
import { callSupervisorLLM } from '../supervisor/llm-provider';
import {
  renderSupervisorSkillDocuments,
  resolveSupervisorSkillDocuments,
  summarizeSupervisorSkillDocuments,
} from '../supervisor/skills/registry';
import type { SupervisorRoutingHypothesis } from '../supervisor/skills/types';
import { validateAppBlueprint } from './validation';

export type GeneratedBlueprintDraft = {
  blueprint: AppBlueprint;
  validation: ReturnType<typeof validateAppBlueprint>;
  generation: {
    source: 'llm';
    degradedReasons: string[];
    rawOutput?: string;
    skillDocuments: ReturnType<typeof summarizeSupervisorSkillDocuments>;
  };
};

export async function generatePlanModeBlueprintDraft(input: {
  taskId: string;
  title: string;
  prompt: string;
  routing?: SupervisorRoutingHypothesis;
}): Promise<GeneratedBlueprintDraft> {
  const skillDocuments = resolveSupervisorSkillDocuments(input.routing || blueprintRoutingFallback);
  const decision = await callSupervisorLLM(
    buildBlueprintSystemPrompt(renderSupervisorSkillDocuments(skillDocuments)),
    buildBlueprintUserPrompt(input),
    {
      round: 2,
      tolerateSchemaFailure: false,
    }
  );
  const rawOutput = decision.finalResponse || decision.instruction;
  const blueprint = parseBlueprintOutput(rawOutput);
  const validation = validateAppBlueprint(blueprint);
  if (!validation.valid) {
    throw new Error(
      `LLM-generated Blueprint failed validation: ${validation.issues
        .map((issue) => `${issue.path}:${issue.code}`)
        .join(', ')}`
    );
  }
  return {
    blueprint,
    validation,
    generation: {
      source: 'llm',
      degradedReasons: [],
      rawOutput,
      skillDocuments: summarizeSupervisorSkillDocuments(skillDocuments),
    },
  };
}

function parseBlueprintOutput(rawOutput: string): AppBlueprint {
  const candidate = extractJsonCandidate(rawOutput);
  if (!candidate) throw new Error('Blueprint LLM output did not contain JSON.');
  return appBlueprintSchema.parse(JSON.parse(candidate));
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

function buildBlueprintSystemPrompt(skillContext: string): string {
  return [
    '[SystemContext]',
    'あなたは AppBlueprint JSON を生成する設計エージェントです。',
    'ユーザーの依頼をもとに、実装前に確認できる画面構成、主要セクション、データモデル、binding、実装タスクを作ってください。',
    '',
    '[Output Contract]',
    'finalResponse に AppBlueprint JSON だけを入れてください。markdown、説明文、コードフェンスは不要です。',
    'JSON は shared/schemas/app-blueprint.schema.ts の AppBlueprint に従ってください。',
    '',
    '[Schema Rules]',
    '- id、screen/section/action/binding/task/hook id、table/column/relation 名は ^[a-z][a-z0-9-]*$ に合わせる。',
    '- screens は最低1件。screen は id/name/path/componentName/sections/actions を持つ。',
    '- componentName は blueprint-catalog.schema.ts の enum から選ぶ。',
    '- ECトップページなら SplitHeroSection、CarouselSection、CardGridSection、MainSearchNavigationSection、CheckoutSummarySection、QuickActionsSection などを目的に応じて使う。',
    '- dataBindingId は dataBindings[].id と一致させる。',
    '- dataBindings[].table は databaseSchema.tables[].name と一致させる。',
    '- dataBindings[].fields/sort は対象 table の columns[].name だけを使う。',
    '- implementationTasks[].affectedDomains は blueprint-ui、blueprint-data、blueprint-binding、blueprints、blueprint-task-planning などから選ぶ。',
    '',
    '[Skill Context]',
    skillContext,
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
