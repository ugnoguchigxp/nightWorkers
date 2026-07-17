import { toDeepRecord } from "../../../shared/json-record";
import type { PlanModeRegenerationTarget } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { ArtifactExportDescriptor } from "../nightworkers/artifactExport";
import {
	artifactFileStem,
	buildMarkdownFromValue,
	markdownCodeBlock,
} from "../nightworkers/artifactExport";
import type {
	DesignQuestionnaireSession,
	PlanModeWorkspace,
	TaskMessage,
	WorkbenchArtifactContext,
} from "../nightworkers/types";
import type {
	getPlanModeCapabilities,
	PlanWorkspaceTab,
} from "../specification";
import type { PlanViewDecision } from "./PlanModeWorkspacePanels";

const additionalPlanViewTabs = [
	"user-flow",
	"api-io-contract",
	"activity-flow",
	"sequence-flow",
	"zod-schema-design",
] as const;

export const tabToPlanView = {
	"user-flow": "user_flow",
	"api-io-contract": "api_io_contract",
	"activity-flow": "activity_flow",
	"sequence-flow": "sequence_flow",
	"zod-schema-design": "zod_schema_design",
} as const;

const tabLabels: Record<PlanWorkspaceTab, string> = {
	"feature-plan": "spec",
	status: "Status",
	questionnaire: "Questionnaire",
	blueprint: "Blueprint",
	"data-model": "Data Model",
	"user-flow": "User Flow",
	"api-io-contract": "API Contract",
	"activity-flow": "Activity",
	"sequence-flow": "Sequence",
	"zod-schema-design": "Zod",
};

export const planWorkspaceRegenerationTargets = {
	"feature-plan": "feature_plan",
	blueprint: "blueprint",
	"data-model": "data_model",
	"user-flow": "user_flow",
	"api-io-contract": "api_io_contract",
	"activity-flow": "activity_flow",
	"sequence-flow": "sequence_flow",
	"zod-schema-design": "zod_schema_design",
} as const satisfies Record<string, PlanModeRegenerationTarget>;

export const correctionTargetTabs: Record<
	PlanModeRegenerationTarget,
	PlanWorkspaceTab
> = {
	feature_plan: "feature-plan",
	blueprint: "blueprint",
	data_model: "data-model",
	user_flow: "user-flow",
	api_io_contract: "api-io-contract",
	activity_flow: "activity-flow",
	sequence_flow: "sequence-flow",
	zod_schema_design: "zod-schema-design",
};

export function resolveQuestionnaireGenerationState(
	messages: Pick<TaskMessage, "id" | "metadataJson">[],
) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) continue;
		const intent = String(toDeepRecord(message.metadataJson).intent || "");
		if (intent === "design_questionnaire_starting") {
			return { status: "generating" as const, messageId: message.id };
		}
		if (intent === "design_questionnaire_ready") {
			return { status: "ready" as const, messageId: message.id };
		}
		if (intent === "intake_failed") {
			return { status: "failed" as const, messageId: message.id };
		}
	}
	return { status: "idle" as const, messageId: null };
}

type PlanWorkspaceRegenerationTab =
	keyof typeof planWorkspaceRegenerationTargets;

export const planWorkspaceTargetLabels: Record<
	PlanModeRegenerationTarget,
	string
> = {
	feature_plan: "Feature Plan",
	blueprint: "Blueprint",
	data_model: "Data Model",
	user_flow: "User Flow",
	api_io_contract: "API Contract",
	activity_flow: "Activity",
	sequence_flow: "Sequence",
	zod_schema_design: "Zod Schema",
};

function isPlanWorkspaceRegenerationTab(
	tab: PlanWorkspaceTab,
): tab is PlanWorkspaceRegenerationTab {
	return Object.hasOwn(planWorkspaceRegenerationTargets, tab);
}

function planWorkspaceDisplayKind(target: string) {
	return `PLAN_MODE:${target.toUpperCase()}`;
}

