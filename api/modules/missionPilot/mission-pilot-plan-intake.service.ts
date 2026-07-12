import { logEvent } from "../../lib/logger";
import { listDesignQuestionnaires } from "../questionnaire/questionnaire.service";
import { publishQuestionnaireReady } from "../questionnaire/questionnaire-events";
import { MissionPilotError } from "./mission-pilot.errors";
import { assertMissionPilotPreQueueMutable } from "./mission-pilot-pre-queue-recovery.service";
import { prepareMissionPilotPlanModeIntake } from "./mission-pilot-workbench.port";

export type MissionPilotPlanIntakeResult = {
	questionnaireSessionId: string;
	questionnaireStatus: string;
};

function resultForQuestionnaire(questionnaire: { id: string; status: string }) {
	return {
		questionnaireSessionId: questionnaire.id,
		questionnaireStatus: questionnaire.status,
	} satisfies MissionPilotPlanIntakeResult;
}

function schedulePlanPipeline(taskId: string) {
	void import("./mission-pilot-plan-coordinator.service")
		.then(({ runMissionPilotPlanPipeline }) =>
			runMissionPilotPlanPipeline(taskId),
		)
		.catch((error) => {
			logEvent({
				channel: "mission-pilot",
				level: "error",
				message: "Typed Plan intake pipeline scheduling failed",
				meta: {
					taskId,
					errorMessage: error instanceof Error ? error.message : String(error),
				},
			});
		});
}

export async function startOrResumeMissionPilotPlanIntake(input: {
	taskId: string;
	initialPrompt: string;
}) {
	await assertMissionPilotPreQueueMutable(input.taskId);
	const existing = (await listDesignQuestionnaires(input.taskId))[0];
	if (existing) {
		if (existing.status === "answering") {
			await prepareMissionPilotPlanModeIntake({
				taskId: input.taskId,
				prompt: input.initialPrompt,
				questionnaireSession: existing,
			});
			await publishQuestionnaireReady(existing);
			return resultForQuestionnaire(existing);
		}
		if (["review_ready", "accepted"].includes(existing.status)) {
			await prepareMissionPilotPlanModeIntake({
				taskId: input.taskId,
				prompt: input.initialPrompt,
				questionnaireSession: existing,
			});
			schedulePlanPipeline(input.taskId);
			return resultForQuestionnaire(existing);
		}
		throw new MissionPilotError(
			409,
			"MISSION_PILOT_PLAN_INTAKE_NEEDS_EDIT",
			"Mission PilotのQuestionnaireを確認してから再開してください。",
		);
	}

	const created = await prepareMissionPilotPlanModeIntake({
		taskId: input.taskId,
		prompt: input.initialPrompt,
	});
	if (created.status === "answering") {
		return resultForQuestionnaire(created);
	}
	if (["review_ready", "accepted"].includes(created.status)) {
		schedulePlanPipeline(input.taskId);
		return resultForQuestionnaire(created);
	}
	throw new MissionPilotError(
		409,
		"MISSION_PILOT_PLAN_INTAKE_NEEDS_EDIT",
		"Mission PilotのQuestionnaire生成結果を確認してください。",
	);
}
