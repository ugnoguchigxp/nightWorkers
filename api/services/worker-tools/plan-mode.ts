import crypto from "node:crypto";
import { nightWorkersPlanModeInputSchema } from "../../mcp/nightworkers-tool-schemas";
import { generateBlueprintArtifact } from "../../modules/blueprint";
import { generateDataModelArtifact } from "../../modules/dataModel/dataModel-generation.service";
import * as nightworkersRepo from "../../modules/nightworkers/nightworkers.repository";
import { ensureDesignQuestionnaireReadyMessage } from "../../modules/nightworkers/nightworkers.workbench-plan-intake.service";
import {
	getPlanModeRouting,
	updatePlanModeRoutingForCodingAgent,
} from "../../modules/planMode/plan-mode-routing.service";
import { generatePlanViewArtifact } from "../../modules/planViews/planView-generation.service";
import {
	createDesignQuestionnaire,
	listDesignQuestionnaires,
} from "../../modules/questionnaire/questionnaire.service";
import { createPlanArtifactSourceSelection } from "../../modules/specification/plan-artifact-source-selection";
import { getPlanModeWorkspace } from "../../modules/specification/plan-mode-workspace.service";
import { generateFeaturePlanArtifact } from "../../modules/specification/specification-generation.service";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../settings/general-settings";
import type { WorkerToolResult } from "./types";

export type PlanModeToolInput = {
	taskId: string;
	runId?: string;
	command: unknown;
};

export async function planModeTool(
	input: PlanModeToolInput,
): Promise<WorkerToolResult<unknown>> {
	const startedAt = new Date().toISOString();
	const parsed = nightWorkersPlanModeInputSchema.safeParse({
		taskId: input.taskId,
		runId: input.runId,
		command: input.command,
	});
	if (!parsed.success) {
		return failure(
			startedAt,
			"INVALID_TOOL_ARGS",
			parsed.error.issues.map((issue) => issue.message).join("; "),
		);
	}
	const task = await nightworkersRepo.getTask(parsed.data.taskId ?? "");
	if (!task) return failure(startedAt, "TASK_NOT_FOUND", "Task not found.");
	try {
		const command = parsed.data.command;
		if (command.op !== "inspect") {
			const scopeFailure = await validateCodingAgentRunScope({
				startedAt,
				taskId: task.id,
				runId: parsed.data.runId,
			});
			if (scopeFailure) return scopeFailure;
		}
		if (command.op === "inspect") {
			const [routing, workspace, questionnaires] = await Promise.all([
				getPlanModeRouting(task.id, { allowTaskRuns: true }),
				getPlanModeWorkspace(task.id),
				listDesignQuestionnaires(task.id),
			]);
			return success(startedAt, {
				taskId: task.id,
				routing,
				workspace,
				questionnaires,
			});
		}
		if (command.op === "request_input") {
			const planModeSettingsSnapshot = buildPlanModeSettingsSnapshot(
				readGeneralSettings(),
			);
			if (!planModeSettingsSnapshot.capabilities.questionnaire) {
				return failure(
					startedAt,
					"PLAN_MODE_QUESTIONNAIRE_DISABLED",
					"Questionnaire capability is disabled in Settings.",
				);
			}
			const questionnaire = await createDesignQuestionnaire(
				task.id,
				command.sourceBlueprintMessageId ?? null,
				command.prompt,
				{ role: "plan" },
			);
			await ensureDesignQuestionnaireReadyMessage({
				taskId: task.id,
				questionnaireSession: questionnaire,
				planModeGate: {
					shouldStartPlanMode: true,
					action: "plan_mode",
					reason:
						"Coding Agentが設計判断に必要な入力をQuestionnaireとして要求しました。",
					dedicatedViews: [
						{
							view: "questionnaire",
							decision: "include",
							reason: "Coding Agentが未確定の設計入力を確認します。",
						},
					],
					specificationLenses: [],
				},
				planModeSettingsSnapshot,
				source: "coding_agent",
			});
			if (parsed.data.runId) {
				await markCodingAgentRunAwaitingQuestionnaire({
					taskId: task.id,
					runId: parsed.data.runId,
					questionnaireSessionId: questionnaire.id,
				});
			}
			return success(startedAt, { questionnaire });
		}
		if (command.op === "update_routing") {
			const routing = await updatePlanModeRoutingForCodingAgent(task.id, {
				expectedRevision: command.expectedRevision,
				idempotencyKey: command.idempotencyKey,
				changes: command.changes,
			});
			return success(startedAt, { routing });
		}
		const sourceSelection = createPlanArtifactSourceSelection({
			policy: "explicit_request",
			previousTargetMessageId:
				command.sourceSelection?.previousTargetMessageId ?? null,
			featurePlanMessageId:
				command.sourceSelection?.featurePlanMessageId ?? null,
			blueprintMessageId: command.sourceSelection?.blueprintMessageId ?? null,
			dataModelMessageId: command.sourceSelection?.dataModelMessageId ?? null,
			dedicatedViewMessageIds:
				command.sourceSelection?.dedicatedViewMessageIds ?? [],
		});
		const generationInput = {
			prompt: command.prompt,
			questionnaireSessionId: command.questionnaireSessionId ?? null,
			sourceSelection,
			role: "plan" as const,
		};
		const generated =
			command.artifactKind === "feature_plan"
				? await generateFeaturePlanArtifact(task.id, generationInput)
				: command.artifactKind === "blueprint"
					? await generateBlueprintArtifact(task.id, generationInput)
					: command.artifactKind === "data_model"
						? await generateDataModelArtifact(task.id, generationInput)
						: await generatePlanViewArtifact(
								task.id,
								command.artifactKind,
								generationInput,
							);
		return success(startedAt, generated);
	} catch (error) {
		return failure(
			startedAt,
			"PLAN_MODE_TOOL_FAILED",
			error instanceof Error ? error.message : String(error),
		);
	}
}

