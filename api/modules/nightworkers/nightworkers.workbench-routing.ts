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
