import type {
	ActivityArtifact,
	ReviewResult,
	ReviewSessionDetail,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	TaskRunTodo,
	WorkbenchArtifactContext,
	WorkbenchArtifactKind,
	WorkbenchArtifactRef,
} from "./types";
import { isRecord, taskMessageMetadata, toMs } from "./workbenchSelectorUtils";

export function activityArtifactToTaskMessage(
	artifact: ActivityArtifact,
): TaskMessage {
	const metadata = activityArtifactMetadata(artifact);
	const isMockBlueprint =
		metadata.intent === "mock_blueprint" ||
		metadata.schemaName === "mock_blueprint";
	const metadataBlueprint = isMockBlueprint
		? metadata.mockBlueprint
		: metadata.appBlueprint;
	const parsedContent = metadataBlueprint
		? null
		: parseArtifactContentJson(artifact.contentText);
	const blueprintPayload = isMockBlueprint
		? metadata.mockBlueprint || parsedContent
		: metadata.appBlueprint || parsedContent;
	return {
		id: `artifact-${artifact.id}`,
		taskId: artifact.taskId,
		runId: artifact.runId || null,
		role: "assistant",
		content: artifact.contentText || "",
		messageType: "markdown_document",
		metadataJson: {
			...metadata,
			intent:
				metadata.intent ||
				(isMockBlueprint ? "mock_blueprint" : "app_blueprint"),
			artifactRef: {
				artifactId: artifact.id,
				kind: "app_blueprint",
				version: 1,
			},
			...(isMockBlueprint
				? { mockBlueprint: blueprintPayload }
				: { appBlueprint: blueprintPayload }),
		},
		createdAt: artifact.createdAt,
	};
}

export function mergeWorkspaceTaskMessages({
	taskMessages,
	activityArtifacts,
	generatedMessages,
}: {
	taskMessages: TaskMessage[];
	activityArtifacts: ActivityArtifact[];
	generatedMessages: TaskMessage[];
}) {
	const existingMessageIds = new Set(taskMessages.map((message) => message.id));
	const existingArtifactIds = new Set(
		taskMessages
			.map(taskMessageArtifactId)
			.filter((id): id is string => Boolean(id)),
	);
	const syntheticArtifactMessages = activityArtifacts
		.filter(
			(artifact) =>
				artifact.kind === "app_blueprint" &&
				!existingArtifactIds.has(artifact.id),
		)
		.map(activityArtifactToTaskMessage)
		.filter((message) => !existingMessageIds.has(message.id));
	const nextIds = new Set([
		...existingMessageIds,
		...syntheticArtifactMessages.map((message) => message.id),
	]);
	return [
		...taskMessages,
		...syntheticArtifactMessages,
		...generatedMessages.filter((message) => !nextIds.has(message.id)),
	];
}

export function isNormalBlueprintMessage(message: TaskMessage): boolean {
	const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
	return (
		message.messageType === "markdown_document" &&
		hasBlueprintMetadata(metadata) &&
		!isDataModelMessage(message)
	);
}

export function isDataModelMessage(message: TaskMessage): boolean {
	const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
	return (
		message.messageType === "markdown_document" && isDataModelMetadata(metadata)
	);
}

export function buildBlueprintArtifactRef(
	message: TaskMessage,
): WorkbenchArtifactRef {
	const metadata = taskMessageMetadata(message);
	const blueprint = blueprintPayloadFromMetadata(metadata);
	const display = isRecord(metadata.display) ? metadata.display : {};
	const artifactRef = isRecord(metadata.artifactRef)
		? metadata.artifactRef
		: {};
	const title = String(
		blueprint.name || display.title || metadata.title || "App Blueprint",
	);
	const artifactId = artifactRef.artifactId;
	return {
		id:
			typeof artifactId === "string"
				? `artifact-${artifactId}`
				: `message-${message.id}`,
		taskId: message.taskId,
		runId: message.runId || undefined,
		kind: "app_blueprint",
		title: `Blueprint: ${title}`,
		summary: String(display.summary || message.content.slice(0, 160)),
		source:
			typeof artifactId === "string"
				? { type: "artifact_row", artifactId }
				: { type: "task_message", messageId: message.id },
		createdAt: String(message.createdAt),
		metadata,
	};
}

