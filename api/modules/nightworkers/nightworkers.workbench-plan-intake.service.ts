import type { TraceProvenance } from "../../../shared/schemas/trace-provenance.schema";
import { AppError, NotFoundError } from "../../lib/errors";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../services/settings/general-settings";
import { createDesignQuestionnaire } from "../questionnaire/questionnaire.service";
import * as repo from "./nightworkers.repository";
import { missionPilotPlanOutputTrace } from "./nightworkers.trace-provenance";
import type { WorkbenchPlanModeGate } from "./nightworkers.workbench.service";
import {
	createWorkbenchLlmDebugEventEmitter,
	decideWorkbenchPlanModeGate,
	toRecord,
} from "./nightworkers.workbench.service";

export async function ensureDesignQuestionnaireReadyMessage(input: {
	taskId: string;
	questionnaireSession: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
	planModeGate: WorkbenchPlanModeGate & Record<string, unknown>;
	planModeSettingsSnapshot: ReturnType<typeof buildPlanModeSettingsSnapshot>;
	source: "workbench" | "mission_pilot";
	trace?: TraceProvenance;
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
		trace: input.trace,
	});
}

export async function ensureMissionPilotAgentQuestionnaireReadyMessage(input: {
	taskId: string;
	missionPilotSessionId: string;
	questionnaireSession: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
}) {
	return ensureDesignQuestionnaireReadyMessage({
		taskId: input.taskId,
		questionnaireSession: input.questionnaireSession,
		planModeGate: {
			shouldStartPlanMode: true,
			action: "plan_mode",
			reason: "Mission PilotがQuestionnaire回答案を保存しました。",
			dedicatedViews: [
				{
					view: "questionnaire",
					decision: "include",
					reason: "既存Questionnaire UIへ回答案を表示します。",
				},
			],
			specificationLenses: [],
		},
		planModeSettingsSnapshot: buildPlanModeSettingsSnapshot(
			readGeneralSettings(),
		),
		source: "mission_pilot",
		trace: missionPilotPlanOutputTrace({
			sessionId: input.missionPilotSessionId,
		}),
	});
}

export async function prepareMissionPilotPlanModeIntake(input: {
	taskId: string;
	prompt: string;
	missionPilotSessionId: string;
	questionnaireSession?: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
}) {
	const trace = missionPilotPlanOutputTrace({
		sessionId: input.missionPilotSessionId,
	});
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
		role: "mission_pilot",
		usageTrace: trace,
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
		(await createDesignQuestionnaire(input.taskId, null, input.prompt, {
			role: "mission_pilot",
			usageTrace: trace,
		}));
	await ensureDesignQuestionnaireReadyMessage({
		taskId: input.taskId,
		questionnaireSession,
		planModeGate,
		planModeSettingsSnapshot,
		source: "mission_pilot",
		trace,
	});
	return questionnaireSession;
}
