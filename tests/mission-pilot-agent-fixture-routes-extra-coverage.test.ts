import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	task: null as null | Record<string, unknown>,
	session: null as null | Record<string, unknown>,
	createdSession: null as null | Record<string, unknown>,
	isAgent: true,
	prepared: null as null | { turnId: string },
	questionnaire: { id: "33333333-3333-4333-8333-333333333333" },
	registeredTurns: [] as unknown[],
	activityInputs: [] as unknown[],
	messageInputs: [] as unknown[],
	questionnaireRecords: [] as unknown[],
	appendInputs: [] as unknown[],
	wakeInputs: [] as unknown[],
	reset() {
		this.task = null;
		this.session = null;
		this.createdSession = null;
		this.isAgent = true;
		this.prepared = null;
		this.registeredTurns.length = 0;
		this.activityInputs.length = 0;
		this.messageInputs.length = 0;
		this.questionnaireRecords.length = 0;
		this.appendInputs.length = 0;
		this.wakeInputs.length = 0;
	},
}));

vi.mock(
	"../packages/mission-pilot/src/backend/nightworkers/nightworkers.repository",
	() => ({
		getTask: async () => mocks.task,
		appendActivityEvent: async (input: unknown) => {
			mocks.activityInputs.push(input);
		},
		createTaskMessage: async (input: unknown) => {
			mocks.messageInputs.push(input);
		},
	}),
);
vi.mock("../packages/mission-pilot/src/backend/storage", () => ({
	getSessionByTaskId: async () => mocks.session,
	getOrCreateSession: async () => mocks.createdSession,
}));
vi.mock(
	"../packages/mission-pilot/src/services/structured-llm/fixture-tool-provider",
	() => ({
		registerFixtureProviderToolTurns: (_taskId: string, turns: unknown) => {
			mocks.registeredTurns.push(turns);
		},
	}),
);
vi.mock(
	"../packages/mission-pilot/src/backend/runtime/routes/mission-pilot-agent-fixture-scenarios",
	() => ({
		buildAgentScenarioTurns: (scenario: string) => [{ scenario }],
		buildQuestionnaireFixtureTurns: (input: unknown) => [input],
	}),
);
vi.mock("../packages/mission-pilot/src/backend/persistence-port", () => ({
	callMissionPilotPersistence: async () => mocks.prepared,
}));
vi.mock("../packages/mission-pilot/src/backend/questionnaire", () => ({
	getDesignQuestionnaireSession: async () => ({ id: mocks.questionnaire.id }),
}));
vi.mock(
	"../packages/mission-pilot/src/backend/questionnaire/questionnaire.repository",
	() => ({
		createDesignQuestionnaireSession: async () => mocks.questionnaire,
		createDesignQuestionnaireQuestionSet: vi.fn(async () => undefined),
		updateDesignQuestionnaireSessionStatus: vi.fn(async () => undefined),
	}),
);
vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-runtime",
	() => ({
		reconcileInterruptedMissionPilotAgentSessions: vi.fn(async () => []),
	}),
);
vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-session.repository",
	() => ({ isMissionPilotAgentSession: async () => mocks.isAgent }),
);
vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-agent-wake.service",
	() => ({
		scheduleMissionPilotAgentWake: (input: unknown) =>
			mocks.wakeInputs.push(input),
	}),
);
vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-event.adapter",
	() => ({
		recordMissionPilotQuestionnaireStateChanged: async (input: unknown) => {
			mocks.questionnaireRecords.push(input);
		},
	}),
);
vi.mock(
	"../packages/mission-pilot/src/backend/runtime/agent/mission-pilot-task-event.repository",
	() => ({
		appendMissionPilotTaskEvent: async (input: unknown) => {
			mocks.appendInputs.push(input);
		},
	}),
);

import { missionPilotAgentFixtureRouter } from "../packages/mission-pilot/src/backend/runtime/routes/mission-pilot-agent-fixture-routes";

const taskId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const sessionId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
	mocks.reset();
	process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
});

afterEach(() => {
	delete process.env.NIGHTWORKERS_E2E_ISOLATED;
});