export function buildPlanModeWorkspaceArtifactRef(
	message: TaskMessage,
	initialTab: "questionnaire" | "status" = "questionnaire",
): WorkbenchArtifactRef {
	return {
		id: `plan-mode-workspace-${message.taskId}`,
		taskId: message.taskId,
		runId: message.runId || undefined,
		kind: "plan_mode_workspace",
		title: "Plan Mode Workspace",
		summary: message.content.slice(0, 160),
		source: { type: "task_message", messageId: message.id },
		createdAt: String(message.createdAt),
		metadata: {
			planModeWorkspaceSource: "design_questionnaire_ready",
			questionnaireSessionId:
				taskMessageMetadata(message).questionnaireSessionId,
			initialTab,
		},
	};
}

export function buildArtifactContext(
	artifact: WorkbenchArtifactRef | null,
	activeSessionId: string | null,
): WorkbenchArtifactContext | null {
	if (!artifact || artifact.taskId !== activeSessionId) return null;
	const metadata = artifact.metadata || {};
	const appBlueprint = blueprintPayloadFromMetadata(metadata);
	const screens = Array.isArray(appBlueprint.screens)
		? appBlueprint.screens
		: [];
	const screenNames = screens
		.map((screen) => (isRecord(screen) ? screen : null))
		.filter(isRecord)
		.map((screen) => String(screen.name || screen.id || ""))
		.filter(Boolean)
		.slice(0, 6);
	const sectionNames = screens
		.flatMap((screen) => {
			const record = isRecord(screen) ? screen : {};
			return Array.isArray(record.sections) ? record.sections : [];
		})
		.map((section) => (isRecord(section) ? section : null))
		.filter(isRecord)
		.map((section) =>
			String(
				section.name ||
					section.title ||
					section.componentName ||
					section.id ||
					"",
			),
		)
		.filter(Boolean)
		.slice(0, 10);
	const databaseSchema = isRecord(appBlueprint.databaseSchema)
		? appBlueprint.databaseSchema
		: {};
	const tables = Array.isArray(databaseSchema.tables)
		? databaseSchema.tables
		: [];
	const tableNames = tables
		.map((table) => (isRecord(table) ? table : null))
		.filter(isRecord)
		.map((table) => String(table.label || table.name || ""))
		.filter(Boolean)
		.slice(0, 10);
	return {
		artifactId: artifact.id,
		kind: artifact.kind,
		title: artifact.title,
		summary: artifact.summary,
		source: artifact.source,
		metadata: {
			intent: typeof metadata.intent === "string" ? metadata.intent : undefined,
			artifactType:
				typeof metadata.artifactType === "string"
					? metadata.artifactType
					: undefined,
			appBlueprintName:
				String(appBlueprint.name || appBlueprint.id || "") || undefined,
			screenNames: screenNames.length ? screenNames : undefined,
			sectionNames: sectionNames.length ? sectionNames : undefined,
			tableNames: tableNames.length ? tableNames : undefined,
			initialTab:
				typeof metadata.initialTab === "string"
					? metadata.initialTab
					: undefined,
			blueprintCount:
				typeof metadata.blueprintCount === "number"
					? metadata.blueprintCount
					: undefined,
		},
	};
}

