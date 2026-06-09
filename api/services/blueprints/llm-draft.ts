import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  blueprintPreviewComponentCatalog,
  blueprintSectionPresetCatalog,
} from '../../../shared/blueprint-composition-catalog';
import {
  type AppBlueprint,
  appBlueprintSchema,
} from '../../../shared/schemas/app-blueprint.schema';
import type { BlueprintDataSourceKind } from '../../../shared/schemas/blueprint-catalog.schema';
import {
  blueprintCatalog,
  getBlueprintComponentDefinition,
  isAllowedBlueprintSource,
} from '../blueprint-catalog';
import { defaultDesignPreset } from '../design-governance';
import { callStructuredJsonLLM, type SupervisorLlmDebugEvent } from '../supervisor/llm-provider';
import {
  type JsonFixWrapperResult,
  jsonFixWrapper,
  parseRepairedJsonWithSchema,
} from '../supervisor/llm-provider/json';
import {
  renderSupervisorReferenceDocuments,
  resolveSupervisorReferenceDocuments,
  summarizeSupervisorReferenceDocuments,
} from '../supervisor/skills/registry';
import type { SupervisorRoutingHypothesis } from '../supervisor/skills/types';
import { validateAppBlueprint } from './validation';

type BlueprintReferenceDocumentsSummary = ReturnType<typeof summarizeSupervisorReferenceDocuments>;

export type BlueprintPromptDiagnostics = {
  schemaIncluded: boolean;
  schemaDigest: string;
  schemaBytes: number;
  catalogComponentCount: number;
  referenceDocumentCount: number;
  referenceDocuments: BlueprintReferenceDocumentsSummary;
};

export type GeneratedBlueprintDraft = {
  blueprint: AppBlueprint;
  validation: ReturnType<typeof validateAppBlueprint>;
  generation: {
    source: 'llm';
    degradedReasons: string[];
    rawOutput?: string;
    jsonRepair?: BlueprintJsonRepairDiagnostics;
    referenceDocuments: BlueprintReferenceDocumentsSummary;
    promptDiagnostics: BlueprintPromptDiagnostics;
  };
};

