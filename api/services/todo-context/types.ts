import type { MissionPilotAgentRunProvenance } from "../../../shared/modules/missionPilot";
import type { PlanModeCapability } from "../settings/general-settings";
import type { TodoVerificationPolicy } from "../todo-runtime";

export type RuntimeLaneSnapshot = {
	workerKind: "native-local" | "codex-agent";
	source:
		| "task"
		| "queue"
		| "settings"
		| "env"
		| "role_route"
		| "provider_default";
	diagnostics?: Array<{ level: "info" | "warning"; message: string }>;
};

export type PlanModeSettingsSnapshot = {
	capabilities: Record<PlanModeCapability, boolean>;
	disabledCapabilities: PlanModeCapability[];
	source: "general-settings";
};

export type TodoProcedureSnapshot = {
	id?: string | null;
	source?: string | null;
	title?: string | null;
	digest?: string | null;
	[key: string]: unknown;
};

export type RuntimePromptSnapshot = {
	compiledPrompt: string;
	source: "task_prompt" | "fallback";
	degraded: boolean;
	degradedReason?: string;
	executionMode?:
		| "planning"
		| "implementation"
		| "test"
		| "review"
		| "general_answer";
	executionPhase?:
		| "planning"
		| "implementation"
		| "test"
		| "review"
		| "general_answer";
	executionModeSource?:
		| "message_history"
		| "workbench_intake"
		| "workbench_run"
		| "workbench_run_task"
		| "implementation_queue"
		| "session_queue"
		| "review_run"
		| "test_mode"
		| "explicit";
	verificationPolicy?: TodoVerificationPolicy | null;
	implementationPlanProvenance?: {
		version: 1;
		sourceMessageId: string;
		digest: string;
	};
	planModeClosed?: boolean;
	planModeRequested?: boolean;
	planModeSettingsSnapshot?: PlanModeSettingsSnapshot;
	implementationPhasePreamble?: string;
	blueprintPlanning?: unknown;
	runtimeLane?: "native-api-runner" | "codex-sdk";
	runtimeLaneResolution?: RuntimeLaneSnapshot;
	runtimeResume?: unknown;
	missionPilotAgent?: MissionPilotAgentRunProvenance;
	reviewCorrection?: unknown;
	projectMeta?: unknown;
	securityOracle?: {
		enabled: boolean;
		configured: boolean;
		reason: string;
		measuredSourceLoc: number | null;
		thresholdSourceLoc: number;
	};
	ontologyMcp?: {
		enabled: boolean;
		source: "project_meta_file_scale" | "project_code_size_tool_profile";
		fileScale?: string | null;
		toolProfile?: string;
		measuredSourceLoc?: number | null;
		thresholdSourceLoc?: number;
		reason?: string | null;
	};
	ontologyContext?: unknown;
	ontologyBoundaryAudit?: unknown;
	projectExplorationCatalog?: unknown;
	effectiveLlmRouting?: unknown;
	request: {
		registeredRepositoryPath?: string;
		repositoryPath: string;
		taskTitle: string;
		taskDescriptionDigest: string;
	};
	result: {
		digest: string;
		charCount: number;
	};
	conversationContext?: {
		snapshotId?: string;
		version?: number;
		tokenEstimate?: number;
		stateCardIncluded: boolean;
		stateCardText?: string;
		snapshotJson?: unknown;
		projection?: {
			role: "plan" | "implementation" | "test" | "review" | "general_answer";
			workKind?: string | null;
			source: "role_projection" | "raw_snapshot" | "omitted";
			omittedSections: string[];
		};
		usage?: {
			latestUserMessageTokens: number;
			stateCardTokens: number;
			runtimeUserPromptTokens: number;
		};
	};
	roleContext?: {
		version: 1;
		source: "deterministic";
		handoff: {
			digest: string;
			eventSeq?: number | null;
			eventId?: string | null;
			omitted: false;
		};
		workingContext: {
			digest: string;
			eventSeq?: number | null;
			eventId?: string | null;
			renderedText: string;
			omitted: false;
		};
	};
};

export type TodoContextInput = {
	todo: {
		id: string;
		seq: number;
		title: string;
		description?: string | null;
		taskType: string;
		procedureId?: string | null;
		procedureSnapshot?: TodoProcedureSnapshot | null;
	};
	runContext: RuntimePromptSnapshot;
	previousTodoSummaries?: Array<{
		id: string;
		seq: number;
		title: string;
		status: string;
		summary?: string | null;
	}>;
};

export type TodoContextSnapshot = {
	version: 1;
	todo: {
		id: string;
		seq: number;
		title: string;
		description: string | null;
		taskType: string;
	};
	selectedProcedure: {
		id: string | null;
		source: string | null;
		title: string | null;
		digest: string | null;
	};
	runContext: {
		source: RuntimePromptSnapshot["source"];
		degraded: boolean;
		degradedReason?: string;
		digest: string;
		charCount: number;
	};
	previousTodoSummaries: Array<{
		id: string;
		seq: number;
		title: string;
		status: string;
		summary: string | null;
	}>;
};
