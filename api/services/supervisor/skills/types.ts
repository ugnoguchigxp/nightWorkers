export const supervisorPhases = [
  'answer',
  'analyze',
  'plan',
  'execute',
  'review',
  'investigate',
  'verify',
  'summarize',
] as const;

export const supervisorModes = [
  'general_answer',
  'planning',
  'code_edit',
  'review',
  'investigation',
  'runtime_debug',
  'test_and_verification',
  'research',
  'docs',
  'git_release',
] as const;

export const supervisorWorkKinds = [
  'code',
  'refactor',
  'test',
  'docs',
  'config',
  'dependency',
  'data_migration',
  'blueprint',
  'ui_ux',
  'git',
  'release',
  'research',
] as const;

export const supervisorOverlays = [
  'evidence',
  'security',
  'performance',
  'incident',
  'destructive_operation',
  'production_risk',
  'user_facing_change',
  'external_research_required',
] as const;

export type SupervisorPhase = (typeof supervisorPhases)[number];
export type SupervisorMode = (typeof supervisorModes)[number];
export type SupervisorWorkKind = (typeof supervisorWorkKinds)[number];
export type SupervisorOverlay = (typeof supervisorOverlays)[number];

export type SupervisorRoutingHypothesis = {
  primaryMode: SupervisorMode;
  secondaryModes: SupervisorMode[];
  phase: SupervisorPhase;
  workKinds: SupervisorWorkKind[];
  overlays: SupervisorOverlay[];
  subtype?: string;
  requiredEvidence: string[];
  nextSkillFiles: string[];
  confidence: number;
};

export type SupervisorSkillSectionName =
  | 'Use When'
  | 'Required Behavior'
  | 'Stop Conditions'
  | 'Report Contract'
  | 'Tool Guidance'
  | 'Verification Guidance'
  | 'Risk Notes';

export type SupervisorSkillDocumentKind =
  | 'root'
  | 'router'
  | 'phase'
  | 'mode'
  | 'work_kind'
  | 'overlay';

export type SupervisorSkillDocument = {
  id: string;
  kind: SupervisorSkillDocumentKind;
  title: string;
  version: 1;
  source: 'builtin' | 'configured';
  relativePath: string;
  digest: string;
  sections: Partial<Record<SupervisorSkillSectionName, string>>;
};

export const defaultSupervisorRoutingHypothesis: SupervisorRoutingHypothesis = {
  primaryMode: 'general_answer',
  secondaryModes: [],
  phase: 'answer',
  workKinds: [],
  overlays: [],
  requiredEvidence: [],
  nextSkillFiles: ['SKILL.md', 'references/modes/general_answer.md'],
  confidence: 0.5,
};
