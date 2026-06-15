import type {
  DesignDecisionReview,
  DesignQuestionnaire,
} from '../../../../shared/schemas/design-questionnaire.schema';

export type TaskType =
  | 'code_change'
  | 'test_change'
  | 'documentation'
  | 'review'
  | 'investigation'
  | 'verification'
  | string;

export type TodoStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'needs_human';

export type TaskRunTodo = {
  id: string;
  runId: string;
  seq: number;
  title: string;
  description?: string | null;
  taskType: TaskType;
  status: TodoStatus;
  procedureId?: string | null;
  procedureSnapshot?: unknown | null;
  contextSnapshot?: unknown | null;
  completionGateResult?: unknown | null;
  dependsOn?: Array<string | number> | null;
  statusReason?: string | null;
  startedAt?: unknown | null;
  completedAt?: unknown | null;
  createdAt: unknown;
  updatedAt: unknown;
};

export type TaskMessage = {
  id: string;
  taskId: string;
  runId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  messageType?: 'text' | 'chart' | 'browser' | 'playwright' | 'flow' | 'markdown_document' | null;
  metadataJson?: unknown;
  createdAt: unknown;
};

export type DesignQuestionnaireAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  booleanValue?: boolean;
  freeText?: string;
  rankedOptionIds: string[];
  deferred: boolean;
};

export type DesignQuestionnaireSession = {
  id: string;
  taskId: string;
  repositoryId: string;
  sourceBlueprintMessageId: string | null;
  status: 'draft' | 'answering' | 'review_ready' | 'accepted' | 'needs_edit' | 'abandoned';
  createdAt: unknown;
  updatedAt: unknown;
  questionSets: Array<{
    id: string;
    sequence: number;
    questionnaire: DesignQuestionnaire | null;
    rawOutput: string | null;
    validationStatus: 'valid' | 'invalid';
    createdAt: unknown;
  }>;
  answers: Array<{
    id: string;
    questionId: string;
    answer: DesignQuestionnaireAnswer;
    answeredAt: unknown;
  }>;
  reviews: Array<{
    id: string;
    review: DesignDecisionReview | null;
    publishedMessageId?: string | null;
    status: 'draft' | 'accepted' | 'needs_edit' | 'left_unadopted';
    createdAt: unknown;
    updatedAt: unknown;
  }>;
};

export type BlueprintWorkspaceArtifact = {
  id: string;
  kind: 'blueprint' | 'db-design' | 'decision-review';
  title: string;
  sourceMessageId: string;
  createdAt: unknown;
  adoptionState?: 'adopted' | 'not_adopted' | 'unknown';
  sourceBlueprintMessageId?: string;
};

export type BlueprintSpecificationWorkspace = {
  taskId: string;
  repositoryId: string;
  generatedAt: string;
  blueprintArtifacts: BlueprintWorkspaceArtifact[];
  dbDesignArtifacts: BlueprintWorkspaceArtifact[];
  questionnaireSessions: Array<{
    id: string;
    sourceBlueprintMessageId: string | null;
    status: DesignQuestionnaireSession['status'];
    answeredCount: number;
    totalQuestionCount: number;
    latestReviewId?: string;
  }>;
  decisionReviews: BlueprintWorkspaceArtifact[];
  implementationReferences: Array<{
    id: string;
    kind: 'implementation-plan' | 'queue-candidate';
    title: string;
    sourceMessageId?: string;
    taskId: string;
  }>;
};
