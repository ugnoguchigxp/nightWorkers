import { AppError } from "../../../lib/errors";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../../services/settings/general-settings";
import { missionPilotPlanOutputTrace } from "../../nightworkers/nightworkers.trace-provenance";
import { ensureDesignQuestionnaireReadyMessage } from "../../nightworkers/nightworkers.workbench-plan-intake.service";
import type { createDesignQuestionnaire } from "../../questionnaire/questionnaire.service";
import { createDesignQuestionnaire as createQuestionnaire } from "../../questionnaire/questionnaire.service";
import { missionPilotArtifactProviderExecutionPolicy } from "../adapters/mission-pilot-provider.adapter";

export async function ensureMissionPilotAgentQuestionnaireReadyMessage(input: {
	taskId: string;
	missionPilotSessionId: string;
	questionnaireSession: Awaited<ReturnType<typeof createDesignQuestionnaire>>;
}) {
	return ensureDesignQuestionnaireReadyMessage({
		taskId: input.taskId,
		questionnaireSession: input.questionnaireSession,
		planModeGate: missionPilotPlanModeGate(
			"Mission PilotがQuestionnaire回答案を保存しました。",
		),
		planModeSettingsSnapshot: missionPilotPlanModeSettings(),
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
	const planModeSettingsSnapshot = missionPilotPlanModeSettings();
	const questionnaireSession =
		input.questionnaireSession ??
		(await createQuestionnaire(input.taskId, null, input.prompt, {
			role: "mission_pilot",
			executionPolicy: missionPilotArtifactProviderExecutionPolicy,
			usageTrace: trace,
		}));
	await ensureDesignQuestionnaireReadyMessage({
		taskId: input.taskId,
		questionnaireSession,
		planModeGate: missionPilotPlanModeGate(
			"Mission Pilotのpre-Queue計画としてPlan Modeを開始します。",
		),
		planModeSettingsSnapshot,
		source: "mission_pilot",
		trace,
	});
	return questionnaireSession;
}

function missionPilotPlanModeGate(reason: string) {
	return {
		shouldStartPlanMode: true,
		action: "plan_mode" as const,
		reason,
		dedicatedViews: [
			{
				view: "questionnaire" as const,
				decision: "include" as const,
				reason: "Mission Pilotが設計判断を確定するために使用します。",
			},
		],
		specificationLenses: [],
	};
}

function missionPilotPlanModeSettings() {
	const snapshot = buildPlanModeSettingsSnapshot(readGeneralSettings());
	if (!snapshot.capabilities.questionnaire) {
		throw new AppError(
			409,
			"MISSION_PILOT_QUESTIONNAIRE_DISABLED",
			"Mission PilotのPlan ModeにはQuestionnaire capabilityが必要です。",
		);
	}
	return snapshot;
}
