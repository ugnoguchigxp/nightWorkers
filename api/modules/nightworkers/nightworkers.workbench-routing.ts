import type { JobType } from '../../services/supervisor/prompt';
import type { JobTypeSelection } from '../../services/supervisor/schema-first';
import type { SupervisorRoutingHypothesis } from '../../services/supervisor/skills/types';

export type WorkbenchArtifactContext = {
  artifactId: string;
  kind: string;
  title: string;
  summary?: string;
  source?: { type?: string; messageId?: string; artifactId?: string; runId?: string };
  metadata?: {
    intent?: string;
    appBlueprintName?: string;
    artifactType?: string;
    screenNames?: string[];
    sectionNames?: string[];
    tableNames?: string[];
    initialTab?: string;
    blueprintCount?: number;
    source?: string;
    dbDesignTarget?: unknown;
  };
};

export type WorkbenchChatIntent =
  | 'intake'
  | 'draft'
  | 'draft_spec'
  | 'create_task'
  | 'queue'
  | 'run_task'
  | 'adjust_running'
  | 'review_followup'
  | 'learning_capture'
  | 'design_component'
  | 'design_blueprint_data';

export function renderLlmIntakeContent(jobSelection: JobTypeSelection): string {
  return [`jobType: ${jobSelection.jobType}`, jobSelection.goal]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}

export function shouldStartImmediateWorkbenchRun(
  jobSelection: JobTypeSelection,
  intent: WorkbenchChatIntent
) {
  if (intent !== 'intake') return false;
  return (
    jobSelection.jobType === 'minor_code_edit' ||
    jobSelection.jobType === 'major_code_edit' ||
    jobSelection.jobType === 'docs' ||
    jobSelection.jobType === 'runtime_debug'
  );
}

export function resolveArtifactFocusedJobSelection(
  artifactContext: WorkbenchArtifactContext | null,
  prompt: string
): JobTypeSelection | null {
  if (!artifactContext || !isAppBlueprintArtifactFocus(artifactContext)) return null;
  return {
    jobType: 'blueprint',
    goal:
      prompt.replace(/\s+/g, ' ').trim().slice(0, 160) || '現在の Blueprint artifact を更新する',
  };
}

function isAppBlueprintArtifactFocus(artifactContext: WorkbenchArtifactContext): boolean {
  const metadata = artifactContext.metadata || {};
  if (
    metadata.artifactType === 'blueprint_db_design' ||
    metadata.source === 'blueprint-db-design' ||
    metadata.dbDesignTarget
  ) {
    return false;
  }
  if (metadata.intent === 'app_blueprint') return true;
  if (metadata.artifactType === 'app_blueprint') return true;
  if (artifactContext.kind === 'app_blueprint') return true;
  if (artifactContext.kind !== 'blueprint_workspace') return false;
  return (
    metadata.initialTab === 'questionnaire' ||
    metadata.initialTab === 'blueprints' ||
    Boolean(metadata.blueprintCount && metadata.blueprintCount > 0)
  );
}

export function routingForArtifactFocusedJobSelection(
  jobSelection: JobTypeSelection
): SupervisorRoutingHypothesis {
  if (jobSelection.jobType === 'blueprint') return routingForWorkbenchJobType('blueprint');
  return routingForWorkbenchJobType(jobSelection.jobType);
}

export function buildAcceptanceCriteriaFromDecision(jobSelection: JobTypeSelection): string {
  return jobSelection.goal.trim();
}

export function routingForWorkbenchJobType(jobType: JobType): SupervisorRoutingHypothesis {
  if (jobType === 'minor_code_edit') {
    return {
      primaryMode: 'code_edit',
      secondaryModes: [],
      phase: 'execute',
      workKinds: ['code'],
      overlays: [],
      requiredEvidence: [],
      nextReferenceFiles: [],
      confidence: 1,
    };
  }
  if (jobType === 'major_code_edit') {
    return {
      primaryMode: 'code_edit',
      secondaryModes: ['planning', 'test_and_verification'],
      phase: 'plan',
      workKinds: ['code'],
      overlays: ['user_facing_change'],
      requiredEvidence: [],
      nextReferenceFiles: ['references/work_kinds/code.md', 'references/phases/plan.md'],
      confidence: 1,
    };
  }
  if (jobType === 'blueprint' || jobType === 'ui_ux') {
    return {
      primaryMode: 'planning',
      secondaryModes: [],
      phase: 'plan',
      workKinds: ['blueprint', 'ui_ux'],
      overlays: ['user_facing_change'],
      subtype: 'app_blueprint',
      requiredEvidence: [],
      nextReferenceFiles: ['references/work_kinds/blueprint.md'],
      confidence: 1,
    };
  }
  if (jobType === 'planning') {
    return {
      primaryMode: 'planning',
      secondaryModes: [],
      phase: 'plan',
      workKinds: [],
      overlays: [],
      subtype: 'design_questionnaire',
      requiredEvidence: [],
      nextReferenceFiles: [],
      confidence: 1,
    };
  }
  if (jobType === 'runtime_debug') {
    return {
      primaryMode: 'runtime_debug',
      secondaryModes: ['investigation', 'test_and_verification'],
      phase: 'investigate',
      workKinds: [],
      overlays: ['evidence'],
      requiredEvidence: ['runtime logs or command output'],
      nextReferenceFiles: ['references/modes/runtime_debug.md'],
      confidence: 1,
    };
  }
  return {
    primaryMode: jobType === 'general_answer' ? 'general_answer' : 'planning',
    secondaryModes: [],
    phase: jobType === 'general_answer' ? 'answer' : 'plan',
    workKinds: [],
    overlays: [],
    requiredEvidence: [],
    nextReferenceFiles: [],
    confidence: 1,
  };
}
