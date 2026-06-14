import { createHash } from 'node:crypto';
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
import { buildBlueprintSystemPrompt } from '../structured-generation/prompts/app-blueprint';
import { callStructuredJsonLLM, type SupervisorLlmDebugEvent } from '../structured-llm';
import {
  type JsonFixWrapperResult,
  jsonFixWrapper,
  parseRepairedJsonWithSchema,
} from '../structured-llm/json';
import {
  renderSupervisorReferenceDocuments,
  resolveSupervisorReferenceDocuments,
  summarizeSupervisorReferenceDocuments,
} from '../supervisor/skills/registry';
import type { SupervisorRoutingHypothesis } from '../supervisor/skills/types';
import {
  buildAppBlueprintStructuredOutputJsonSchema,
  renderAppBlueprintJsonSchema,
} from './json-schema';
import { validateAppBlueprint } from './validation';

type BlueprintReferenceDocumentsSummary = ReturnType<typeof summarizeSupervisorReferenceDocuments>;

export type PlanModeBlueprintRequestContract = {
  schemaName: 'app_blueprint';
  requiredArtifact: 'AppBlueprint JSON';
  regularBlueprintDataContract: {
    databaseSchema: { tables: []; relations: [] };
    dataBindings: [];
    sectionDataBindingId: 'forbidden';
    dbDesignWorkflowOnly: true;
  };
  referenceDocuments: BlueprintReferenceDocumentsSummary;
  userRequest: {
    taskId: string;
    title: string;
    userRequest: string;
    routingHypothesis: SupervisorRoutingHypothesis | null;
    requiredArtifact: 'AppBlueprint JSON';
  };
};

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
  const requestContract = buildPlanModeBlueprintRequestContract(input, referenceDocumentSummary);
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
    JSON.stringify(requestContract.userRequest, null, 2),
    {
      schemaName: requestContract.schemaName,
      schema: buildAppBlueprintStructuredOutputJsonSchema(),
      emitEvent: input.emitEvent,
      taskId: input.taskId,
      runId: null,
      role: 'plan',
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

export function buildPlanModeBlueprintRequestContract(
  input: {
    taskId: string;
    title: string;
    prompt: string;
    routing?: SupervisorRoutingHypothesis;
  },
  referenceDocuments: BlueprintReferenceDocumentsSummary = summarizeSupervisorReferenceDocuments(
    resolveSupervisorReferenceDocuments(input.routing || blueprintRoutingFallback)
  )
): PlanModeBlueprintRequestContract {
  return {
    schemaName: 'app_blueprint',
    requiredArtifact: 'AppBlueprint JSON',
    regularBlueprintDataContract: {
      databaseSchema: { tables: [], relations: [] },
      dataBindings: [],
      sectionDataBindingId: 'forbidden',
      dbDesignWorkflowOnly: true,
    },
    referenceDocuments,
    userRequest: {
      taskId: input.taskId,
      title: input.title,
      userRequest: input.prompt,
      routingHypothesis: input.routing || null,
      requiredArtifact: 'AppBlueprint JSON',
    },
  };
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