export type BlueprintJsonRepairDiagnostics = {
  repaired: boolean;
  repairKind: JsonFixWrapperResult['repairKind'];
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
  const referenceDocuments = resolveSupervisorReferenceDocuments(
    input.routing || blueprintRoutingFallback
  );
  const referenceDocumentSummary = summarizeSupervisorReferenceDocuments(referenceDocuments);
  const appBlueprintJsonSchema = renderAppBlueprintJsonSchema();
  const promptDiagnostics = buildPromptDiagnostics(
    appBlueprintJsonSchema,
    referenceDocumentSummary
  );
  const rawOutput = await callStructuredJsonLLM(
    buildBlueprintSystemPrompt({
      referenceContext: renderSupervisorReferenceDocuments(referenceDocuments),
      appBlueprintJsonSchema,
    }),
    buildBlueprintUserPrompt(input),
    {
      schemaName: 'app_blueprint',
      schema: z.toJSONSchema(appBlueprintSchema),
      emitEvent: input.emitEvent,
      taskId: input.taskId,
      runId: null,
    }
  );

  try {
    const { blueprint, validation, jsonRepair } = parseAndValidateBlueprintOutput(rawOutput);
    return {
      blueprint,
      validation,
      generation: {
        source: 'llm',
        degradedReasons: [],
        rawOutput,
        jsonRepair,
        referenceDocuments: referenceDocumentSummary,
        promptDiagnostics,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BlueprintDraftGenerationError(message, { rawOutput, promptDiagnostics });
  }
}

export function parseAndValidateBlueprintOutput(rawOutput: string): {
  blueprint: AppBlueprint;
  validation: ReturnType<typeof validateAppBlueprint>;
  jsonRepair: BlueprintJsonRepairDiagnostics;
} {
  const parsed = parseBlueprintJsonOutput(rawOutput);
  if (!parsed.ok) throw new Error('Blueprint LLM output did not contain valid JSON.');
  const blueprint = normalizeRegularBlueprintBindings(parsed.value);
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
    jsonRepair: { repaired: parsed.repaired, repairKind: parsed.repairKind },
  };
}

function parseBlueprintJsonOutput(rawOutput: string) {
  const parsed = parseRepairedJsonWithSchema(rawOutput, appBlueprintSchema);
  if (parsed.ok) return parsed;

  const normalized = parseNormalizedBlueprintCandidate(rawOutput);
  if (normalized) return normalized;

  const repairedRootActions = repairMisplacedRootActions(rawOutput);
  if (!repairedRootActions) return parsed;
  const normalizedRepairedRootActions = parseNormalizedBlueprintCandidate(repairedRootActions);
  if (normalizedRepairedRootActions) return normalizedRepairedRootActions;
  const repaired = parseRepairedJsonWithSchema(repairedRootActions, appBlueprintSchema);
  if (!repaired.ok) return repaired;
  return {
    ...repaired,
    repaired: true,
    repairKind: repaired.repaired ? 'extracted_and_balanced_json' : 'balanced_json',
  } as const;
}

function parseNormalizedBlueprintCandidate(rawOutput: string) {
  const jsonFix = jsonFixWrapper(rawOutput);
  if (!jsonFix) return null;
  const normalized = normalizeBlueprintCandidate(jsonFix.parsedJson);
  const parsed = appBlueprintSchema.safeParse(normalized);
  if (!parsed.success) return null;
  return {
    ok: true,
    value: parsed.data,
    sourceText: jsonFix.sourceText,
    repaired: true,
    repairKind: jsonFix.repaired ? 'extracted_and_balanced_json' : 'balanced_json',
  } as const;
}

function repairMisplacedRootActions(rawOutput: string): string | null {
  const candidate = extractBlueprintJsonCandidate(rawOutput);
  if (!candidate) return null;
  const databaseMarker = ',"databaseSchema"';
  const databaseIndex = candidate.indexOf(databaseMarker);
  if (databaseIndex < 0) return null;

  const prefix = candidate.slice(0, databaseIndex);
  const misplacedActionsIndex = prefix.lastIndexOf('],"actions":[');
  if (misplacedActionsIndex < 0) return null;

  const keepScreensCloseIndex = misplacedActionsIndex + 1;
  return `${prefix.slice(0, keepScreensCloseIndex)}${candidate.slice(databaseIndex)}`;
}

function normalizeBlueprintCandidate(candidate: unknown): unknown {
  const unwrappedCandidate = unwrapDelimitedBlueprintArrayCandidate(candidate);
  if (
    !unwrappedCandidate ||
    typeof unwrappedCandidate !== 'object' ||
    Array.isArray(unwrappedCandidate)
  ) {
    return unwrappedCandidate;
  }
  const blueprint = { ...(unwrappedCandidate as Record<string, unknown>) };
  delete blueprint.actions;
  if (!Array.isArray(blueprint.screens)) return blueprint;
  blueprint.screens = blueprint.screens.map((screen, screenIndex) => {
    if (!screen || typeof screen !== 'object' || Array.isArray(screen)) return screen;
    const screenRecord = { ...(screen as Record<string, unknown>) };
    const screenScope = stableBlueprintId(screenRecord.id, `screen-${screenIndex + 1}`);
    screenRecord.actions = normalizeBlueprintActions(screenRecord.actions, screenScope);
    if (Array.isArray(screenRecord.sections)) {
      screenRecord.sections = screenRecord.sections.map((section, sectionIndex) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
        const sectionRecord = { ...(section as Record<string, unknown>) };
        const sectionScope = stableBlueprintId(
          sectionRecord.id,
          `${screenScope}-section-${sectionIndex + 1}`
        );
        sectionRecord.actions = normalizeBlueprintActions(sectionRecord.actions, sectionScope);
        return sectionRecord;
      });
    }
    return screenRecord;
  });
  return blueprint;
}

function unwrapDelimitedBlueprintArrayCandidate(candidate: unknown): unknown {
  if (!Array.isArray(candidate)) return candidate;
  if (candidate.length === 1) return candidate[0];
  const [head, ...tail] = candidate;
  if (!head || typeof head !== 'object' || Array.isArray(head)) return candidate;

  const blueprint = { ...(head as Record<string, unknown>) };
  for (let index = 0; index < tail.length; index += 1) {
    const key = tail[index];
    if (typeof key !== 'string' || !isAppBlueprintRootKey(key)) continue;
    if (tail[index + 1] === ':' && index + 2 < tail.length) {
      blueprint[key] = tail[index + 2];
      index += 2;
    } else if (index + 1 < tail.length) {
      blueprint[key] = tail[index + 1];
      index += 1;
    }
  }
  return blueprint;
}

function isAppBlueprintRootKey(key: string): key is keyof AppBlueprint {
  return (
    key === 'databaseSchema' ||
    key === 'dataBindings' ||
    key === 'implementationTasks' ||
    key === 'learningHooks'
  );
}

