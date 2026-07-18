import type {
	ActivityArtifact,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactKind,
	WorkbenchArtifactRef,
} from "./types";
import { isRecord, taskMessageMetadata, toMs } from "./workbenchSelectorUtils";

function isDataModelMessage(message: TaskMessage): boolean {
	const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
	return (
		message.messageType === "markdown_document" && isDataModelMetadata(metadata)
	);
}

function isNormalBlueprintMessage(message: TaskMessage): boolean {
	const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
	return (
		message.messageType === "markdown_document" &&
		hasBlueprintMetadata(metadata) &&
		!isDataModelMessage(message)
	);
}

export function latestTaskMessageByCreatedAt(messages: TaskMessage[]) {
	let latest: TaskMessage | undefined;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const message of messages) {
		const ms = toMs(message.createdAt);
		if (ms > latestMs) {
			latest = message;
			latestMs = ms;
		}
	}
	return latest;
}

export function latestActivityArtifactByCreatedAt(
	artifacts: ActivityArtifact[],
) {
	let latest: ActivityArtifact | undefined;
	let latestMs = Number.NEGATIVE_INFINITY;
	for (const artifact of artifacts) {
		const ms = toMs(artifact.createdAt);
		if (ms > latestMs) {
			latest = artifact;
			latestMs = ms;
		}
	}
	return latest;
}

export function activityArtifactRef(
	taskId: string,
	artifact: ActivityArtifact,
): WorkbenchArtifactRef {
	const metadata = activityArtifactMetadata(artifact);
	const isMockBlueprint =
		metadata.intent === "mock_blueprint" ||
		metadata.schemaName === "mock_blueprint";
	const metadataBlueprint = isMockBlueprint
		? metadata.mockBlueprint
		: metadata.appBlueprint;
	const shouldParseContentFallback =
		!metadataBlueprint && !metadata.title && !metadata.summary;
	const parsedContent = shouldParseContentFallback
		? parseArtifactContentJson(artifact.contentText)
		: null;
	const blueprint = metadataBlueprint || parsedContent;
	const blueprintRecord = isRecord(blueprint) ? blueprint : null;
	const title = String(blueprintRecord?.name || metadata.title || "Blueprint");
	return {
		id: `artifact-${artifact.id}`,
		taskId,
		runId: artifact.runId || undefined,
		kind: "app_blueprint",
		title: `Blueprint: ${title}`,
		summary:
			typeof blueprintRecord?.description === "string"
				? blueprintRecord.description
				: typeof blueprintRecord?.summary === "string"
					? blueprintRecord.summary
					: String(metadata.summary || artifact.path || artifact.kind),
		source: { type: "artifact_row", artifactId: artifact.id },
		createdAt: String(artifact.createdAt),
		metadata: {
			...metadata,
			intent:
				metadata.intent ||
				(isMockBlueprint ? "mock_blueprint" : "app_blueprint"),
			...(blueprintRecord
				? isMockBlueprint
					? { mockBlueprint: blueprintRecord }
					: { appBlueprint: blueprintRecord }
				: {}),
			artifactRef: {
				artifactId: artifact.id,
				kind: "app_blueprint",
				version: 1,
			},
		},
	};
}

export function isBlueprintActivityArtifact(
	artifact: ActivityArtifact,
): boolean {
	const metadata = activityArtifactMetadata(artifact);
	return (
		(artifact.kind === "app_blueprint" ||
			metadata.schemaName === "app_blueprint" ||
			metadata.schemaName === "mock_blueprint") &&
		!isDataModelMetadata(metadata)
	);
}

export function activityArtifactMetadata(
	artifact: ActivityArtifact,
): Record<string, unknown> {
	return isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
}

export function parseArtifactContentJson(
	content: string | null | undefined,
): unknown {
	if (!content?.trim()) return null;
	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
}

export function taskMessageArtifactId(message: TaskMessage): string | null {
	const metadata = taskMessageMetadata(message);
	const artifactRef = isRecord(metadata.artifactRef)
		? metadata.artifactRef
		: null;
	return typeof artifactRef?.artifactId === "string"
		? artifactRef.artifactId
		: null;
}

export function isMessageCoveredByActivityArtifact(
	message: TaskMessage,
	artifactMessageIds: Set<string>,
	artifactIds: Set<string>,
): boolean {
	const artifactRef = isRecord(taskMessageMetadata(message).artifactRef)
		? taskMessageMetadata(message).artifactRef
		: {};
	const artifactId = artifactRef.artifactId;
	return (
		artifactMessageIds.has(message.id) ||
		(typeof artifactId === "string" && artifactIds.has(artifactId))
	);
}

export function runFieldRef(
	taskId: string,
	run: TaskRun,
	kind: WorkbenchArtifactKind,
	title: string,
	field: string,
): WorkbenchArtifactRef {
	return {
		id: `run-${run.id}-${field}`,
		taskId,
		runId: run.id,
		kind,
		title,
		source: { type: "run_field", runId: run.id, field },
		createdAt: String(run.finishedAt || run.updatedAt || run.createdAt),
	};
}

