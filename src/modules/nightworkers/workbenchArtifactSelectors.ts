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
	WorkbenchArtifactRef,
} from "./types";
import {
	activityArtifactMetadata,
	activityArtifactRef,
	artifactTitleForKind,
	blueprintPayloadFromMetadata,
	hasBlueprintMetadata,
	inferDocumentArtifactKind,
	isBlueprintActivityArtifact,
	isBlueprintArtifactMessage,
	isDataModelArtifactMessage,
	isDataModelMetadata,
	isMessageCoveredByActivityArtifact,
	isPlanModeDedicatedViewMessage,
	isPlanModeDedicatedViewMetadata,
	latestActivityArtifactByCreatedAt,
	latestTaskMessageByCreatedAt,
	parseArtifactContentJson,
	planModeWorkspaceInitialTabMetadata,
	runFieldRef,
	taskMessageArtifactId,
} from "./workbenchArtifactSelectionPolicy";
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
		traceOwner: "system",
		traceChannel: "artifact",
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
	const messageIntent = String(taskMessageMetadata(message).intent || "");
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
			planModeWorkspaceSource:
				messageIntent === "design_questionnaire_starting"
					? "design_questionnaire_starting"
					: "design_questionnaire_ready",
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
	const questionnaireWorkspaceMessages = (input.messages || []).filter(
		(message) => {
			const intent = String(taskMessageMetadata(message).intent || "");
			return (
				intent === "design_questionnaire_starting" ||
				intent === "design_questionnaire_ready"
			);
		},
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
		featurePlanMessages.length > 0 ||
		questionnaireWorkspaceMessages.length > 0
	) {
		const latestWorkspaceMessage = latestTaskMessageByCreatedAt([
			...questionnaireWorkspaceMessages,
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