function normalizeBlueprintActions(actions: unknown, scope: string): unknown {
  if (!Array.isArray(actions)) return actions;
  return actions.map((action, actionIndex) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) return action;
    const actionRecord = { ...(action as Record<string, unknown>) };
    if (typeof actionRecord.id !== 'string' || actionRecord.id.trim().length === 0) {
      actionRecord.id = `${scope}-action-${actionIndex + 1}`;
    }
    return actionRecord;
  });
}

function stableBlueprintId(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value : fallback;
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (/^[a-z][a-z0-9-]*$/.test(normalized)) return normalized;
  return `item-${fallback}`.replace(/[^a-z0-9-]+/g, '-');
}

function extractBlueprintJsonCandidate(rawOutput: string): string | null {
  const direct = rawOutput.trim();
  if (direct.startsWith('{') && direct.endsWith('}')) return direct;
  const fenced =
    rawOutput.match(/```json\s*([\s\S]*?)\s*```/i) || rawOutput.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = rawOutput.indexOf('{');
  const last = rawOutput.lastIndexOf('}');
  if (first >= 0 && last > first) return rawOutput.slice(first, last + 1).trim();
  return null;
}

function normalizeRegularBlueprintBindings(blueprint: AppBlueprint): AppBlueprint {
  if (blueprint.dataBindings.length > 0) return blueprint;
  return {
    ...blueprint,
    screens: blueprint.screens.map((screen) => ({
      ...screen,
      componentName: pickRegularBlueprintPageComponent(screen.componentName),
      sections: screen.sections.map((section) => {
        if (section.kind === 'preset_section' || section.kind === 'custom_section') return section;
        const sectionWithoutBinding = { ...section };
        delete sectionWithoutBinding.dataBindingId;
        if (!isBlueprintPlacement(sectionWithoutBinding.componentName, 'section')) {
          sectionWithoutBinding.componentName = 'EmptyState';
        }
        if (
          !isAllowedBlueprintSource(
            sectionWithoutBinding.componentName,
            sectionWithoutBinding.source
          )
        ) {
          sectionWithoutBinding.source = pickRegularBlueprintSource(
            sectionWithoutBinding.componentName
          );
        }
        return sectionWithoutBinding;
      }),
    })),
  };
}

function pickRegularBlueprintPageComponent(
  componentName: string
): AppBlueprint['screens'][number]['componentName'] {
  if (isBlueprintPlacement(componentName, 'page')) {
    return componentName as AppBlueprint['screens'][number]['componentName'];
  }
  return 'SidebarPage';
}

function isBlueprintPlacement(
  componentName: string,
  placement: NonNullable<ReturnType<typeof getBlueprintComponentDefinition>>['placement']
): boolean {
  return getBlueprintComponentDefinition(componentName)?.placement === placement;
}

function pickRegularBlueprintSource(componentName: string): BlueprintDataSourceKind {
  const definition = getBlueprintComponentDefinition(componentName);
  const preferredSources = [
    'static',
    'computed',
    'app',
    'summary',
    'none',
    'markdown',
    'navigation',
    'api',
    'table',
    'record',
    'postgres',
  ] as const;
  return preferredSources.find((source) => definition?.allowedSources.includes(source)) || 'app';
}

const blueprintRoutingFallback: SupervisorRoutingHypothesis = {
  primaryMode: 'planning',
  secondaryModes: ['review'],
  phase: 'plan',
  workKinds: ['blueprint', 'ui_ux'],
  overlays: ['user_facing_change'],
  subtype: 'app_blueprint',
  requiredEvidence: ['latest user request'],
  nextReferenceFiles: ['references/work_kinds/blueprint.md'],
  confidence: 0.7,
};

