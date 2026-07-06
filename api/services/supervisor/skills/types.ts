import type {
	DedicatedDesignView,
	SpecificationLens,
} from "../../../../shared/schemas/plan-mode-artifact.schema";

export const supervisorPhases = [
	"answer",
	"analyze",
	"plan",
	"execute",
	"review",
	"investigate",
	"verify",
	"summarize",
] as const;

export const supervisorModes = [
	"general_answer",
	"planning",
	"code_edit",
	"review",
	"investigation",
	"test_and_verification",
	"research",
	"docs",
	"git_release",
] as const;

export const supervisorWorkKinds = [
	"code",
	"refactor",
	"test",
	"docs",
	"config",
	"dependency",
	"data_migration",
	"blueprint",
	"ui_ux",
	"git",
	"release",
	"research",
] as const;

export const supervisorOverlays = [
	"evidence",
	"security",
	"performance",
	"incident",
	"destructive_operation",
	"production_risk",
	"user_facing_change",
	"external_research_required",
] as const;

export type SupervisorPhase = (typeof supervisorPhases)[number];
export type SupervisorMode = (typeof supervisorModes)[number];
export type SupervisorWorkKind = (typeof supervisorWorkKinds)[number];
export type SupervisorOverlay = (typeof supervisorOverlays)[number];

export type PlanModeViewDecision = {
	view: DedicatedDesignView;
	decision: "include" | "omit";
	reason: string;
};

export type PlanModeRoutingDecision = {
	primaryArtifact: "feature_plan";
	dedicatedViews: PlanModeViewDecision[];
	specificationLenses: SpecificationLens[];
};

export type TaskSchedulingDecision = {
	executionType: "normal" | "exclusive" | "sequence";
	reason: string;
	sequenceGroupId?: string | null;
	sequenceOrder?: number | null;
	dependsOnTaskIds?: string[] | null;
};

export type SupervisorRoutingHypothesis = {
	primaryMode: SupervisorMode;
	secondaryModes: SupervisorMode[];
	phase: SupervisorPhase;
	workKinds: SupervisorWorkKind[];
	overlays: SupervisorOverlay[];
	subtype?: string;
	requiredEvidence: string[];
	nextReferenceFiles: string[];
	confidence: number;
	planMode?: PlanModeRoutingDecision;
	scheduling?: TaskSchedulingDecision;
};

export type SupervisorReferenceSectionName =
	| "Use When"
	| "Required Behavior"
	| "Stop Conditions"
	| "Report Contract"
	| "Tool Guidance"
	| "Verification Guidance"
	| "Risk Notes";

export type SupervisorReferenceDocumentKind =
	| "root"
	| "router"
	| "phase"
	| "mode"
	| "work_kind"
	| "overlay";

export type SupervisorReferenceDocument = {
	id: string;
	kind: SupervisorReferenceDocumentKind;
	title: string;
	version: 1;
	source: "builtin" | "configured";
	relativePath: string;
	digest: string;
	sections: Partial<Record<SupervisorReferenceSectionName, string>>;
};

export const defaultSupervisorRoutingHypothesis: SupervisorRoutingHypothesis = {
	primaryMode: "general_answer",
	secondaryModes: [],
	phase: "answer",
	workKinds: [],
	overlays: [],
	requiredEvidence: [],
	nextReferenceFiles: ["SKILL.md", "references/modes/general_answer.md"],
	confidence: 0.5,
};
