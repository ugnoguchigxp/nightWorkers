import { z } from "zod";
import { toDeepRecord } from "../../../shared/json-record";
import {
	type PlanModeWorkspace,
	planModeRegenerationTargetSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { shouldWaitForWorkbenchIntakeInTests } from "../../services/runtime-env";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../services/settings/general-settings";
import {
	callStructuredJsonLLM,
	type SupervisorLlmDebugEvent,
} from "../../services/structured-llm";
import { normalizeStructuredLlmModelTarget } from "../../services/structured-llm/selection";
import { generateBlueprintArtifact } from "../blueprint/blueprint-generation.service";
import { generateDataModelArtifact } from "../dataModel/dataModel-generation.service";
import { generatePlanViewArtifact } from "../planViews/planView-generation.service";
import { createDesignQuestionnaire } from "../questionnaire/questionnaire.service";
import { generateFeaturePlanArtifact } from "../specification/specification-generation.service";
import { buildSpecificationVerificationSidecar } from "../specification/specification-verification-sidecar";
import {
	assertRunnableWorkbenchTask,
	hasImplementationPlanEvidence,
} from "./nightworkers.planning-helpers.service";
import { queueTask } from "./nightworkers.queue-management.service";
import * as repo from "./nightworkers.repository";
import { startTaskRun } from "./nightworkers.run-orchestration.service";
import { createVerificationDocumentFromSpec } from "./nightworkers.verification.service";
import type { WorkbenchArtifactContext } from "./nightworkers.workbench-routing";

export async function createPlanningArtifactMessageIfNeeded(input: {
	taskId: string;
	runId: string;
	finalReport: string;
}) {
	const messages = await repo.listTaskMessages(input.taskId);
	const runStartedMessage = [...messages].reverse().find((message) => {
		const metadata = (message.metadataJson || {}) as Record<string, unknown>;
		return (
			message.role === "system" &&
			metadata.intent === "run_started" &&
			metadata.source === "workbench"
		);
	});
	const runStartedMetadata = (runStartedMessage?.metadataJson || {}) as Record<
		string,
		unknown
	>;
	const intakeJobSelection = toDeepRecord(
		runStartedMetadata.intakeJobSelection,
	);
	if (String(intakeJobSelection.jobType) !== "planning") {
		const run = await repo.getTaskRun(input.runId);
		const runContext =
			run?.contextSnapshot &&
			typeof run.contextSnapshot === "object" &&
			!Array.isArray(run.contextSnapshot)
				? (run.contextSnapshot as Record<string, unknown>)
				: {};
		if (runContext.executionMode !== "planning") return;
	}
	const alreadyPublished = messages.some((message) => {
		const metadata = (message.metadataJson || {}) as Record<string, unknown>;
		return (
			message.messageType === "markdown_document" &&
			metadata.intent === "implementation_plan" &&
			metadata.sourceRunId === input.runId
		);
	});
	if (alreadyPublished) return;
	const message = await repo.createTaskMessage({
		taskId: input.taskId,
		runId: input.runId,
		role: "assistant",
		content: input.finalReport,
		messageType: "markdown_document",
		payloadJson: {
			intent: "implementation_plan",
			title: "Implementation Plan",
			source: "workbench-planning-run",
			sourceRunId: input.runId,
			routingHypothesis: runStartedMetadata.routingHypothesis,
			intakeJobSelection,
			markdownDocumentData: {
				title: "Implementation Plan",
				content: input.finalReport,
			},
		},
	});
	if (!message) return;
	await attachImplementationPlanVerificationMetadata({
		taskId: input.taskId,
		runId: input.runId,
		specMessageId: message.id,
		finalReport: input.finalReport,
		sourceMessageIds: [...messages.map((item) => item.id), message.id],
		baseMetadata: toDeepRecord(message.metadataJson),
	});
}

async function attachImplementationPlanVerificationMetadata(input: {
	taskId: string;
	runId: string;
	specMessageId: string;
	finalReport: string;
	sourceMessageIds: string[];
	baseMetadata: Record<string, unknown>;
}) {
	const task = await repo.getTask(input.taskId);
	if (!task) throw new NotFoundError("Task not found");
	const generatedAt = new Date().toISOString();
	const workspace = buildImplementationPlanVerificationWorkspace({
		taskId: input.taskId,
		repositoryId: task.repositoryId,
		generatedAt,
		specMessageId: input.specMessageId,
	});
	const sidecar = buildSpecificationVerificationSidecar({
		taskId: input.taskId,
		specId: input.specMessageId,
		specPath: "spec/implementation-plan.md",
		content: input.finalReport,
		sourceMessageIds: input.sourceMessageIds,
		workspace,
		generatedAt,
	});
	const verificationMessage = await repo.createTaskMessage({
		taskId: input.taskId,
		runId: input.runId,
		role: "assistant",
		content: JSON.stringify(sidecar.document, null, 2),
		messageType: "verification_json",
		payloadJson: {
			intent: "implementation_plan_verification",
			artifactKind: "verification_json",
			title: "Implementation Plan Verification",
			sourceImplementationPlanMessageId: input.specMessageId,
			verificationDocument: sidecar.document,
		},
	});
	const verificationArtifactId = verificationMessage
		? `verification-json-${verificationMessage.id}`
		: null;
	const verificationDocument = await createVerificationDocumentFromSpec({
		taskId: input.taskId,
		runId: input.runId,
		specMessageId: input.specMessageId,
		specArtifactId: `implementation-plan-${input.specMessageId}`,
		verificationArtifactId,
		sourceSpecPath: sidecar.document.specPath,
		document: sidecar.document,
	});
	await repo.updateTaskMessageMetadata(input.specMessageId, {
		...input.baseMetadata,
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId,
		verificationSidecarMessageId: verificationMessage?.id ?? null,
		markdownDocumentData: {
			...toDeepRecord(input.baseMetadata.markdownDocumentData),
			verificationDocumentId: verificationDocument.id,
		},
	});
	if (!verificationMessage) return;
	await repo.updateTaskMessageMetadata(verificationMessage.id, {
		...toDeepRecord(verificationMessage.metadataJson),
		verificationDocumentId: verificationDocument.id,
		verificationArtifactId,
		sourceImplementationPlanMessageId: input.specMessageId,
	});
}

function buildImplementationPlanVerificationWorkspace(input: {
	taskId: string;
	repositoryId: string;
	generatedAt: string;
	specMessageId: string;
}): PlanModeWorkspace {
	return {
		taskId: input.taskId,
		repositoryId: input.repositoryId,
		generatedAt: input.generatedAt,
		featurePlanArtifacts: [],
		blueprintArtifacts: [],
		dataModelArtifacts: [],
		dedicatedViewArtifacts: [],
		questionnaireSessions: [],
		decisionReviews: [],
		viewDecisions: [],
		implementationReferences: [
			{
				id: `implementation-plan-${input.specMessageId}`,
				kind: "implementation_reference",
				title: "Implementation Plan",
				sourceMessageId: input.specMessageId,
				taskId: input.taskId,
			},
		],
	};
}

export async function appendTaskMessage(
	id: string,
	prompt: string,
	metadata?: Record<string, unknown>,
) {
	const task = await repo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	const trimmed = prompt.trim();
	if (!trimmed)
		throw new AppError(400, "EMPTY_PROMPT", "Prompt must not be empty");
	const existingMessages = await repo.listTaskMessages(id);
	const hasAnyUserMessage = existingMessages.some(
		(message) => message.role === "user",
	);
	await repo.createTaskMessage({
		taskId: id,
		role: "user",
		content: trimmed,
		messageType: "text",
		payloadJson: metadata,
	});
	if (task.title === "New Session" && !hasAnyUserMessage) {
		const firstPromptTitle = trimmed.replace(/\s+/g, " ").slice(0, 40);
		await repo.updateTask(id, { title: firstPromptTitle });
	}
	const latestTask = await repo.getTask(id);
	if (!latestTask) throw new NotFoundError("Task not found");
	return latestTask;
}

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

export async function appendWorkbenchMessage(
	id: string,
	input: {
		prompt: string;
		intent?: WorkbenchChatIntent;
		waitForIntake?: boolean;
		artifactContext?: WorkbenchArtifactContext | null;
		providerEndpointId?: string;
		model?: string;
		thinkingDepth?: "low" | "medium" | "high" | "very_high";
	},
) {
	const intent = input.intent || "intake";
	const task = await repo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	const prompt = input.prompt.trim();
	if (!prompt)
		throw new AppError(400, "EMPTY_PROMPT", "Prompt must not be empty");
	const artifactContext = input.artifactContext || null;
	const llmSelection =
		input.model || input.providerEndpointId || input.thinkingDepth
			? {
					model: input.model || null,
					providerEndpointId: input.providerEndpointId || null,
					thinkingDepth: input.thinkingDepth || null,
				}
			: null;
	const llmRouteOverride = normalizeStructuredLlmModelTarget(llmSelection);
	const existingMessages = await repo.listTaskMessages(id);
	const messageMetadata =
		artifactContext || llmSelection
			? {
					...(artifactContext
						? { intent: "artifact_context_instruction", artifactContext }
						: {}),
					source: "workbench",
					...(llmSelection ? { llmSelection } : {}),
				}
			: undefined;

	if (intent === "run_task") {
		assertRunnableWorkbenchTask(task, existingMessages);
		await appendTaskMessage(id, prompt, messageMetadata);
		const run = await startTaskRun(id, {
			executionMode: "implementation",
			executionModeSource: "workbench_run_task",
			routeOverride: llmRouteOverride,
		});
		return {
			task: await repo.getTask(id),
			run,
			messages: await repo.listTaskMessages(id),
		};
	}

	if (intent === "design_blueprint_data") {
		await appendTaskMessage(id, prompt, messageMetadata);
		await generateDataModelArtifact(id, {
			prompt,
			routeOverride: llmRouteOverride,
		});
		const updated = await repo.updateTask(id, {
			objective: task.objective || prompt,
			status: task.status === "draft" ? "ready" : task.status,
		});
		return {
			task: updated,
			run: null,
			messages: await repo.listTaskMessages(id),
		};
	}

	if (
		intent === "intake" &&
		isPlanModeArtifactRegenerationContext(artifactContext)
	) {
		await appendTaskMessage(id, prompt, messageMetadata);
		const result = await regeneratePlanModeArtifactFromWorkbenchContext(
			id,
			prompt,
			artifactContext,
			llmRouteOverride,
		);
		return {
			task: (await repo.getTask(id)) || task,
			run: null,
			messages: await repo.listTaskMessages(id),
			workspace: result.workspace,
		};
	}

	await appendTaskMessage(id, prompt, messageMetadata);

	if (intent === "queue" || intent === "create_task") {
		const queued = await queueTask(id);
		return {
			task: queued,
			run: null,
			messages: await repo.listTaskMessages(id),
		};
	}

	const waitForIntake =
		input.waitForIntake ?? shouldWaitForWorkbenchIntakeInTests();
	if (waitForIntake) {
		return handleWorkbenchIntakeMessage(id, task, prompt, {
			failureMode: "throw",
			intent,
			artifactContext,
			llmRouteOverride,
		});
	}

	const updated = await prepareWorkbenchIntakeTask(id, task, prompt);
	void handleWorkbenchIntakeMessage(id, task, prompt, {
		failureMode: "record",
		intent,
		artifactContext,
		llmRouteOverride,
	});
	return {
		task: updated,
		run: null,
		messages: await repo.listTaskMessages(id),
	};
}

export async function resumeWorkbenchIntakeMessage(
	id: string,
	prompt: string,
	options?: { waitForIntake?: boolean },
) {
	const task = await repo.getTask(id);
	if (!task) throw new NotFoundError("Task not found");
	const waitForIntake =
		options?.waitForIntake ?? shouldWaitForWorkbenchIntakeInTests();
	if (waitForIntake) {
		return handleWorkbenchIntakeMessage(id, task, prompt, {
			failureMode: "throw",
			intent: "intake",
			artifactContext: null,
			llmRouteOverride: null,
		});
	}
	const updated = await prepareWorkbenchIntakeTask(id, task, prompt);
	void handleWorkbenchIntakeMessage(id, task, prompt, {
		failureMode: "record",
		intent: "intake",
		artifactContext: null,
		llmRouteOverride: null,
	});
	return {
		task: updated,
		run: null,
		messages: await repo.listTaskMessages(id),
	};
}

function renderArtifactContextualPrompt(
	prompt: string,
	artifactContext: WorkbenchArtifactContext | null,
) {
	if (!artifactContext) return prompt;
	const metadata = artifactContext.metadata || {};
	const sourceParts = [
		artifactContext.source?.type
			? `sourceType=${artifactContext.source.type}`
			: null,
		artifactContext.source?.messageId
			? `messageId=${artifactContext.source.messageId}`
			: null,
		artifactContext.source?.artifactId
			? `artifactId=${artifactContext.source.artifactId}`
			: null,
	].filter(Boolean);
	return [
		"[Current Artifact Context]",
		"ユーザーは現在この Artifact を見ながら左側のチャット欄で指示しています。",
		"指示が「この画面」「これ」「今の artifact」を参照する場合は、この Artifact への修正指示として扱ってください。",
		"ただし、ユーザー本文で別対象が明示された場合はユーザー本文を優先してください。",
		`Artifact: ${artifactContext.title}`,
		`Kind: ${artifactContext.kind}`,
		sourceParts.length ? `Source: ${sourceParts.join(", ")}` : null,
		metadata.intent ? `Intent: ${metadata.intent}` : null,
		metadata.artifactType ? `Artifact type: ${metadata.artifactType}` : null,
		metadata.appBlueprintName
			? `Blueprint: ${metadata.appBlueprintName}`
			: null,
		metadata.initialTab ? `Workspace tab: ${metadata.initialTab}` : null,
		metadata.instructionMode
			? `Instruction mode: ${metadata.instructionMode}`
			: null,
		metadata.planModeTarget
			? `Plan Mode target: ${metadata.planModeTarget}`
			: null,
		metadata.screenNames?.length
			? `Screens: ${metadata.screenNames.join(", ")}`
			: null,
		metadata.sectionNames?.length
			? `Sections: ${metadata.sectionNames.join(", ")}`
			: null,
		metadata.tableNames?.length
			? `Tables: ${metadata.tableNames.join(", ")}`
			: null,
		artifactContext.summary ? `Summary: ${artifactContext.summary}` : null,
		"",
		"[User Instruction]",
		prompt,
	]
		.filter((line): line is string => line !== null && line !== undefined)
		.join("\n");
}

function isPlanModeArtifactRegenerationContext(
	artifactContext: WorkbenchArtifactContext | null,
): artifactContext is WorkbenchArtifactContext {
	const target = artifactContext?.metadata?.planModeTarget;
	return (
		artifactContext?.kind === "plan_mode_workspace" &&
		artifactContext.metadata?.instructionMode === "regenerate_artifact" &&
		planModeRegenerationTargetSchema.safeParse(target).success
	);
}

async function regeneratePlanModeArtifactFromWorkbenchContext(
	taskId: string,
	prompt: string,
	artifactContext: WorkbenchArtifactContext,
	routeOverride: ReturnType<typeof normalizeStructuredLlmModelTarget>,
) {
	const metadata = artifactContext.metadata || {};
	const questionnaireSessionId = metadata.questionnaireSessionId ?? null;
	const featurePlanMessageId = metadata.featurePlanMessageId ?? null;
	const sourceBlueprintMessageId = metadata.sourceBlueprintMessageId ?? null;
	const sourceDataModelMessageId = metadata.sourceDataModelMessageId ?? null;
	const target = planModeRegenerationTargetSchema.parse(
		metadata.planModeTarget,
	);
	switch (target) {
		case "feature_plan":
			return generateFeaturePlanArtifact(taskId, {
				prompt,
				questionnaireSessionId,
				sourceBlueprintMessageId,
				routeOverride,
			});
		case "blueprint":
			return generateBlueprintArtifact(taskId, {
				prompt,
				questionnaireSessionId,
				sourceBlueprintMessageId,
				routeOverride,
			});
		case "data_model":
			return generateDataModelArtifact(taskId, {
				prompt,
				questionnaireSessionId,
				featurePlanMessageId,
				sourceBlueprintMessageId,
				routeOverride,
			});
		case "user_flow":
		case "api_io_contract":
		case "activity_flow":
		case "sequence_flow":
		case "zod_schema_design":
			return generatePlanViewArtifact(taskId, target, {
				prompt,
				questionnaireSessionId,
				featurePlanMessageId,
				sourceBlueprintMessageId,
				sourceDataModelMessageId,
				routeOverride,
			});
		default:
			throw new AppError(
				400,
				"UNSUPPORTED_PLAN_MODE_REGENERATION_TARGET",
				`Unsupported Plan Mode regeneration target: ${String(target || "")}`,
			);
	}
}

const workbenchPlanModeGateSchema = z
	.object({
		shouldStartPlanMode: z.boolean(),
		action: z
			.enum(["plan_mode", "general_answer", "implementation", "review"])
			.optional(),
		reason: z.string().min(1),
		dedicatedViews: z
			.array(
				z
					.object({
						view: z.enum([
							"questionnaire",
							"user_flow",
							"blueprint",
							"data_model",
							"api_io_contract",
							"activity_flow",
							"sequence_flow",
							"zod_schema_design",
						]),
						decision: z.enum(["include", "omit"]),
						reason: z.string().min(1),
					})
					.strict(),
			)
			.default([]),
		specificationLenses: z
			.array(
				z.enum([
					"target_users_or_actors",
					"functional_requirements",
					"business_rules",
					"input_output",
					"interface_contract",
					"data_requirements",
					"state_behavior",
					"workflow_behavior",
					"error_behavior",
					"permission_boundary",
					"compatibility",
					"observability",
				]),
			)
			.default([]),
	})
	.strict();

type WorkbenchPlanModeGate = z.infer<typeof workbenchPlanModeGateSchema> & {
	action: "plan_mode" | "general_answer" | "implementation" | "review";
};

async function ensureDesignQuestionnaireReadyMessage(input: {
	taskId: string;
	questionnaireSession: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
	planModeGate: WorkbenchPlanModeGate & Record<string, unknown>;
	planModeSettingsSnapshot: ReturnType<typeof buildPlanModeSettingsSnapshot>;
	source: "workbench" | "mission_pilot";
}) {
	const messages = await repo.listTaskMessages(input.taskId);
	const existing = messages.find((message) => {
		const metadata = toRecord(message.metadataJson);
		const planModeGate = toRecord(metadata?.planModeGate);
		return (
			metadata?.intent === "design_questionnaire_ready" &&
			metadata.questionnaireSessionId === input.questionnaireSession.id &&
			Array.isArray(planModeGate?.dedicatedViews)
		);
	});
	if (existing) return existing;
	const totalQuestionCount = input.questionnaireSession.questionSets.reduce(
		(total, set) =>
			total +
			(set.questionnaire?.questionSets || []).reduce(
				(setTotal, questionSet) => setTotal + questionSet.questions.length,
				0,
			),
		0,
	);
	return repo.createTaskMessage({
		taskId: input.taskId,
		role: "system",
		content: `Design Questionnaire を生成しました。${totalQuestionCount} 件の質問に回答できます。`,
		messageType: "text",
		payloadJson: {
			intent: "design_questionnaire_ready",
			source: input.source,
			questionnaireSessionId: input.questionnaireSession.id,
			questionnaireStatus: input.questionnaireSession.status,
			totalQuestionCount,
			planModeGate: input.planModeGate,
			planModeSettingsSnapshot: input.planModeSettingsSnapshot,
		},
	});
}

export async function prepareMissionPilotPlanModeIntake(input: {
	taskId: string;
	prompt: string;
	questionnaireSession?: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
}) {
	const task = await repo.getTask(input.taskId);
	if (!task) throw new NotFoundError("Task not found");
	const repository = await repo.getRepository(task.repositoryId);
	const projectRoot = repository?.localPath || process.cwd();
	const messages = await repo.listTaskMessages(input.taskId);
	const originalGate = await decideWorkbenchPlanModeGate({
		projectRoot,
		prompt: input.prompt,
		task,
		messages,
		runs: await repo.listTaskRunsForTask(input.taskId),
		routeOverride: null,
		emitEvent: createWorkbenchLlmDebugEventEmitter(input.taskId),
		taskId: input.taskId,
	});
	const planModeGate = {
		...originalGate,
		shouldStartPlanMode: true,
		action: "plan_mode" as const,
		reason: "Mission Pilotのpre-Queue計画としてPlan Modeを開始します。",
		originalGate,
	};
	const planModeSettingsSnapshot = buildPlanModeSettingsSnapshot(
		readGeneralSettings(),
	);
	if (!planModeSettingsSnapshot.capabilities.questionnaire) {
		throw new AppError(
			409,
			"MISSION_PILOT_QUESTIONNAIRE_DISABLED",
			"Mission PilotのPlan ModeにはQuestionnaire capabilityが必要です。",
		);
	}
	const questionnaireSession =
		input.questionnaireSession ??
		(await createDesignQuestionnaire(input.taskId, null, input.prompt));
	await ensureDesignQuestionnaireReadyMessage({
		taskId: input.taskId,
		questionnaireSession,
		planModeGate,
		planModeSettingsSnapshot,
		source: "mission_pilot",
	});
	return questionnaireSession;
}

async function decideWorkbenchPlanModeGate(input: {
	projectRoot: string;
	prompt: string;
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>;
	runs: Awaited<ReturnType<typeof repo.listTaskRunsForTask>>;
	routeOverride: ReturnType<typeof normalizeStructuredLlmModelTarget> | null;
	emitEvent: (event: SupervisorLlmDebugEvent) => void | Promise<void>;
	taskId: string;
}): Promise<WorkbenchPlanModeGate> {
	const raw = await callStructuredJsonLLM(
		buildWorkbenchPlanModeGatePrompt(input.projectRoot),
		buildWorkbenchPlanModeGateUserPrompt(input),
		{
			schemaName: "workbench_plan_mode_gate",
			schema: {
				type: "object",
				required: [
					"shouldStartPlanMode",
					"action",
					"reason",
					"dedicatedViews",
					"specificationLenses",
				],
				additionalProperties: false,
				properties: {
					shouldStartPlanMode: { type: "boolean" },
					action: {
						type: "string",
						enum: ["plan_mode", "general_answer", "implementation", "review"],
					},
					reason: { type: "string" },
					dedicatedViews: {
						type: "array",
						items: {
							type: "object",
							required: ["view", "decision", "reason"],
							additionalProperties: false,
							properties: {
								view: {
									type: "string",
									enum: [
										"questionnaire",
										"user_flow",
										"blueprint",
										"data_model",
										"api_io_contract",
										"activity_flow",
										"sequence_flow",
										"zod_schema_design",
									],
								},
								decision: { type: "string", enum: ["include", "omit"] },
								reason: { type: "string" },
							},
						},
					},
					specificationLenses: {
						type: "array",
						items: {
							type: "string",
							enum: [
								"target_users_or_actors",
								"functional_requirements",
								"business_rules",
								"input_output",
								"interface_contract",
								"data_requirements",
								"state_behavior",
								"workflow_behavior",
								"error_behavior",
								"permission_boundary",
								"compatibility",
								"observability",
							],
						},
					},
				},
			},
			role: "plan",
			routeOverride: input.routeOverride,
			tolerateSchemaFailure: false,
			emitEvent: input.emitEvent,
			workingDirectory: input.projectRoot,
			taskId: input.taskId,
			runId: null,
		},
	);
	const parsed = workbenchPlanModeGateSchema.parse(JSON.parse(raw));
	return {
		...parsed,
		action: parsed.shouldStartPlanMode
			? "plan_mode"
			: (parsed.action ?? "implementation"),
	};
}

function buildWorkbenchPlanModeGatePrompt(projectRoot: string) {
	return [
		"Workbench intake で次の処理を1つだけ判定してください。",
		"現在のユーザー文だけでなく、提示された Task context / Recent conversation / Latest non-general run を判断材料にしてください。",
		"jobType、作業種別、難易度、実装規模、レビュー種別、調査種別は分類しないでください。",
		"shouldStartPlanMode は、ユーザーが計画、実装計画、設計方針、仕様策定、質問票化、Blueprint など、実装前の計画作成を依頼している、または Task context 上で Plan Mode で確認する論点が明示されていて現在の依頼がその開始に該当する場合に true にしてください。",
		'質問、確認、説明依頼、状態確認は shouldStartPlanMode=false かつ action="general_answer" にしてください。',
		'ただし、直前の可否回答や状態確認に続いてユーザーが作業の続行、再開、実行を求めている場合は状態確認ではありません。Latest non-general run があればその executionMode を優先し、なければ action="implementation" にしてください。',
		'修正、実装、設定変更、依存更新、リファクタは shouldStartPlanMode=false かつ action="implementation" にしてください。',
		'コードレビュー、差分レビュー、品質レビューは shouldStartPlanMode=false かつ action="review" にしてください。',
		'ログ確認、原因調査、実行時状態の確認は shouldStartPlanMode=false かつ action="general_answer" にしてください。',
		'テスト実行や検証依頼は shouldStartPlanMode=false かつ action="review" にしてください。',
		"完了済みの Plan Mode artifact は証跡として扱い、後続の質問や変更依頼で再編集対象にしないでください。",
		"既に implementation_plan / feature_plan があり、現在の依頼が実装・修正・実行キュー投入なら Plan Mode を再起動しないでください。",
		"Plan View は Plan Mode の表示メニュー用です。UI 変更がない場合は blueprint を omit、DB/永続化 schema 変更がない場合は data_model を omit してください。API 契約が主題の場合は api_io_contract を include し、OpenAPI 互換 API contract に寄せてください。",
		"API 経由で観測・変更できる state と HTTP request / response / error validation は api_io_contract に統合し、zod_schema_design を重複 include しないでください。",
		"zod_schema_design は LLM JSON、MCP / worker tool input、provider adapter、local config など OpenAPI endpoint に属さない validation contract が主題の場合だけ include してください。",
		"user_flow / activity_flow / sequence_flow は Mermaid 図として価値がある場合だけ include し、文章説明で足りる場合は omit して spec に任せてください。",
		'判断に迷う場合は shouldStartPlanMode=false かつ action="general_answer" にしてください。',
		"JSON のみを返してください。",
		"",
		`プロジェクトルート: ${projectRoot}`,
		"",
		"[Output Schema]",
		'{ "shouldStartPlanMode": boolean, "action": "plan_mode" | "general_answer" | "implementation" | "review", "reason": "short reason", "dedicatedViews": [{ "view": "questionnaire|user_flow|blueprint|data_model|api_io_contract|activity_flow|sequence_flow|zod_schema_design", "decision": "include|omit", "reason": "short reason" }], "specificationLenses": ["target_users_or_actors|functional_requirements|business_rules|input_output|interface_contract|data_requirements|state_behavior|workflow_behavior|error_behavior|permission_boundary|compatibility|observability"] }',
	].join("\n");
}

function buildWorkbenchPlanModeGateUserPrompt(input: {
	prompt: string;
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>;
	runs: Awaited<ReturnType<typeof repo.listTaskRunsForTask>>;
}) {
	const recentMessages = input.messages.slice(-6).map((message) => {
		const metadata = toRecord(message.metadataJson);
		const intent =
			typeof metadata?.intent === "string" ? ` intent=${metadata.intent}` : "";
		return `- ${message.role}${intent}: ${compactForGatePrompt(message.content, 360)}`;
	});
	const latestNonGeneralRun = input.runs.find((run) => {
		const executionMode = readRunExecutionMode(run.contextSnapshot);
		return executionMode && executionMode !== "general_answer";
	});
	const latestRun = input.runs[0];
	const latestRunExecutionMode = latestRun
		? readRunExecutionMode(latestRun.contextSnapshot)
		: null;
	const latestNonGeneralRunExecutionMode = latestNonGeneralRun
		? readRunExecutionMode(latestNonGeneralRun.contextSnapshot)
		: null;
	const latestRunLines = latestRun
		? [
				`Latest run: status=${latestRun.status}`,
				latestRunExecutionMode
					? `Latest run executionMode=${latestRunExecutionMode}`
					: null,
				latestRun.summary
					? `Latest run summary=${compactForGatePrompt(latestRun.summary, 180)}`
					: null,
			].filter((line): line is string => Boolean(line))
		: ["Latest run: none"];
	const latestNonGeneralRunLines = latestNonGeneralRun
		? [
				`Latest non-general run: status=${latestNonGeneralRun.status}`,
				`Latest non-general run executionMode=${latestNonGeneralRunExecutionMode}`,
				latestNonGeneralRun.summary
					? `Latest non-general run summary=${compactForGatePrompt(
							latestNonGeneralRun.summary,
							180,
						)}`
					: null,
			].filter((line): line is string => Boolean(line))
		: ["Latest non-general run: none"];

	return [
		"[Task Context]",
		`Task status: ${input.task.status}`,
		`Task title: ${compactForGatePrompt(input.task.title, 180)}`,
		input.task.objective
			? `Task objective: ${compactForGatePrompt(input.task.objective, 240)}`
			: null,
		...latestRunLines,
		...latestNonGeneralRunLines,
		"",
		"[Recent Conversation]",
		recentMessages.length ? recentMessages.join("\n") : "- none",
		"",
		"[Current User Message]",
		input.prompt,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

function readRunExecutionMode(value: unknown) {
	const context = toRecord(value);
	const executionMode = context?.executionMode;
	if (
		executionMode === "planning" ||
		executionMode === "implementation" ||
		executionMode === "review" ||
		executionMode === "general_answer"
	) {
		return executionMode;
	}
	return null;
}

function compactForGatePrompt(value: string, maxLength: number) {
	const compacted = value.replace(/\s+/g, " ").trim();
	if (compacted.length <= maxLength) return compacted;
	return `${compacted.slice(0, maxLength - 1)}…`;
}

function toRecord(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

async function handleWorkbenchIntakeMessage(
	taskId: string,
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
	prompt: string,
	options: {
		failureMode: "throw" | "record";
		intent?: WorkbenchChatIntent;
		artifactContext?: WorkbenchArtifactContext | null;
		llmRouteOverride?: ReturnType<typeof normalizeStructuredLlmModelTarget>;
	} = {
		failureMode: "throw",
	},
) {
	const title =
		task.title === "New Session"
			? prompt.replace(/\s+/g, " ").slice(0, 60)
			: task.title;
	const repository = await repo.getRepository(task.repositoryId);
	const projectRoot = repository?.localPath || process.cwd();
	const emitWorkbenchLlmDebugEvent =
		createWorkbenchLlmDebugEventEmitter(taskId);
	const llmPrompt = renderArtifactContextualPrompt(
		prompt,
		options.artifactContext || null,
	);

	try {
		const messages = await repo.listTaskMessages(taskId);
		const planModeGate = await decideWorkbenchPlanModeGate({
			projectRoot,
			prompt: llmPrompt,
			task,
			messages,
			runs: await repo.listTaskRunsForTask(taskId),
			routeOverride: options.llmRouteOverride || null,
			emitEvent: emitWorkbenchLlmDebugEvent,
			taskId,
		});
		const effectivePlanModeGate = shouldPreferPlanModeForProjectEvaluationTask(
			task,
			messages,
		)
			? {
					...planModeGate,
					shouldStartPlanMode: true,
					action: "plan_mode" as const,
					reason:
						"Project Evaluation improvement tasks start in Needs Plan until an implementation plan exists.",
					originalGate: planModeGate,
				}
			: planModeGate;
		const planModeSettingsSnapshot = buildPlanModeSettingsSnapshot(
			readGeneralSettings(),
		);
		if (
			effectivePlanModeGate.shouldStartPlanMode ||
			effectivePlanModeGate.action === "plan_mode"
		) {
			if (!planModeSettingsSnapshot.capabilities.questionnaire) {
				const runnable = await repo.updateTask(taskId, {
					title,
					objective: task.objective || prompt,
					acceptanceCriteria: task.acceptanceCriteria || prompt,
					status: "ready",
				});
				await repo.createTaskMessage({
					taskId,
					role: "system",
					content:
						"Planning run started from Workbench intake because Questionnaire is disabled.",
					messageType: "text",
					payloadJson: {
						intent: "run_started",
						source: "workbench",
						executionMode: "planning",
						planModeGate: effectivePlanModeGate,
						planModeSettingsSnapshot,
					},
				});
				const run = await startTaskRun(taskId, {
					executionMode: "planning",
					executionModeSource: "workbench_intake",
					routeOverride: options.llmRouteOverride || null,
				});
				return {
					task: (await repo.getTask(taskId)) || runnable,
					run,
					messages: await repo.listTaskMessages(taskId),
				};
			}
			const questionnaireSession = await createDesignQuestionnaire(
				taskId,
				null,
				llmPrompt,
				{
					routeOverride: options.llmRouteOverride || null,
				},
			);
			await ensureDesignQuestionnaireReadyMessage({
				taskId,
				questionnaireSession,
				planModeGate: effectivePlanModeGate,
				planModeSettingsSnapshot,
				source: "workbench",
			});
		} else if ((options.intent || "intake") === "intake") {
			const executionMode = effectivePlanModeGate.action;
			const runnable = await repo.updateTask(taskId, {
				title,
				objective: task.objective || prompt,
				acceptanceCriteria: task.acceptanceCriteria || prompt,
				status: "ready",
			});
			await repo.createTaskMessage({
				taskId,
				role: "system",
				content: workbenchRunStartedMessage(executionMode),
				messageType: "text",
				payloadJson: {
					intent: "run_started",
					source: "workbench",
					executionMode,
					planModeGate: effectivePlanModeGate,
					planModeSettingsSnapshot,
				},
			});
			const run = await startTaskRun(taskId, {
				executionMode,
				executionModeSource: "workbench_intake",
				routeOverride: options.llmRouteOverride || null,
			});
			return {
				task: (await repo.getTask(taskId)) || runnable,
				run,
				messages: await repo.listTaskMessages(taskId),
			};
		}
		const updated = await repo.updateTask(taskId, {
			title,
			objective: task.objective || prompt,
			acceptanceCriteria: task.acceptanceCriteria,
			status: task.status,
		});
		return {
			task: updated,
			run: null,
			messages: await repo.listTaskMessages(taskId),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const updated = await repo.updateTask(taskId, {
			title,
			objective: task.objective || prompt,
		});
		if (options.failureMode === "record") {
			await repo.createTaskMessage({
				taskId,
				role: "system",
				content: `LLM intake failed: ${message}`,
				messageType: "text",
				payloadJson: {
					intent: "intake_failed",
					source: "workbench",
					error: message,
				},
			});
			return {
				task: updated,
				run: null,
				messages: await repo.listTaskMessages(taskId),
			};
		}
		if (error instanceof AppError) throw error;
		throw new AppError(
			502,
			"LLM_RESPONSE_REQUIRED",
			`LLM response is required but generation failed: ${message}`,
			{ task: updated },
		);
	}
}

function shouldPreferPlanModeForProjectEvaluationTask(
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>,
) {
	return (
		task.createdBy === "project-evaluation" &&
		!hasImplementationPlanEvidence(messages)
	);
}

function workbenchRunStartedMessage(
	executionMode: "general_answer" | "implementation" | "review",
) {
	if (executionMode === "general_answer")
		return "General answer run started from Workbench intake.";
	if (executionMode === "review")
		return "Review run started from Workbench intake.";
	return "Implementation run started from Workbench intake.";
}

function createWorkbenchLlmDebugEventEmitter(taskId: string) {
	return async (event: SupervisorLlmDebugEvent) => {
		if (event.type !== "model.response_delta") return;
		const text =
			typeof event.data?.text === "string" ? event.data.text : event.message;
		if (!text) return;
		nightWorkersRealtimeBroker.publish(taskId, {
			type: "task_llm_delta",
			payload: {
				text,
				event,
			},
		});
	};
}

async function prepareWorkbenchIntakeTask(
	taskId: string,
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>,
	prompt: string,
) {
	const title =
		task.title === "New Session"
			? prompt.replace(/\s+/g, " ").slice(0, 60)
			: task.title;
	const updated = await repo.updateTask(taskId, {
		title,
		objective: task.objective || prompt,
	});
	return updated;
}