export function buildPlanModeArtifactContext(input: {
	sessionId: string | null;
	activeTab: PlanWorkspaceTab;
	featurePlanMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeBlueprintMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeBlueprintSourceMessageId?: string | null;
	activeDataModelMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeDedicatedMessage?: Pick<TaskMessage, "id" | "content"> | null;
	activeDedicatedArtifact?: Pick<
		PlanModeWorkspace["dedicatedViewArtifacts"][number],
		"sourceMessageId"
	> | null;
	readyQuestionnaireSessionId?: string | null;
}): WorkbenchArtifactContext | null {
	if (!input.sessionId || !isPlanWorkspaceRegenerationTab(input.activeTab))
		return null;
	const target = planWorkspaceRegenerationTargets[input.activeTab];
	const sourceMessageId =
		target === "feature_plan"
			? input.featurePlanMessage?.id || ""
			: target === "blueprint"
				? input.activeBlueprintSourceMessageId ||
					input.activeBlueprintMessage?.id ||
					""
				: target === "data_model"
					? input.activeDataModelMessage?.id || ""
					: input.activeDedicatedMessage?.id ||
						input.activeDedicatedArtifact?.sourceMessageId ||
						"";
	const summary =
		target === "feature_plan"
			? input.featurePlanMessage?.content.slice(0, 160)
			: target === "blueprint"
				? input.activeBlueprintMessage?.content.slice(0, 160)
				: target === "data_model"
					? input.activeDataModelMessage?.content.slice(0, 160)
					: input.activeDedicatedMessage?.content.slice(0, 160);
	return {
		artifactId: `plan-mode-workspace-${input.sessionId}:${target}`,
		kind: "plan_mode_workspace",
		title: planWorkspaceTargetLabels[target],
		summary,
		source: { type: "task_message", messageId: sourceMessageId },
		metadata: {
			intent: "plan_mode_artifact_regeneration",
			artifactType: target,
			initialTab: input.activeTab,
			instructionMode: "regenerate_artifact",
			planModeTarget: target,
			planModeFocus: { kind: "artifact" },
			displayKind: planWorkspaceDisplayKind(target),
			questionnaireSessionId: input.readyQuestionnaireSessionId ?? null,
			featurePlanMessageId: input.featurePlanMessage?.id ?? null,
			sourceBlueprintMessageId:
				input.activeBlueprintSourceMessageId ||
				input.activeBlueprintMessage?.id ||
				null,
			sourceDataModelMessageId: input.activeDataModelMessage?.id ?? null,
		},
	};
}

export function getPlanWorkspaceTabLabel(tab: PlanWorkspaceTab) {
	return tabLabels[tab];
}

function planModeMessageMarkdown(title: string, message: TaskMessage | null) {
	if (!message) return `# ${title}\n`;
	const metadata = toDeepRecord(message.metadataJson);
	if (message.messageType === "api_contract") {
		return buildMarkdownFromValue(
			title,
			metadata.apiContract ||
				metadata.artifactPayload ||
				parseJson(message.content),
		);
	}
	if (message.messageType === "zod_schema") {
		return `# ${title}\n\n${markdownCodeBlock(message.content, "typescript")}\n`;
	}
	const parsed = parseJson(message.content);
	return parsed === null
		? message.content || `# ${title}\n`
		: buildMarkdownFromValue(title, parsed);
}