export function inferDocumentArtifactKind(
	message: TaskMessage,
): WorkbenchArtifactKind {
	const metadata = taskMessageMetadata(message);
	const intent = String(metadata.intent);
	if (isPlanModeDedicatedViewMetadata(metadata)) return "plan_mode_workspace";
	if (isDataModelArtifactMessage(message)) return "plan_mode_workspace";
	if (isBlueprintArtifactMessage(message)) return "app_blueprint";
	if (intent === "component_design" || metadata.componentDesign)
		return "component_design";
	if (intent === "design_delta" || metadata.designDelta) return "design_delta";
	if (intent === "draft_spec") return "spec";
	if (intent === "implementation_plan") return "implementation_plan";
	return "spec";
}

export function isBlueprintArtifactMessage(message: TaskMessage): boolean {
	return isNormalBlueprintMessage(message);
}

export function isDataModelArtifactMessage(message: TaskMessage): boolean {
	return isDataModelMessage(message);
}

export function isDataModelMetadata(
	metadata: Record<string, unknown>,
): boolean {
	return (
		(metadata.artifactKind === "plan_mode_dedicated_view" &&
			metadata.view === "data_model") ||
		metadata.artifactType === "data_model" ||
		metadata.source === "data-model"
	);
}

export function planModeWorkspaceInitialTabMetadata(message: TaskMessage): {
	initialTab?: string;
} {
	const metadata = taskMessageMetadata(message);
	if (
		String(metadata.intent || "") === "design_questionnaire_starting" ||
		String(metadata.intent || "") === "design_questionnaire_ready"
	) {
		return { initialTab: "questionnaire" };
	}
	if (isDataModelArtifactMessage(message)) return { initialTab: "data-model" };
	if (!isPlanModeDedicatedViewMetadata(metadata)) return {};
	const tabs: Record<string, string> = {
		user_flow: "user-flow",
		api_io_contract: "api-io-contract",
		activity_flow: "activity-flow",
		sequence_flow: "sequence-flow",
		zod_schema_design: "zod-schema-design",
	};
	const tab = tabs[String(metadata.view)];
	return tab ? { initialTab: tab } : {};
}

export function isPlanModeDedicatedViewMetadata(
	metadata: Record<string, unknown>,
) {
	return (
		metadata.artifactKind === "plan_mode_dedicated_view" ||
		metadata.artifactKind === "plan_mode_api_contract" ||
		metadata.artifactKind === "plan_mode_zod_schema"
	);
}

export function isPlanModeDedicatedViewMessage(message: TaskMessage) {
	const metadata = taskMessageMetadata(message);
	if (message.messageType === "markdown_document") return true;
	return (
		(message.messageType === "api_contract" &&
			String(metadata.artifactKind) === "plan_mode_api_contract") ||
		(message.messageType === "zod_schema" &&
			String(metadata.artifactKind) === "plan_mode_zod_schema")
	);
}

export function hasBlueprintMetadata(
	metadata: Record<string, unknown>,
): boolean {
	return (
		metadata.intent === "app_blueprint" ||
		metadata.intent === "mock_blueprint" ||
		Boolean(metadata.appBlueprint) ||
		Boolean(metadata.mockBlueprint)
	);
}

export function blueprintPayloadFromMetadata(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	if (isRecord(metadata.appBlueprint)) return metadata.appBlueprint;
	if (isRecord(metadata.mockBlueprint)) return metadata.mockBlueprint;
	return {};
}

export function artifactTitleForKind(
	kind: WorkbenchArtifactKind,
	message: TaskMessage,
): string {
	const metadata = taskMessageMetadata(message);
	const metadataTitle = String(metadata.title || "");
	if (metadataTitle.trim()) {
		if (isDataModelArtifactMessage(message))
			return `Data Model: ${metadataTitle}`;
		if (kind === "plan_mode_workspace")
			return `Plan Mode Workspace: ${metadataTitle}`;
		if (kind === "app_blueprint") return `Blueprint: ${metadataTitle}`;
		if (kind === "component_design") return `Component: ${metadataTitle}`;
		if (kind === "design_delta") return `Design Delta: ${metadataTitle}`;
		if (kind === "implementation_plan") return metadataTitle;
		if (kind === "spec" && String(metadata.intent) === "design_decision_review")
			return metadataTitle;
	}
	if (kind === "plan_mode_workspace") return "Plan Mode Workspace";
	if (kind === "app_blueprint") return "App Blueprint";
	if (kind === "component_design") return "Component Design";
	if (kind === "design_delta") return "Design Delta";
	if (kind === "implementation_plan") return "Implementation Plan";
	if (kind === "review_status") return "Review Status";
	return "Spec";
}