export function buildWorkbenchArtifactRefs(input: {
	task: Task;
	latestRun?: TaskRun;
	todos?: TaskRunTodo[];
	events?: TaskEvent[];
	reviews?: ReviewResult[];
	reviewSession?: ReviewSessionDetail | null;
	messages?: TaskMessage[];
	activityArtifacts?: ActivityArtifact[];
}): WorkbenchArtifactRef[] {
	const refs: WorkbenchArtifactRef[] = [];
	const run = input.latestRun;
	const blueprintArtifactRows = (input.activityArtifacts || []).filter(
		isBlueprintActivityArtifact,
	);
	const blueprintArtifactMessageIds = new Set(
		blueprintArtifactRows
			.map((artifact) => activityArtifactMetadata(artifact).messageId)
			.filter(
				(messageId): messageId is string =>
					typeof messageId === "string" && messageId.length > 0,
			),
	);
	const blueprintArtifactIds = new Set(
		blueprintArtifactRows.map((artifact) => artifact.id),
	);
	const blueprintMessages = (input.messages || []).filter(
		(message) =>
			message.messageType === "markdown_document" &&
			isBlueprintArtifactMessage(message) &&
			!isMessageCoveredByActivityArtifact(
				message,
				blueprintArtifactMessageIds,
				blueprintArtifactIds,
			),
	);
	const dataModelMessages = (input.messages || []).filter(
		(message) =>
			message.messageType === "markdown_document" &&
			isDataModelArtifactMessage(message),
	);
	const decisionReviewMessages = (input.messages || []).filter(
		(message) =>
			message.messageType === "markdown_document" &&
			String(taskMessageMetadata(message).intent) === "design_decision_review",
	);
	const featurePlanMessages = (input.messages || []).filter(
		(message) =>
			message.messageType === "markdown_document" &&
			String(taskMessageMetadata(message).intent) === "feature_plan",
	);
	const dedicatedViewMessages = (input.messages || []).filter(
		(message) =>
			isPlanModeDedicatedViewMessage(message) &&
			isPlanModeDedicatedViewMetadata(taskMessageMetadata(message)) &&
			String(taskMessageMetadata(message).view) !== "data_model",
	);
	if (
		blueprintArtifactRows.length > 0 ||
		blueprintMessages.length > 0 ||
		dataModelMessages.length > 0 ||
		dedicatedViewMessages.length > 0 ||
		decisionReviewMessages.length > 0 ||
		featurePlanMessages.length > 0
	) {
		const latestWorkspaceMessage = latestTaskMessageByCreatedAt([
			...blueprintMessages,
			...dataModelMessages,
			...dedicatedViewMessages,
			...decisionReviewMessages,
			...featurePlanMessages,
		]);
		const latestBlueprintArtifactRow = latestActivityArtifactByCreatedAt(
			blueprintArtifactRows,
		);
		const workspaceSource = latestWorkspaceMessage
			? { type: "task_message" as const, messageId: latestWorkspaceMessage.id }
			: latestBlueprintArtifactRow
				? {
						type: "artifact_row" as const,
						artifactId: latestBlueprintArtifactRow.id,
					}
				: { type: "task_message" as const, messageId: "" };
		refs.push({
			id: `plan-mode-workspace-${input.task.id}`,
			taskId: input.task.id,
			kind: "plan_mode_workspace",
			title:
				latestWorkspaceMessage &&
				planModeWorkspaceInitialTabMetadata(latestWorkspaceMessage).initialTab
					? artifactTitleForKind("plan_mode_workspace", latestWorkspaceMessage)
					: "Plan Mode Workspace",
			summary: [
				`${featurePlanMessages.length} spec${featurePlanMessages.length === 1 ? "" : "s"}`,
				`${dataModelMessages.length} Data Model${dataModelMessages.length === 1 ? "" : "s"}`,
				`${dedicatedViewMessages.length} Plan View${dedicatedViewMessages.length === 1 ? "" : "s"}`,
				`${blueprintArtifactRows.length + blueprintMessages.length} Blueprint artifact${
					blueprintArtifactRows.length + blueprintMessages.length === 1
						? ""
						: "s"
				}`,
				`${decisionReviewMessages.length} Decision Review${decisionReviewMessages.length === 1 ? "" : "s"}`,
			].join(" · "),
			source: workspaceSource,
			createdAt: String(
				latestWorkspaceMessage?.createdAt ||
					latestBlueprintArtifactRow?.createdAt ||
					input.task.updatedAt,
			),
			metadata: {
				blueprintCount: blueprintArtifactRows.length + blueprintMessages.length,
				dataModelCount: dataModelMessages.length,
				dedicatedViewCount: dedicatedViewMessages.length,
				decisionReviewCount: decisionReviewMessages.length,
				featurePlanCount: featurePlanMessages.length,
				...(latestWorkspaceMessage
					? planModeWorkspaceInitialTabMetadata(latestWorkspaceMessage)
					: {}),
			},
		});
	}
	for (const artifact of blueprintArtifactRows) {
		refs.push(activityArtifactRef(input.task.id, artifact));
	}
	for (const message of input.messages || []) {
		if (message.messageType !== "markdown_document") continue;
		if (
			isBlueprintArtifactMessage(message) &&
			isMessageCoveredByActivityArtifact(
				message,
				blueprintArtifactMessageIds,
				blueprintArtifactIds,
			)
		) {
			continue;
		}
		const kind = inferDocumentArtifactKind(message);
		refs.push({
			id: `message-${message.id}`,
			taskId: input.task.id,
			runId: message.runId || undefined,
			kind,
			title: artifactTitleForKind(kind, message),
			summary: message.content.slice(0, 160),
			source: { type: "task_message", messageId: message.id },
			createdAt: String(message.createdAt),
			metadata: {
				...taskMessageMetadata(message),
				...planModeWorkspaceInitialTabMetadata(message),
			},
		});
	}
	if (run?.diffPatch?.trim())
		refs.push(
			runFieldRef(input.task.id, run, "diff", "Code Diff", "diffPatch"),
		);
	if (run?.testResults)
		refs.push(
			runFieldRef(
				input.task.id,
				run,
				"test_result",
				"Test Result",
				"testResults",
			),
		);
	for (const review of input.reviews || []) {
		refs.push({
			id: `review-${review.id}`,
			taskId: input.task.id,
			runId: review.runId,
			kind: "review_result",
			title: `Review: ${review.verdict}`,
			summary: review.note || review.outcome.summary,
			source: { type: "review_result", reviewId: review.id },
			createdAt: review.createdAt,
			metadata: { review },
		});
	}
	if (input.reviewSession) {
		refs.push({
			id: `review-status-${input.reviewSession.session.id}`,
			taskId: input.task.id,
			runId: input.reviewSession.session.runId,
			kind: "review_status",
			title: "Review Status",
			summary: `${input.reviewSession.recommendation.level} · ${input.reviewSession.statusArtifact.sections.length} sections`,
			source: {
				type: "review_result",
				reviewId: input.reviewSession.session.id,
			},
			createdAt: input.reviewSession.session.updatedAt,
			metadata: { reviewSession: input.reviewSession },
		});
	}
	return refs.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

function latestTaskMessageByCreatedAt(messages: TaskMessage[]) {
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

function latestActivityArtifactByCreatedAt(artifacts: ActivityArtifact[]) {
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

function activityArtifactRef(
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

function isBlueprintActivityArtifact(artifact: ActivityArtifact): boolean {
	const metadata = activityArtifactMetadata(artifact);
	return (
		(artifact.kind === "app_blueprint" ||
			metadata.schemaName === "app_blueprint" ||
			metadata.schemaName === "mock_blueprint") &&
		!isDataModelMetadata(metadata)
	);
}

function activityArtifactMetadata(
	artifact: ActivityArtifact,
): Record<string, unknown> {
	return isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
}

function parseArtifactContentJson(content: string | null | undefined): unknown {
	if (!content?.trim()) return null;
	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
}

function taskMessageArtifactId(message: TaskMessage): string | null {
	const metadata = taskMessageMetadata(message);
	const artifactRef = isRecord(metadata.artifactRef)
		? metadata.artifactRef
		: null;
	return typeof artifactRef?.artifactId === "string"
		? artifactRef.artifactId
		: null;
}

function isMessageCoveredByActivityArtifact(
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

function runFieldRef(
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

function inferDocumentArtifactKind(
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

function isBlueprintArtifactMessage(message: TaskMessage): boolean {
	return isNormalBlueprintMessage(message);
}

function isDataModelArtifactMessage(message: TaskMessage): boolean {
	return isDataModelMessage(message);
}

function isDataModelMetadata(metadata: Record<string, unknown>): boolean {
	return (
		(metadata.artifactKind === "plan_mode_dedicated_view" &&
			metadata.view === "data_model") ||
		metadata.artifactType === "data_model" ||
		metadata.source === "data-model"
	);
}

function planModeWorkspaceInitialTabMetadata(message: TaskMessage): {
	initialTab?: string;
} {
	const metadata = taskMessageMetadata(message);
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

function isPlanModeDedicatedViewMetadata(metadata: Record<string, unknown>) {
	return (
		metadata.artifactKind === "plan_mode_dedicated_view" ||
		metadata.artifactKind === "plan_mode_api_contract" ||
		metadata.artifactKind === "plan_mode_zod_schema"
	);
}

function isPlanModeDedicatedViewMessage(message: TaskMessage) {
	const metadata = taskMessageMetadata(message);
	if (message.messageType === "markdown_document") return true;
	return (
		(message.messageType === "api_contract" &&
			String(metadata.artifactKind) === "plan_mode_api_contract") ||
		(message.messageType === "zod_schema" &&
			String(metadata.artifactKind) === "plan_mode_zod_schema")
	);
}

function hasBlueprintMetadata(metadata: Record<string, unknown>): boolean {
	return (
		metadata.intent === "app_blueprint" ||
		metadata.intent === "mock_blueprint" ||
		Boolean(metadata.appBlueprint) ||
		Boolean(metadata.mockBlueprint)
	);
}

function blueprintPayloadFromMetadata(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	if (isRecord(metadata.appBlueprint)) return metadata.appBlueprint;
	if (isRecord(metadata.mockBlueprint)) return metadata.mockBlueprint;
	return {};
}

function artifactTitleForKind(
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
