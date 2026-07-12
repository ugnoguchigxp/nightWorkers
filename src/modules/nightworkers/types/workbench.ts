import type { PlanModeRegenerationTarget } from "../../../../shared/schemas/plan-mode-artifact.schema";
import type { PlanModeArtifactFocus } from "../../../../shared/schemas/plan-mode-artifact-correction.schema";
import type { ImplementationQueueEntry, Task, TaskRun } from "./core";

export type WorkbenchSessionGroup = "processing" | "queue" | "archive";

export type WorkbenchMovableSessionGroup = "processing" | "queue" | "archive";

export type WorkbenchPhase =
	| "Analyzing"
	| "Prompt Preparing"
	| "Queued"
	| "Implementing"
	| "Verifying"
	| "Reviewing"
	| "Improving"
	| "Needs Attention"
	| "Completed"
	| "Archived";

export type WorkbenchProgressBasisKind =
	| "task_status"
	| "run_status"
	| "todo_status"
	| "run_event"
	| "review_result"
	| "prompt_snapshot"
	| "artifact";

export type WorkbenchProgressBlocker = {
	kind:
		| "needs_human"
		| "policy"
		| "verification"
		| "timeout"
		| "review"
		| "runtime";
	message: string;
	evidenceRef?: string;
};

export type WorkbenchProgressSnapshot = {
	percent: number;
	phase: WorkbenchPhase;
	basis: Array<{
		kind: WorkbenchProgressBasisKind;
		refId?: string;
		label: string;
	}>;
	blockers: WorkbenchProgressBlocker[];
};

export type CodexContractWarningSummary = {
	totalCount: number;
	warningCount: number;
	errorCount: number;
	items: Array<{
		code: string;
		severity: "info" | "warning" | "error";
		count: number;
		changedFiles: string[];
		command?: string | null;
		occurredAt?: string;
	}>;
};

export type CodexMcpDiagnosticsSummary = {
	configSource: string | null;
	observedNightWorkersTools: string[];
	expectedTools: string[];
	degraded: boolean;
	tone: "neutral" | "info" | "warning";
	label: string;
};

export type WorkbenchArtifactKind =
	| "plan_mode_workspace"
	| "app_blueprint"
	| "component_design"
	| "design_delta"
	| "spec"
	| "implementation_plan"
	| "context_pack"
	| "diff"
	| "source_preview"
	| "test_result"
	| "test_mode"
	| "review_result"
	| "review_status"
	| "run_ledger"
	| "todo_plan"
	| "final_report"
	| "pr_reference";

export type ProjectFileEntry = {
	name: string;
	path: string;
	type: "file" | "directory";
	size?: number;
};

export type ProjectFileContent = {
	path: string;
	content: string;
	size: number;
	truncated: boolean;
};

export type ProjectDiff = {
	diff: string;
	diffStat: string;
	hasChanges: boolean;
};

export type WorkbenchArtifactRef = {
	id: string;
	taskId: string;
	runId?: string;
	kind: WorkbenchArtifactKind;
	title: string;
	summary?: string;
	source:
		| { type: "artifact_row"; artifactId: string }
		| { type: "run_field"; runId: string; field: string }
		| { type: "task_message"; messageId: string }
		| { type: "run_event"; eventId: string }
		| { type: "review_result"; reviewId: string }
		| { type: "test_mode" };
	createdAt: string;
	metadata?: Record<string, unknown>;
};

export type WorkbenchArtifactContext = {
	artifactId: string;
	kind: WorkbenchArtifactKind;
	title: string;
	summary?: string;
	source: WorkbenchArtifactRef["source"];
	metadata?: {
		intent?: string;
		appBlueprintName?: string;
		artifactType?: string;
		screenNames?: string[];
		sectionNames?: string[];
		tableNames?: string[];
		initialTab?: string;
		blueprintCount?: number;
		instructionMode?: "regenerate_artifact";
		planModeTarget?: PlanModeRegenerationTarget;
		planModeFocus?: PlanModeArtifactFocus;
		correlationId?: string | null;
		displayKind?: string;
		questionnaireSessionId?: string | null;
		featurePlanMessageId?: string | null;
		sourceBlueprintMessageId?: string | null;
		sourceDataModelMessageId?: string | null;
	};
};

export type WorkbenchSessionView = {
	task: Task;
	group: WorkbenchSessionGroup;
	emailState:
		| "draft"
		| "plan_ready"
		| "queued"
		| "running"
		| "needs_input"
		| "review_needed"
		| "done"
		| "failed";
	primaryAction:
		| "open"
		| "queue"
		| "remove"
		| "open_run"
		| "respond"
		| "review"
		| "inspect";
	queuePosition?: number;
	queueEntry?: ImplementationQueueEntry;
	phase: WorkbenchPhase;
	progress: WorkbenchProgressSnapshot;
	latestRun?: TaskRun;
	latestEventSummary?: string;
	reviewNeed?: string;
	artifactCounts: Partial<Record<WorkbenchArtifactKind, number>>;
	badges: string[];
	codexContractWarnings?: CodexContractWarningSummary;
	codexMcpDiagnostics?: CodexMcpDiagnosticsSummary;
};
