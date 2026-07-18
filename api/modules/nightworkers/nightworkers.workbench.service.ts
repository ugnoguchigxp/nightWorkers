import { planModeRegenerationTargetSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import { AppError } from "../../lib/errors";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../services/settings/general-settings";
import type { SupervisorLlmDebugEvent } from "../../services/structured-llm";
import type { normalizeStructuredLlmModelTarget } from "../../services/structured-llm/selection";
import * as codingAgent from "../codingAgent";
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

export { ensureDesignQuestionnaireReadyMessage } from "./nightworkers.workbench-plan-intake.service";

import { startWorkbenchPlanModeIntake } from "./nightworkers.workbench-plan-intake.service";

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
export type WorkbenchPlanModeGate = codingAgent.CodingAgentPlanModeGate;
export function decideWorkbenchPlanModeGate(
	input: Parameters<typeof codingAgent.decideCodingAgentPlanModeGate>[0],
) {
	return codingAgent.decideCodingAgentPlanModeGate(input);
}
export function buildWorkbenchPlanModeGatePrompt(projectRoot: string) {
	return codingAgent.buildCodingAgentPlanModeGatePrompt(projectRoot);
}
export function buildWorkbenchPlanModeGateUserPrompt(
	input: Parameters<
		typeof codingAgent.buildCodingAgentPlanModeGateUserPrompt
	>[0],
) {
	return codingAgent.buildCodingAgentPlanModeGateUserPrompt(input);
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
		const planModeGateResult =
			(await codingAgent.loadPersistedCodingAgentPlanModeGateResult({
				taskId,
				repositoryId: task.repositoryId,
				prompt: llmPrompt,
			})) ??
			(await decideWorkbenchPlanModeGate({
				projectRoot,
				prompt: llmPrompt,
				task,
				messages,
				runs: await repo.listTaskRunsForTask(taskId),
				routeOverride: options.llmRouteOverride || null,
				emitEvent: emitWorkbenchLlmDebugEvent,
				taskId,
				repositoryId: task.repositoryId,
			}));
		const { runtimeThreadHandoff, ...planModeGate } = planModeGateResult;
		const planModeSettingsSnapshot = buildPlanModeSettingsSnapshot(
			readGeneralSettings(),
		);
		const shouldStartPlanMode =
			planModeGate.shouldStartPlanMode || planModeGate.action === "plan_mode";
		const shouldStartCodingAgentRun =
			shouldStartPlanMode || (options.intent || "intake") === "intake";
		if (task.status === "queued" && shouldStartCodingAgentRun) {
			await repo.createTaskMessage({
				taskId,
				role: "system",
				content: shouldStartPlanMode
					? "このTaskはQueue投入済みのため、新しいPlan Mode Runは開始していません。設計を変更する場合はQueueから戻してからCoding Agentへ依頼してください。"
					: "このTaskはQueue投入済みのため、新しいCoding Agent Runは開始していません。実行内容を変更する場合はQueueから戻してから依頼してください。",
				messageType: "text",
				payloadJson: {
					intent: shouldStartPlanMode
						? "plan_mode_run_blocked"
						: "coding_agent_run_blocked",
					source: "workbench",
					reason: "task_queued",
					planModeGate,
				},
			});
			return {
				task,
				run: null,
				messages: await repo.listTaskMessages(taskId),
			};
		}
		if (shouldStartPlanMode) {
			const runnable = await repo.updateTask(taskId, {
				title,
				objective: task.objective || prompt,
				acceptanceCriteria: task.acceptanceCriteria || prompt,
				status: "ready",
			});
			await startWorkbenchPlanModeIntake({
				taskId,
				prompt: llmPrompt,
				planModeGate,
				planModeSettingsSnapshot,
				routeOverride: options.llmRouteOverride || null,
			});
			return {
				task: (await repo.getTask(taskId)) || runnable,
				run: null,
				messages: await repo.listTaskMessages(taskId),
			};
		} else if ((options.intent || "intake") === "intake") {
			const executionMode = "implementation";
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
					planModeGate,
					planModeSettingsSnapshot,
				},
			});
			const run = await startTaskRun(taskId, {
				executionModeSource: "workbench_intake",
				intakeRuntimeThreadHandoff: runtimeThreadHandoff,
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
