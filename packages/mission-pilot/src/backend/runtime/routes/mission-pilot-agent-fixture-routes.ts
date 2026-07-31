import crypto from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db/client";
import { createOpenApiRouter } from "../../../lib/openapi";
import { registerFixtureProviderToolTurns } from "../../../services/structured-llm/fixture-tool-provider";
import * as repo from "../../nightworkers/nightworkers.repository";
import { getDesignQuestionnaireSession } from "../../questionnaire";
import {
	createDesignQuestionnaireQuestionSet,
	createDesignQuestionnaireSession,
	updateDesignQuestionnaireSessionStatus,
} from "../../questionnaire/questionnaire.repository";
import * as missionPilotRepo from "../../storage";
import {
	missionPilotAgentSessions,
	missionPilotAgentTurns,
} from "../../storage";
import { reconcileInterruptedMissionPilotAgentSessions } from "../agent/mission-pilot-agent-runtime";
import { isMissionPilotAgentSession } from "../agent/mission-pilot-agent-session.repository";
import { scheduleMissionPilotAgentWake } from "../agent/mission-pilot-agent-wake.service";
import { recordMissionPilotQuestionnaireStateChanged } from "../agent/mission-pilot-task-event.adapter";
import { appendMissionPilotTaskEvent } from "../agent/mission-pilot-task-event.repository";
import {
	buildAgentScenarioTurns,
	buildQuestionnaireFixtureTurns,
} from "./mission-pilot-agent-fixture-scenarios";

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

const prepareAgentScenarioFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-scenario",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						scenario: z.enum([
							"autopilot",
							"repair",
							"restart",
							"user-interruption",
						]),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ sessionId: z.string().uuid() }),
				},
			},
			description: "Prepare a deterministic Mission Pilot Agent scenario.",
		},
		404: { description: "Route unavailable" },
	},
});
const restartAgentRuntimeFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/mission-pilot-agent-runtime-restart",
	request: {
		body: {
			content: {
				"application/json": { schema: z.object({ taskId: z.string().uuid() }) },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ sessionId: z.string().uuid() }),
				},
			},
			description: "Expire and reconcile an Agent runtime lease.",
		},
		404: { description: "Route unavailable" },
	},
});
const createTraceFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/trace-events",
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
					schema: z.object({ sessionId: z.string().uuid() }),
				},
			},
			description: "Create isolated Mission Pilot trace fixtures.",
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
		if (!task || !pilot || !(await isMissionPilotAgentSession(pilot.id)))
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
		if (pilot.desiredState === "playing") {
			const current = await getDesignQuestionnaireSession(
				taskId,
				questionnaire.id,
			);
			await recordMissionPilotQuestionnaireStateChanged(current);
		}
		registerFixtureProviderToolTurns(
			taskId,
			buildQuestionnaireFixtureTurns({
				taskRevision: task.revision,
				questionnaireSessionId: questionnaire.id,
			}),
		);
		return c.json({ questionnaireSessionId: questionnaire.id }, 201);
	},
);

missionPilotAgentFixtureRouter.openapi(
	prepareAgentScenarioFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		)
			return c.json({ error: "Not found" }, 404);
		const { taskId, scenario } = c.req.valid("json");
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
		registerFixtureProviderToolTurns(taskId, buildAgentScenarioTurns(scenario));
		return c.json({ sessionId: pilot.id }, 201);
	},
);

missionPilotAgentFixtureRouter.openapi(
	restartAgentRuntimeFixtureRoute,
	async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		)
			return c.json({ error: "Not found" }, 404);
		const { taskId } = c.req.valid("json");
		const pilot = await missionPilotRepo.getSessionByTaskId(taskId);
		if (
			pilot?.desiredState !== "playing" ||
			!(await isMissionPilotAgentSession(pilot.id))
		)
			return c.json({ error: "Agent Mission Pilot not found" }, 404);
		const [agent] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, pilot.id));
		if (!agent || agent.runtimeState === "completed")
			return c.json({ error: "Agent runtime cannot be restarted" }, 404);
		const turnId = crypto.randomUUID();
		const now = new Date();
		await db.transaction(async (tx) => {
			await tx.insert(missionPilotAgentTurns).values({
				id: turnId,
				sessionId: pilot.id,
				turnIndex: agent.nextTurnIndex,
				status: "running",
				startedAt: new Date(now.getTime() - 10_000),
			});
			await tx
				.update(missionPilotAgentSessions)
				.set({
					runtimeState: "running",
					currentTurnId: turnId,
					leaseOwner: "expired-e2e-runtime",
					leaseExpiresAt: new Date(0),
					nextTurnIndex: agent.nextTurnIndex + 1,
					updatedAt: now,
				})
				.where(eq(missionPilotAgentSessions.sessionId, pilot.id));
		});
		await reconcileInterruptedMissionPilotAgentSessions(now);
		await appendMissionPilotTaskEvent({
			taskId,
			eventType: "mission_pilot.resume_requested",
			sourceEventId: `e2e-runtime-restart:${turnId}`,
			taskRevision: pilot.version,
			payload: { reason: "e2e_runtime_restart", expiredTurnId: turnId },
		});
		scheduleMissionPilotAgentWake({ sessionId: pilot.id });
		return c.json({ sessionId: pilot.id }, 200);
	},
);

missionPilotAgentFixtureRouter.openapi(createTraceFixtureRoute, async (c) => {
	if (
		process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
		c.req.header("x-nightworkers-e2e") !== "1"
	)
		return c.json({ error: "Not found" }, 404);
	const { taskId } = c.req.valid("json");
	const session = await missionPilotRepo.getSessionByTaskId(taskId);
	if (!session)
		return c.json({ error: "Mission Pilot session not found" }, 404);
	await repo.appendActivityEvent({
		taskId,
		turnId: "pilot-turn",
		kind: "runtime.decision",
		source: "e2e",
		status: "completed",
		text: "MISSION_PILOT_THOUGHT_ONLY",
		payloadJson: { missionPilotSessionId: session.id },
		dedupeKey: `e2e:pilot:${taskId}`,
		trace: {
			owner: "mission_pilot",
			channel: "pilot_thought",
			producer: { kind: "structured_llm", role: "mission_pilot" },
			orchestrationRef: {
				kind: "mission_pilot",
				sessionId: session.id,
			},
		},
	});
	await repo.appendActivityEvent({
		taskId,
		turnId: "coding-turn",
		kind: "assistant.message",
		source: "worker",
		status: "completed",
		text: "CODING_AGENT_CHAT_ONLY",
		payloadJson: {},
		dedupeKey: `e2e:coding:${taskId}`,
		trace: {
			owner: "coding_agent",
			channel: "chat",
			producer: { kind: "agent_runtime", role: "coding_agent" },
		},
	});
	await repo.createTaskMessage({
		taskId,
		role: "assistant",
		content: "MISSION_PILOT_ARTIFACT_BODY",
		messageType: "markdown_document",
		payloadJson: { intent: "feature_plan" },
		trace: {
			owner: "mission_pilot",
			channel: "artifact",
			producer: { kind: "structured_llm", role: "mission_pilot" },
			orchestrationRef: {
				kind: "mission_pilot",
				sessionId: session.id,
			},
		},
	});
	return c.json({ sessionId: session.id }, 201);
});

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
