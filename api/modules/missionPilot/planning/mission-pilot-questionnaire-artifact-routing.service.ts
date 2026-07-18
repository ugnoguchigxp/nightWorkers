import crypto from "node:crypto";
import type { DesignQuestionnaireSession } from "../../../../shared/schemas/design-questionnaire.schema";
import { readGeneralSettings } from "../../../services/settings/general-settings";
import * as nightworkersRepo from "../../nightworkers/nightworkers.repository";
import { getPlanModeWorkspace } from "../../specification/plan-mode-workspace.service";
import * as missionPilotRepo from "../mission-pilot.repository";
import { ensureQuestionnaireContext } from "../mission-pilot-plan-support";
import { selectQuestionnaireArtifacts } from "./mission-pilot-questionnaire-artifact-selection.service";
import { executeMissionPilotPlanRoutingTool } from "./plan-mode-routing.service";

export async function selectQuestionnaireArtifactsForTask(input: {
	taskId: string;
	questionnaire: DesignQuestionnaireSession;
	sessionId?: string;
}) {
	const pilot = await missionPilotRepo.getSessionByTaskId(input.taskId);
	if (pilot?.desiredState !== "playing") return null;
	const questionnaire = input.questionnaire;
	if (!["review_ready", "accepted"].includes(questionnaire.status)) {
		return null;
	}

	await ensureQuestionnaireContext(pilot.id, questionnaire);
	const task = await nightworkersRepo.getTask(input.taskId);
	if (!task) throw new Error("Task is missing");
	const workspace = await getPlanModeWorkspace(input.taskId);
	if (!workspace.routing) return null;

	const changes = await selectQuestionnaireArtifacts({
		taskId: input.taskId,
		sessionId: input.sessionId ?? pilot.id,
		task: {
			title: task.title,
			objective: task.objective,
			acceptanceCriteria: task.acceptanceCriteria,
		},
		questionnaire,
		routing: workspace.routing,
		capabilities: readGeneralSettings().planMode.capabilities,
	});
	if (changes.length === 0) return workspace.routing;

	return executeMissionPilotPlanRoutingTool(input.taskId, {
		tool: "edit_plan_artifact_routing",
		expectedRevision: workspace.routing.revision,
		idempotencyKey: crypto.randomUUID(),
		changes,
	});
}