function parseJson(value: string) {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

export function buildPlanModeExportDescriptor(input: {
	scopeId: string | null;
	activeTab: PlanWorkspaceTab;
	workspace: PlanModeWorkspace | null;
	viewDecisions: PlanViewDecision[];
	activeQuestionnaireSession: DesignQuestionnaireSession | null;
	featurePlanMessage: TaskMessage | null;
	activeBlueprintMessage: TaskMessage | null;
	activeDataModelMessage: TaskMessage | null;
	activeDedicatedMessage: TaskMessage | null;
}): ArtifactExportDescriptor {
	const title = getPlanWorkspaceTabLabel(input.activeTab);
	let markdown: string;
	if (input.activeTab === "status") {
		markdown = buildMarkdownFromValue(title, {
			workspace: input.workspace,
			viewDecisions: input.viewDecisions,
		});
	} else if (input.activeTab === "questionnaire") {
		markdown = buildMarkdownFromValue(
			title,
			input.activeQuestionnaireSession || { status: "not_started" },
		);
	} else if (input.activeTab === "feature-plan") {
		markdown = input.featurePlanMessage?.content || `# ${title}\n`;
	} else if (input.activeTab === "blueprint") {
		markdown = planModeMessageMarkdown(title, input.activeBlueprintMessage);
	} else if (input.activeTab === "data-model") {
		markdown = planModeMessageMarkdown(title, input.activeDataModelMessage);
	} else {
		markdown = planModeMessageMarkdown(title, input.activeDedicatedMessage);
	}
	return {
		title,
		fileStem: artifactFileStem(`plan-mode-${title}`),
		markdown,
		...(input.scopeId ? { scopeId: input.scopeId } : {}),
	};
}

export function shouldShowQuestionnaireStartAction(input: {
	sessionId: string | null;
	questionnaireComplete: boolean;
}) {
	return Boolean(input.sessionId) && !input.questionnaireComplete;
}

export function resolveInitialPlanWorkspaceTabUpdate(
	initialTab: PlanWorkspaceTab | undefined,
): PlanWorkspaceTab | null {
	if (!initialTab) return null;
	return initialTab === "questionnaire" ? null : initialTab;
}

export function shouldOpenQuestionnaireForEmptyBlueprint(input: {
	hasQuestionnaireSessions: boolean;
	hasBlueprintMessages: boolean;
	activeTab: PlanWorkspaceTab;
	preserveGeneratedBlueprintFocus?: boolean;
}) {
	return (
		input.hasQuestionnaireSessions &&
		!input.hasBlueprintMessages &&
		input.activeTab === "blueprint" &&
		!input.preserveGeneratedBlueprintFocus
	);
}

type PlanWorkspaceScrollContainer = {
	scrollTop: number;
	scrollTo?: (options: ScrollToOptions) => void;
};
type PlanWorkspaceScrollScheduler = {
	requestAnimationFrame?: (callback: () => void) => unknown;
};

export function scrollPlanWorkspaceToTop(
	element: PlanWorkspaceScrollContainer | null,
) {
	if (!element) return;
	if (typeof element.scrollTo === "function") {
		element.scrollTo({ top: 0, left: 0, behavior: "auto" });
		return;
	}
	element.scrollTop = 0;
}

export function resetPlanWorkspaceScrollToTop(
	getElement: () => PlanWorkspaceScrollContainer | null,
	scheduler?: PlanWorkspaceScrollScheduler,
) {
	const reset = () => scrollPlanWorkspaceToTop(getElement());
	if (typeof scheduler?.requestAnimationFrame === "function") {
		scheduler.requestAnimationFrame(reset);
		return;
	}
	reset();
}

type PlanModeCapabilities = ReturnType<typeof getPlanModeCapabilities>;
export function buildVisiblePlanWorkspaceTabs(input: {
	hasFeaturePlan: boolean;
	hasQuestionnaire: boolean;
	hasBlueprint: boolean;
	hasDataModel: boolean;
	includedViews: ReadonlySet<string>;
	planModeCapabilities: PlanModeCapabilities;
	dedicatedViewArtifacts:
		| PlanModeWorkspace["dedicatedViewArtifacts"]
		| undefined;
}): PlanWorkspaceTab[] {
	const additionalTabs = additionalPlanViewTabs.filter((tab) => {
		const view = tabToPlanView[tab];
		return input.dedicatedViewArtifacts?.some(
			(artifact) => artifact.kind === view,
		);
	});
	return [
		"status",
		...(input.hasFeaturePlan ? (["feature-plan"] as const) : []),
		...(input.planModeCapabilities.questionnaire && input.hasQuestionnaire
			? (["questionnaire"] as const)
			: []),
		...(input.hasBlueprint ? (["blueprint"] as const) : []),
		...(input.hasDataModel ? (["data-model"] as const) : []),
		...additionalTabs,
	];
}
