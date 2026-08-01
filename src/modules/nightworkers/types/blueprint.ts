import type {
	DesignDecisionReview,
	DesignQuestionnaire,
} from "../../../../shared/schemas/design-questionnaire.schema";

export type TaskType =
	| "code_change"
	| "test_change"
	| "documentation"
	| "review"
	| "investigation"
	| "verification"
	| string;

export type TodoStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "skipped"
	| "needs_human";

export type TaskRunTodo = {
	id: string;
	runId: string;
	seq: number;
	title: string;
	description?: string | null;
	objective?: string | null;
	context?: string | null;
	nextAction: string;
	acceptanceCriteriaJson: string[];
	taskType: TaskType;
	status: TodoStatus;
	procedureId?: string | null;
	procedureSnapshot?: unknown | null;
	contextSnapshot?: unknown | null;
	completionGateResult?: unknown | null;
	dependsOn?: Array<string | number> | null;
	statusReason?: string | null;
	lastFailure?: string | null;
	attemptCount: number;
	systemContextVersion: number;
	systemContextSnapshot?: unknown | null;
	createdBy: "agent" | "human" | "migration";
	revision: number;
	startedAt?: unknown | null;
	completedAt?: unknown | null;
	createdAt: unknown;
	updatedAt: unknown;
};

export type TaskMessage = {
	id: string;
	taskId: string;
	runId?: string | null;
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	messageType?:
		| "text"
		| "chart"
		| "browser"
		| "playwright"
		| "flow"
		| "markdown_document"
		| "api_contract"
		| "zod_schema"
		| "mission_pilot_initial_prompt"
		| null;
	metadataJson?: unknown;
	traceOwner: import("../../../../shared/schemas/trace-provenance.schema").TraceOwner;
	traceChannel: import("../../../../shared/schemas/trace-provenance.schema").TraceChannel;
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
	status:
		| "draft"
		| "answering"
		| "review_ready"
		| "accepted"
		| "needs_edit"
		| "abandoned";
	createdAt: unknown;
	updatedAt: unknown;
	questionSets: Array<{
		id: string;
		sequence: number;
		questionnaire: DesignQuestionnaire | null;
		rawOutput: string | null;
		validationStatus: "valid" | "invalid";
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
		status: "draft" | "accepted" | "needs_edit" | "left_unadopted";
		createdAt: unknown;
		updatedAt: unknown;
	}>;
};

export type PlanModeWorkspaceArtifact = {
	id: string;
	kind:
		| "feature_plan"
		| "questionnaire"
		| "blueprint"
		| "data_model"
		| "user_flow"
		| "api_io_contract"
		| "activity_flow"
		| "sequence_flow"
		| "zod_schema_design"
		| "decision_review"
		| "implementation_reference";
	title: string;
	sourceMessageId: string;
	createdAt: unknown;
	adoptionState?: "adopted" | "not_adopted" | "unknown";
	sourceArtifactMessageId?: string;
	routingRevision?: number;
};

export type PlanModeViewDecision = {
	view: string;
	decision: "include" | "omit";
	reason?: string;
};

export type PlanModeRoutingSnapshot =
	import("../../../../shared/schemas/plan-mode-routing.schema").PlanModeRoutingSnapshot;

export type PlanModeWorkspace = {
	taskId: string;
	repositoryId: string;
	generatedAt: string;
	featurePlanArtifacts: PlanModeWorkspaceArtifact[];
	blueprintArtifacts: PlanModeWorkspaceArtifact[];
	dataModelArtifacts: PlanModeWorkspaceArtifact[];
	dedicatedViewArtifacts: PlanModeWorkspaceArtifact[];
	questionnaireSessions: Array<{
		id: string;
		sourceBlueprintMessageId: string | null;
		status: DesignQuestionnaireSession["status"];
		answeredCount: number;
		totalQuestionCount: number;
		unansweredCount?: number;
		blockingUnansweredCount?: number;
		nonBlockingUnansweredCount?: number;
		latestAdditionalQuestionSetId?: string;
		latestReviewId?: string;
	}>;
	decisionReviews: PlanModeWorkspaceArtifact[];
	implementationReferences: Array<{
		id: string;
		kind: "implementation_reference";
		title: string;
		sourceMessageId?: string;
		taskId: string;
	}>;
	viewDecisions: PlanModeViewDecision[];
	routing: PlanModeRoutingSnapshot;
};