async function validateCodingAgentRunScope(input: {
	startedAt: string;
	taskId: string;
	runId?: string;
}) {
	if (!input.runId) {
		return failure(
			input.startedAt,
			"PLAN_MODE_RUN_SCOPE_REQUIRED",
			"Plan Modeの変更にはrequest-scoped Coding Agent runが必要です。",
		);
	}
	const run = await nightworkersRepo.getTaskRun(input.runId);
	if (!run || run.taskId !== input.taskId) {
		return failure(
			input.startedAt,
			"PLAN_MODE_RUN_SCOPE_MISMATCH",
			"Coding Agent runとTaskのscopeが一致しません。",
		);
	}
	return null;
}

async function markCodingAgentRunAwaitingQuestionnaire(input: {
	taskId: string;
	runId: string;
	questionnaireSessionId: string;
}) {
	const run = await nightworkersRepo.getTaskRun(input.runId);
	if (!run || run.taskId !== input.taskId) return;
	const snapshot = record(run.contextSnapshot);
	await nightworkersRepo.updateTaskRun(run.id, {
		contextSnapshot: {
			...snapshot,
			codingAgentPlanMode: {
				awaitingQuestionnaireSessionId: input.questionnaireSessionId,
				continuationKey: crypto.randomUUID(),
				updatedAt: new Date().toISOString(),
			},
		},
	});
}

function success(
	startedAt: string,
	payload: unknown,
): WorkerToolResult<unknown> {
	return {
		ok: true,
		toolName: "plan_mode",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload,
	};
}

function failure(
	startedAt: string,
	code: string,
	message: string,
): WorkerToolResult<unknown> {
	return {
		ok: false,
		toolName: "plan_mode",
		startedAt,
		finishedAt: new Date().toISOString(),
		payload: null,
		error: { code, message },
	};
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