describe("Mission Pilot agent fixture routes extra coverage", () => {
	it("hides every fixture route outside isolated E2E requests", async () => {
		delete process.env.NIGHTWORKERS_E2E_ISOLATED;
		expect((await request("questionnaire", {})).status).toBe(404);
		process.env.NIGHTWORKERS_E2E_ISOLATED = "1";
		expect(
			(await request("scenario", { scenario: "autopilot" }, false)).status,
		).toBe(404);
		expect((await request("runtime-restart", {})).status).toBe(404);
		expect((await request("trace-events", {})).status).toBe(404);
	});

	it("covers questionnaire lookup and agent guards", async () => {
		expect((await request("questionnaire", {})).status).toBe(404);

		mocks.task = task();
		mocks.createdSession = session({ desiredState: "stopped" });
		mocks.isAgent = false;
		expect((await request("questionnaire", {})).status).toBe(404);

		mocks.isAgent = true;
		const stopped = await request("questionnaire", {});
		expect(stopped.status).toBe(201);
		expect(await stopped.json()).toEqual({
			questionnaireSessionId: mocks.questionnaire.id,
		});
		expect(mocks.questionnaireRecords).toHaveLength(0);
		expect(mocks.registeredTurns).toHaveLength(1);

		mocks.session = session({ desiredState: "playing" });
		const playing = await request("questionnaire", {});
		expect(playing.status).toBe(201);
		expect(mocks.questionnaireRecords).toHaveLength(1);
	});

	it("covers scenario task, state, agent, and every scenario branch", async () => {
		expect((await request("scenario", { scenario: "autopilot" })).status).toBe(
			404,
		);
		mocks.task = task();
		mocks.createdSession = session({ desiredState: "playing" });
		expect((await request("scenario", { scenario: "autopilot" })).status).toBe(
			404,
		);

		mocks.createdSession = session({ desiredState: "stopped" });
		mocks.isAgent = false;
		expect((await request("scenario", { scenario: "repair" })).status).toBe(
			404,
		);
		mocks.isAgent = true;
		for (const scenarioName of [
			"autopilot",
			"repair",
			"restart",
			"user-interruption",
		]) {
			const response = await request("scenario", { scenario: scenarioName });
			expect(response.status).toBe(201);
			expect(await response.json()).toEqual({ sessionId });
		}
		expect(mocks.registeredTurns).toHaveLength(4);
	});

	it("covers restart state, agent, persistence, and success branches", async () => {
		expect((await request("runtime-restart", {})).status).toBe(404);
		mocks.session = session({ desiredState: "stopped" });
		expect((await request("runtime-restart", {})).status).toBe(404);
		mocks.session = session({ desiredState: "playing" });
		mocks.isAgent = false;
		expect((await request("runtime-restart", {})).status).toBe(404);
		mocks.isAgent = true;
		expect((await request("runtime-restart", {})).status).toBe(404);

		mocks.prepared = { turnId: "turn-1" };
		const response = await request("runtime-restart", {});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ sessionId });
		expect(mocks.appendInputs[0]).toMatchObject({
			eventType: "mission_pilot.resume_requested",
			payload: { reason: "e2e_runtime_restart", expiredTurnId: "turn-1" },
		});
		expect(mocks.wakeInputs).toEqual([{ sessionId }]);
	});

	it("covers trace task/session guards and writes isolated trace records", async () => {
		expect((await request("trace-events", {})).status).toBe(404);
		mocks.task = task();
		mocks.createdSession = null;
		expect((await request("trace-events", {})).status).toBe(404);

		mocks.session = session({ desiredState: "stopped" });
		const response = await request("trace-events", {});
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ sessionId });
		expect(mocks.activityInputs).toHaveLength(2);
		expect(mocks.activityInputs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					text: "MISSION_PILOT_THOUGHT_ONLY",
					trace: expect.objectContaining({ owner: "mission_pilot" }),
				}),
				expect.objectContaining({
					text: "CODING_AGENT_CHAT_ONLY",
					trace: expect.objectContaining({ owner: "coding_agent" }),
				}),
			]),
		);
		expect(mocks.messageInputs[0]).toMatchObject({
			content: "MISSION_PILOT_ARTIFACT_BODY",
			messageType: "markdown_document",
		});
	});
});

function task() {
	return { id: taskId, repositoryId, revision: 7 };
}

function session(overrides: Record<string, unknown>) {
	return { id: sessionId, taskId, version: 3, ...overrides };
}

function request(
	route: "questionnaire" | "scenario" | "runtime-restart" | "trace-events",
	body: Record<string, unknown>,
	withHeader = true,
) {
	return missionPilotAgentFixtureRouter.request(
		`http://localhost/e2e/fixtures/mission-pilot-agent-${route}`.replace(
			"mission-pilot-agent-trace-events",
			"trace-events",
		),
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(withHeader ? { "x-nightworkers-e2e": "1" } : {}),
			},
			body: JSON.stringify({ taskId, ...body }),
		},
	);
}
