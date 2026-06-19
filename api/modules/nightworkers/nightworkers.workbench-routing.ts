import type { NativeApiExecutionMode } from '../../services/agent-runtime/native-api-runner/native-api-mode';
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
  return immediateWorkbenchRunJobTypes.has(jobSelection.jobType);
}

const immediateWorkbenchRunJobTypes = new Set<JobType>([
  'minor_code_edit',
  'major_code_edit',
  'docs',
  'runtime_debug',
  'review',
  'investigation',
  'test_and_verification',
  'config',
  'refactor',
  'test',
  'dependency',
  'data_migration',
  'code',
  'git_release',
  'git',
  'release',
]);

export function executionModeForWorkbenchJobType(jobType: JobType): NativeApiExecutionMode {
  if (jobType === 'planning' || jobType === 'blueprint' || jobType === 'ui_ux') return 'planning';
  if (jobType === 'review') return 'review';
  if (jobType === 'runtime_debug') return 'runtime_debug';
  if (jobType === 'general_answer') return 'general_answer';
  return 'implementation';
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
  if (jobType === 'review') {
    return {
      primaryMode: 'review',
      secondaryModes: [],
      phase: 'review',
      workKinds: [],
      overlays: ['evidence'],
      requiredEvidence: ['git diff, changed files, or verification evidence'],
      nextReferenceFiles: ['references/modes/review.md'],
      confidence: 1,
    };
  }
  if (jobType === 'investigation') {
    return {
      primaryMode: 'investigation',
      secondaryModes: [],
      phase: 'investigate',
      workKinds: [],
      overlays: ['evidence'],
      requiredEvidence: ['repo inspection, logs, DB state, or command output'],
      nextReferenceFiles: ['references/modes/investigation.md'],
      confidence: 1,
    };
  }
  if (jobType === 'test_and_verification') {
    return {
      primaryMode: 'test_and_verification',
      secondaryModes: [],
      phase: 'verify',
      workKinds: ['test'],
      overlays: ['evidence'],
      requiredEvidence: ['verification command output'],
      nextReferenceFiles: ['references/modes/test_and_verification.md'],
      confidence: 1,
    };
  }
  if (jobType === 'docs') {
    return {
      primaryMode: 'docs',
      secondaryModes: [],
      phase: 'execute',
      workKinds: ['docs'],
      overlays: [],
      requiredEvidence: [],
      nextReferenceFiles: ['references/modes/docs.md', 'references/work_kinds/docs.md'],
      confidence: 1,
    };
  }
  if (jobType === 'git_release' || jobType === 'git' || jobType === 'release') {
    return {
      primaryMode: 'git_release',
      secondaryModes: [],
      phase: 'execute',
      workKinds: jobType === 'release' ? ['release'] : ['git'],
      overlays: ['evidence'],
      requiredEvidence: ['git status or release command output'],
      nextReferenceFiles: [
        'references/modes/git_release.md',
        jobType === 'release' ? 'references/work_kinds/release.md' : 'references/work_kinds/git.md',
      ],
      confidence: 1,
    };
  }
  if (
    jobType === 'code' ||
    jobType === 'refactor' ||
    jobType === 'test' ||
    jobType === 'config' ||
    jobType === 'dependency' ||
    jobType === 'data_migration'
  ) {
    return {
      primaryMode: 'code_edit',
      secondaryModes: jobType === 'test' ? ['test_and_verification'] : [],
      phase: 'execute',
      workKinds: [jobType === 'code' ? 'code' : jobType],
      overlays: jobType === 'data_migration' ? ['production_risk'] : [],
      requiredEvidence: [],
      nextReferenceFiles: [
        'references/modes/code_edit.md',
        `references/work_kinds/${jobType === 'code' ? 'code' : jobType}.md`,
      ],
      confidence: 1,
    };
  }
  return {
    primaryMode: jobType === 'general_answer' ? 'general_answer' : 'investigation',
    secondaryModes: [],
    phase: jobType === 'general_answer' ? 'answer' : 'investigate',
    workKinds: [],
    overlays: jobType === 'general_answer' ? [] : ['evidence'],
    requiredEvidence: [],
    nextReferenceFiles:
      jobType === 'general_answer'
        ? ['references/modes/general_answer.md']
        : ['references/modes/investigation.md'],
    confidence: 1,
  };
}
