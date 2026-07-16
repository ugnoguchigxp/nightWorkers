import { z } from "zod";
import { planModeRegenerationTargetSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { AppError } from "../../lib/errors";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../services/settings/general-settings";
import { callStructuredOutputWithRepair } from "../../services/structured-generation/structured-output-repair.service";
import {
	createStructuredOutputContract,
	type SupervisorLlmDebugEvent,
} from "../../services/structured-llm";
import type { normalizeStructuredLlmModelTarget } from "../../services/structured-llm/selection";
import type { StructuredLlmRole } from "../../services/structured-llm/settings";
import { hasImplementationPlanEvidence } from "./nightworkers.planning-helpers.service";
import * as repo from "./nightworkers.repository";
import { startTaskRun } from "./nightworkers.run-orchestration.service";
import type { WorkbenchArtifactContext } from "./nightworkers.workbench-routing";

export type { WorkbenchChatIntent } from "./nightworkers.workbench-message.service";
export {
	appendAssistantTaskMessage,
	appendTaskMessage,
	appendWorkbenchMessage,
	createPlanningArtifactMessageIfNeeded,
	resumeWorkbenchIntakeMessage,
} from "./nightworkers.workbench-message.service";

import type { WorkbenchChatIntent } from "./nightworkers.workbench-message.service";

export {
	ensureDesignQuestionnaireReadyMessage,
	ensureMissionPilotAgentQuestionnaireReadyMessage,
	prepareMissionPilotPlanModeIntake,
} from "./nightworkers.workbench-plan-intake.service";

import { workbenchRunStartedMessage } from "./nightworkers-workbench-intake-support";

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
export function isPlanModeArtifactRegenerationContext(
	artifactContext: WorkbenchArtifactContext | null,
): artifactContext is WorkbenchArtifactContext {
	const target = artifactContext?.metadata?.planModeTarget;
	return (
		artifactContext?.kind === "plan_mode_workspace" &&
		artifactContext.metadata?.instructionMode === "regenerate_artifact" &&
		planModeRegenerationTargetSchema.safeParse(target).success
	);
}
const workbenchPlanModeGateSchema = z
	.object({
		shouldStartPlanMode: z.boolean(),
		action: z.enum(["plan_mode", "general_answer", "implementation", "review"]),
		reason: z.string().min(1),
		dedicatedViews: z.array(
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
		),
		specificationLenses: z.array(
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
		),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.shouldStartPlanMode === (value.action === "plan_mode")) return;
		context.addIssue({
			code: "custom",
			path: ["action"],
			message:
				"shouldStartPlanMode and action must describe the same decision.",
		});
	});
export type WorkbenchPlanModeGate = z.infer<
	typeof workbenchPlanModeGateSchema
> & {
	action: "plan_mode" | "general_answer" | "implementation" | "review";
};
export async function decideWorkbenchPlanModeGate(input: {
	projectRoot: string;
	prompt: string;
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	messages: Awaited<ReturnType<typeof repo.listTaskMessages>>;
	runs: Awaited<ReturnType<typeof repo.listTaskRunsForTask>>;
	routeOverride: ReturnType<typeof normalizeStructuredLlmModelTarget> | null;
	emitEvent: (event: SupervisorLlmDebugEvent) => void | Promise<void>;
	taskId: string;
	role?: StructuredLlmRole;
	usageTrace?: TraceProvenance;
}): Promise<WorkbenchPlanModeGate> {
	const generated = await callStructuredOutputWithRepair({
		systemPrompt: buildWorkbenchPlanModeGatePrompt(input.projectRoot),
		userPrompt: buildWorkbenchPlanModeGateUserPrompt(input),
		options: {
			contract: createStructuredOutputContract({
				name: "workbench_plan_mode_gate",
				runtimeSchema: workbenchPlanModeGateSchema,
			}),
			role: input.role ?? "plan",
			usageTrace: input.usageTrace,
			routeOverride: input.routeOverride,
			tolerateSchemaFailure: false,
			emitEvent: input.emitEvent,
			workingDirectory: input.projectRoot,
			taskId: input.taskId,
			runId: null,
		},
	});
	return {
		...generated.value,
		dedicatedViews: [],
		specificationLenses: [],
	};
}

export function buildWorkbenchPlanModeGatePrompt(projectRoot: string) {
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
		"このintake gateはPlan Modeへ入るかだけを判断します。Questionnaire、Blueprint、Data Model、各Dedicated Viewの必要性を選択・提案しないでください。",
		"dedicatedViewsとspecificationLensesは必ず空配列にしてください。設計Artifactのroutingと入力要求は、Plan Modeへ入った後にCoding AgentがTaskとrepositoryを読んで判断します。",
		'判断に迷う場合は shouldStartPlanMode=false かつ action="general_answer" にしてください。',
		"JSON のみを返してください。",
		"",
		`プロジェクトルート: ${projectRoot}`,
		"",
		"[Output Schema]",
		'{ "shouldStartPlanMode": boolean, "action": "plan_mode" | "general_answer" | "implementation" | "review", "reason": "short reason", "dedicatedViews": [{ "view": "questionnaire|user_flow|blueprint|data_model|api_io_contract|activity_flow|sequence_flow|zod_schema_design", "decision": "include|omit", "reason": "short reason" }], "specificationLenses": ["target_users_or_actors|functional_requirements|business_rules|input_output|interface_contract|data_requirements|state_behavior|workflow_behavior|error_behavior|permission_boundary|compatibility|observability"] }',
	].join("\n");
}

export function buildWorkbenchPlanModeGateUserPrompt(input: {
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

export function toRecord(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export async function handleWorkbenchIntakeMessage(
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
			if (task.status === "queued") {
				await repo.createTaskMessage({
					taskId,
					role: "system",
					content:
						"このTaskはQueue投入済みのため、新しいPlan Mode Runは開始していません。設計を変更する場合はQueueから戻してからCoding Agentへ依頼してください。",
					messageType: "text",
					payloadJson: {
						intent: "plan_mode_run_blocked",
						source: "workbench",
						reason: "task_queued",
						planModeGate: effectivePlanModeGate,
					},
				});
				return {
					task,
					run: null,
					messages: await repo.listTaskMessages(taskId),
				};
			}
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
					"Plan Modeを開始しました。Coding Agentが必要な設計Artifactと入力要否を判断します。",
				messageType: "text",
				payloadJson: {
					intent: "run_started",
					source: "workbench",
					executionMode: "implementation",
					planMode: true,
					planModeGate: {
						...effectivePlanModeGate,
						dedicatedViews: [],
						specificationLenses: [],
					},
					planModeSettingsSnapshot,
				},
			});
			const run = await startTaskRun(taskId, {
				executionModeSource: "workbench_intake",
				planModeRequested: true,
				latestUserMessageOverride: llmPrompt,
				routeOverride: options.llmRouteOverride || null,
			});
			return {
				task: (await repo.getTask(taskId)) || runnable,
				run,
				messages: await repo.listTaskMessages(taskId),
			};
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

export function createWorkbenchLlmDebugEventEmitter(taskId: string) {
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

export async function prepareWorkbenchIntakeTask(
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