function buildBlueprintSystemPrompt(input: {
  referenceContext: string;
  appBlueprintJsonSchema: string;
}): string {
  return [
    '[SystemContext]',
    'あなたは AppBlueprint JSON を生成する画面デザインエージェントです。',
    'ユーザーの依頼をもとに、実装前に確認できる高品質な画面構成、主要セクション、見た目の意図、サンプル表示内容、実装タスクを作ってください。',
    '',
    '[Output Contract]',
    'AppBlueprint JSON だけを返してください。markdown、説明文、コードフェンスは不要です。',
    'JSON は下の [AppBlueprint JSON Schema] に厳密に従ってください。',
    '',
    '[Schema Rules]',
    '- id、screen/section/action/binding/task/hook id、table/column/relation 名は ^[a-z][a-z0-9-]*$ に合わせる。',
    '- screens は最低1件。screen は id/name/path/componentName/sections/actions を持つ。',
    '- componentName は blueprint-catalog.schema.ts の enum から選ぶ。',
    `- designPreset はこの既知presetをそのまま使う: ${JSON.stringify(defaultDesignPreset)}。`,
    '- componentName/source は下の Catalog の組み合わせだけを使う。未掲載のcomponent/source/themeを作らない。',
    '- section は従来の componentName section に加えて、必要に応じて kind:"preset_section" または kind:"custom_section" を使ってよい。',
    '- preset_section は preset に search_header / table_workspace / metrics_overview / chart_insight / kanban_board のいずれかを選び、props と overrides で内部 node/slot を局所調整する。',
    '- custom_section は preset で表現できない場合だけ使い、root の BlueprintNode tree は既知 component catalog と layout token だけで構成する。任意 HTML、className、CSS は作らない。',
    '- 画面名、セクション名、コンポーネント選択、余白感、情報密度、サンプル表示内容は、ユーザー依頼の業務・ユーザー・利用シーンに合わせて自律的に決める。',
    '- section は「必要なものだけ」を選ぶ。見栄えのための hero、画像、KPI、chart、activity、marketing section は入れない。',
    '- workflow / CRUD / kanban / admin などの作業画面では、見た目の優先度だけでなく、実際の操作順序、使用感、作業前に必要な入力、画面上の視線移動を考えて section と props を決める。',
    '- Kanban なら KanbanSection を主役にし、検索・フィルタ・表示切替は KanbanSection.props.filters / views / segments としてボード上部の toolbar に出す。ボードを操作する前に使う controls をボード下に置かない。',
    '- KanbanSection の props は Backlog / In Progress / Done 相当の3列 columns: [{id,title,cards:[{id,title,description,assignee,priority,dueDate}]}] を基本形にする。各 column には、画面イメージを確認できる sample card を最低1件入れる。boardLabel、boardDescription、filters を必要に応じて入れる。ボード、列、カード、検索、フィルタの確認が目的なら DataTableSection を使わない。',
    '- Kanban では QuickActionsSection、EmptyState、FormSection、DataTableSection を自動追加しない。ユーザーが明示的に「新規作成導線」「空状態」「編集フォーム」「表形式一覧」を求めた場合だけ使う。',
    '- SplitHeroSection、ImageSection、CarouselSection は landing page、marketing page、media-heavy page、またはユーザーが明示的に hero / visual / campaign を求めた場合だけ使う。',
    '- ChartSection、ChartInsightSection、KpiSummarySection、StatsTrendCardsSection、ProgressListSection は、ユーザーが metrics / KPI / analytics / dashboard / trend / chart を明示した場合だけ使う。Kanban、フォーム、CRUD、一覧管理の初期画面に自動追加しない。',
    '- ユーザー回答で「最小構成」「シンプル」「基本操作」「画面だけ」と判断された場合は、screen あたり 1-3 section を基本にし、中心操作に直結しない section は削る。',
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
    '[Preview Component Catalog]',
    renderPreviewComponentCatalogPrompt(),
    '',
    '[Section Preset Catalog]',
    renderSectionPresetCatalogPrompt(),
    '',
    '[AppBlueprint JSON Schema]',
    input.appBlueprintJsonSchema,
    '',
    '[Procedure Reference Context]',
    input.referenceContext,
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

function renderPreviewComponentCatalogPrompt(): string {
  return blueprintPreviewComponentCatalog
    .map((definition) =>
      [
        definition.name,
        `category=${definition.category}`,
        `children=${definition.allowedChildren?.join('|') || '-'}`,
      ].join(' ')
    )
    .join('\n');
}

function renderSectionPresetCatalogPrompt(): string {
  return blueprintSectionPresetCatalog
    .map((preset) =>
      [
        preset.name,
        `legacy=${preset.legacyComponents.join('|') || '-'}`,
        `slots=${preset.slots
          .map((slot) => `${slot.name}:${slot.cardinality}:${slot.accepts.join('|')}`)
          .join(',')}`,
      ].join(' ')
    )
    .join('\n');
}

function renderAppBlueprintJsonSchema(): string {
  return JSON.stringify(z.toJSONSchema(appBlueprintSchema), null, 2);
}

function buildPromptDiagnostics(
  schema: string,
  referenceDocuments: BlueprintReferenceDocumentsSummary
): BlueprintPromptDiagnostics {
  return {
    schemaIncluded: true,
    schemaDigest: createHash('sha256').update(schema).digest('hex'),
    schemaBytes: Buffer.byteLength(schema, 'utf8'),
    catalogComponentCount: blueprintCatalog.length,
    referenceDocumentCount: referenceDocuments.length,
    referenceDocuments,
  };
}
