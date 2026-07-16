import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { createOpenApiRouter } from "../../../lib/openapi";
import { registerFixtureProviderToolTurns } from "../../../services/structured-llm/fixture-tool-provider";
import { isMissionPilotAgentSession } from "../../missionPilot/agent/mission-pilot-agent-session.repository";
import * as missionPilotRepo from "../../missionPilot/mission-pilot.repository";
import {
	createDesignQuestionnaireQuestionSet,
	createDesignQuestionnaireSession,
	updateDesignQuestionnaireSessionStatus,
} from "../../questionnaire/questionnaire.repository";
import * as repo from "../nightworkers.repository";

const prepareAgentQuestionnaireFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-questionnaire",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ taskId: z.string().uuid() }),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ questionnaireSessionId: z.string().uuid() }),
				},
			},
			description: "Prepare an isolated agent Questionnaire flow.",
		},
		404: { description: "Route unavailable" },
	},
});

export const missionPilotAgentFixtureRouter = createOpenApiRouter().openapi(
	prepareAgentQuestionnaireFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		)
			return c.json({ error: "Not found" }, 404);
		const { taskId } = c.req.valid("json");
		const [task, pilot] = await Promise.all([
			repo.getTask(taskId),
			missionPilotRepo.getSessionByTaskId(taskId),
		]);
		if (
			!task ||
			!pilot ||
			pilot.desiredState !== "stopped" ||
			!(await isMissionPilotAgentSession(pilot.id))
		)
			return c.json({ error: "Agent Mission Pilot not found" }, 404);

		const questionnaire = await createDesignQuestionnaireSession({
			taskId,
			repositoryId: task.repositoryId,
			status: "draft",
		});
		await createDesignQuestionnaireQuestionSet({
			sessionId: questionnaire.id,
			sequence: 1,
			validationStatus: "valid",
			rawOutput: null,
			questionnaireJson: buildQuestionnaire(taskId, task.repositoryId),
		});
		await updateDesignQuestionnaireSessionStatus(questionnaire.id, "answering");
		registerFixtureProviderToolTurns(taskId, [
			{
				content: "現在のTaskとQuestionnaireを確認します。",
				toolCalls: [
					{
						id: "agent-questionnaire-read",
						name: "read_task_workspace",
						arguments: {},
					},
				],
			},
			{
				content: "既存規約に合うRESTを回答案として保存します。",
				toolCalls: [
					{
						id: "agent-questionnaire-draft",
						name: "questionnaire_draft_save",
						arguments: {
							expectedTaskRevision: task.updatedAt.getTime(),
							questionnaireSessionId: questionnaire.id,
							answers: [
								{
									questionId: "api-style",
									selectedOptionIds: ["rest"],
									rankedOptionIds: [],
									deferred: false,
								},
							],
							answerEvidence: [
								{
									questionId: "api-style",
									reason:
										"Projectの既存規約とHTTP APIに合うためRESTを選択します。",
								},
							],
						},
					},
				],
			},
			{
				content: "Questionnaire回答の自動確定を確認しました。",
				toolCalls: [],
			},
		]);
		return c.json({ questionnaireSessionId: questionnaire.id }, 201);
	},
);

function buildQuestionnaire(taskId: string, repositoryId: string) {
	return {
		version: 1,
		source: { taskId, repositoryId, sourceKind: "plan_mode_intake" },
		title: "API方針",
		summary: "API方式を選択する",
		questionSets: [
			{
				id: "architecture",
				title: "構成",
				category: "architecture",
				purpose: "API契約を決める",
				questions: [
					{
						id: "api-style",
						topic: "API",
						question: "どの方式にしますか",
						why: "実装契約を固定するため",
						answerType: "single_choice",
						options: [
							{ id: "rest", label: "REST", tradeoff: "既存規約に合う" },
							{ id: "rpc", label: "RPC", tradeoff: "密結合になる" },
						],
						blocks: ["implementation"],
						outputSection: "API",
					},
				],
			},
		],
		openQuestions: [],
		dataModelHandoffNotes: [],
	};
}
