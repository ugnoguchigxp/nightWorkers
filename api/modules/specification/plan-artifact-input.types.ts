import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { ProjectStackProfile } from "../../../shared/schemas/tech-stack.schema";

export const PLAN_ARTIFACT_INPUT_PROJECTION_VERSION = 1 as const;

export type PlanArtifactGenerationTarget =
	| PlanModeRegenerationTarget
	| "plan_review";

export type AcceptedQuestionnaireDecision = {
	questionId: string;
	decisionKey: string | null;
	question: string;
	answer: string;
	why: string | null;
	outputSection: string | null;
	deferred: boolean;
};

export type BlockingQuestion = {
	id: string;
	decisionKey: string;
	question: string;
};

export type PlanArtifactSourceSelection = {
	previousTargetMessageId: string | null;
	featurePlanMessageId: string | null;
	blueprintMessageId: string | null;
	dataModelMessageId: string | null;
	dedicatedViewMessageIds: string[];
	policy: "orchestrated_step" | "explicit_request";
};

export type PlanArtifactCanonicalInput = {
	target: PlanArtifactGenerationTarget;
	task: {
		id: string;
		title: string;
		description: string | null;
		initialPrompt: string;
		acceptanceCriteria: string | null;
	};
	questionnaire: {
		sessionId: string;
		digest: string;
		status: string;
		decisions: AcceptedQuestionnaireDecision[];
		unresolvedBlocking: BlockingQuestion[];
	} | null;
	project: {
		repositoryId: string;
		name: string;
		root: string;
		materializationState: "materialized" | "empty" | "missing";
		detectedStack: ProjectStackProfile | null;
		packageScripts: Array<{ name: string; command: string }>;
	};
	routing: {
		revision: number;
		includedViews: string[];
		omittedViews: Array<{ view: string; reason: string | null }>;
	};
	sources: Array<{
		kind: string;
		messageId: string;
		digest: string;
		routingRevision: number | null;
		renderedContent: string;
		contentMode?: "raw" | "canonical_summary";
		originalBytes?: number;
	}>;
	regenerationRequest: string | null;
	provenance: {
		contextRevision: number | null;
		contextDigest: string | null;
		routingRevision: number;
	};
};

export type PlanTaskProjection = PlanArtifactCanonicalInput["task"];
export type PlanProjectContextProjection = Pick<
	PlanArtifactCanonicalInput["project"],
	| "repositoryId"
	| "name"
	| "root"
	| "materializationState"
	| "detectedStack"
	| "packageScripts"
>;
export type PlanSourceArtifactProjection =
	PlanArtifactCanonicalInput["sources"][number];

export type PlanArtifactInputDiagnostics = {
	sectionChars: Record<string, number>;
	sectionBytes: Record<string, number>;
	sourceCount: number;
	deduplicatedSourceCount: number;
	initialPromptOccurrences: number;
	projectionDigest: string;
};

export type PlanArtifactInputProjection = {
	version: typeof PLAN_ARTIFACT_INPUT_PROJECTION_VERSION;
	target: PlanArtifactGenerationTarget;
	task: PlanTaskProjection;
	questionnaireDecisions: AcceptedQuestionnaireDecision[];
	projectContext: PlanProjectContextProjection;
	sourceArtifacts: PlanSourceArtifactProjection[];
	regenerationRequest: string | null;
	provenance: {
		contextRevision: number | null;
		contextDigest: string | null;
		routingRevision: number;
		questionnaireDigest: string | null;
		sourceMessageIds: string[];
		sourceDigests: string[];
	};
	diagnostics: PlanArtifactInputDiagnostics;
};
