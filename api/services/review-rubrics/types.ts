import type {
	ReviewEvidenceRef,
	ReviewFinding,
	ReviewFindingSeverity,
	ReviewResult,
	ReviewVerdict,
} from "../review-results/types";
import type {
	ParsedRunJsonl,
	ReplayResult,
	RunEventBase,
} from "../run-events/types";

export type RubricSource = "builtin" | "repository" | "inline";
export type RubricEvaluationMode = "deterministic" | "llm";
export type ReviewerEvaluationMode = "deterministic_only" | "llm_assisted";
export type ReviewerEvaluationStatus = "completed" | "degraded" | "failed";

export type RubricEvidenceSelector =
	| { kind: "run_event_type"; type: string }
	| { kind: "verification"; required?: boolean; passed?: boolean }
	| { kind: "diff"; required?: boolean; maxBytes?: number }
	| { kind: "policy"; allowViolations?: boolean }
	| { kind: "review_result"; required?: boolean }
	| { kind: "review_followup"; requiredForBlocking?: boolean }
	| { kind: "review_callout_separation" }
	| { kind: "final_report"; required?: boolean }
	| { kind: "tool_failure"; maxConsecutive?: number };

export type RubricCriterion = {
	id: string;
	title: string;
	severity: ReviewFindingSeverity;
	evaluationMode: RubricEvaluationMode;
	evidenceSelectors: RubricEvidenceSelector[];
	rule?: {
		required: boolean;
		failWhenMissing?: boolean;
		failWhenPresent?: boolean;
	};
	llmPrompt?: string;
};

export type RubricDefinition = {
	version: 1;
	id: string;
	title: string;
	description?: string;
	scope: {
		repositoryIds?: string[];
		paths?: string[];
		taskKinds?: string[];
	};
	criteria: RubricCriterion[];
	llm?: {
		enabledByDefault: boolean;
		promptHints?: string[];
		maxEvidenceChars: number;
	};
};

export type LoadedRubric = {
	rubric: RubricDefinition;
	source: RubricSource;
	digest: string;
	criteriaCount: number;
};

export type ReviewEvidencePack = {
	version: 1;
	runId: string;
	taskId: string;
	status: string;
	context?: {
		executionMode?: string;
		inRunReview?: boolean;
	};
	outcome?: {
		status: string;
		reason?: string;
		summary?: string;
	};
	finalReport?: string;
	diff: {
		hasChanges: boolean;
		bytes: number;
		changedFiles: string[];
	};
	verification: Array<{
		eventId?: string;
		command?: string;
		passed?: boolean;
		summary?: string;
	}>;
	policy: Array<{
		eventId?: string;
		code?: string;
		message: string;
	}>;
	reviewResults: unknown[];
	selectedEvents: Array<{
		id?: string;
		seq?: number;
		type: string;
		severity: string;
		message: string;
	}>;
	eventTypes: string[];
	diagnostics: string[];
};

export type DeterministicReviewEvaluation = {
	verdict: ReviewVerdict;
	findings: ReviewFinding[];
	degradedReasons: string[];
	evidenceRefs: ReviewEvidenceRef[];
	criterionResults: Array<{
		criterionId: string;
		passed: boolean;
		evidenceRefs: ReviewEvidenceRef[];
		message: string;
	}>;
};

export type ReviewerDraft = {
	version: 1;
	verdict: ReviewVerdict;
	summary: string;
	findings: ReviewFinding[];
	humanCallouts: ReviewFinding[];
	agentFollowUps: string[];
	suggestedNextTasks: string[];
};

export type FirewallResult = {
	status: ReviewerEvaluationStatus;
	draft?: ReviewerDraft;
	findings: ReviewFinding[];
	degradedReasons: string[];
	errorCode?: string;
	outputDigest?: string;
};

export type LlmReviewerResult = {
	status: ReviewerEvaluationStatus;
	draft?: ReviewerDraft;
	rawOutput?: unknown;
	provider: string;
	model?: string;
	promptDigest: string;
	evidencePackDigest: string;
	outputDigest?: string;
	degradedReasons: string[];
	errorCode?: string;
};

export type ReviewerEvaluation = {
	evaluationId: string;
	rubricId: string;
	status: ReviewerEvaluationStatus;
	mode: ReviewerEvaluationMode | "replay";
	deterministicVerdict: ReviewVerdict;
	llmVerdict?: ReviewVerdict;
	finalReviewerVerdict: ReviewVerdict;
	reviewResult: ReviewResult;
	blockingFindingCount: number;
	degradedReasons: string[];
	evidencePack: ReviewEvidencePack;
	events: RunEventBase[];
	llm?: LlmReviewerResult;
};

export type RunReviewReplayEvaluationInput = {
	parsedJsonl?: ParsedRunJsonl;
	replayResult?: ReplayResult;
	rubricId: string;
	mode: ReviewerEvaluationMode;
};
