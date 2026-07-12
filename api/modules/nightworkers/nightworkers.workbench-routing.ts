import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { PlanModeArtifactFocus } from "../../../shared/schemas/plan-mode-artifact-correction.schema";

export type WorkbenchArtifactContext = {
	artifactId: string;
	kind: string;
	title: string;
	summary?: string;
	source?: {
		type?: string;
		messageId?: string;
		artifactId?: string;
		runId?: string;
	};
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
		source?: string;
		dataModelTarget?: unknown;
	};
};

export type WorkbenchChatIntent =
	| "intake"
	| "draft"
	| "feature_plan"
	| "create_task"
	| "queue"
	| "run_task"
	| "adjust_running"
	| "review_followup"
	| "learning_capture"
	| "design_component"
	| "design_blueprint_data";
