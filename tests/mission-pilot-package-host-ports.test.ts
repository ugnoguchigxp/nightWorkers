import { describe, expect, it, vi } from "vitest";
import type {
	MissionPilotPrincipal,
	MissionPilotRealtimeEvent,
} from "@nightworkers/mission-pilot/contracts";
import { createMissionPilotHostPortsFake } from "@nightworkers/mission-pilot/testing";
import {
	createMissionPilotHostPorts,
	type MissionPilotHostPortAdapters,
} from "../api/composition/mission-pilot";

const principal: MissionPilotPrincipal = {
	kind: "delegated_user",
	userId: "user-1",
	delegate: "mission_pilot",
	sessionId: "session-1",
	authorizationRef: "authorization-1",
	grantedAt: "2026-07-31T00:00:00.000Z",
	capabilityDigest: "sha256:capabilities",
};

describe("Mission Pilot host port composition", () => {
	it("forwards public resource and action calls without semantic branching", async () => {
		const adapters = createAdapters();
		const ports = createMissionPilotHostPorts(adapters);
		const query = {
			taskId: "task-1",
			resource: "questionnaire",
			resourceId: "questionnaire-1",
			cursor: 4,
			limit: 8,
			principal,
		};
		const command = {
			taskId: "task-1",
			action: "questionnaire.submit",
			expectedTaskRevision: 3,
			arguments: {
				questionnaireSessionId: "questionnaire-1",
				answers: [],
			},
			principal,
			requestId: "request-1",
			idempotencyKey: "command-1",
		};

		await expect(ports.taskOperator.query(query)).resolves.toEqual({
			kind: "query-result",
		});
		await expect(ports.taskOperator.execute(command)).resolves.toEqual({
			kind: "action-result",
		});
		expect(adapters.query).toHaveBeenCalledWith(query);
		expect(adapters.execute).toHaveBeenCalledWith(command);
	});

	it("forwards intake, events, realtime, LLM, authorization, clock, ids, and logs", async () => {
		const adapters = createAdapters();
		const ports = createMissionPilotHostPorts(adapters);
		const intake = {
			taskId: "task-1",
			prompt: "ユーザーと同じ intake へ送る",
			principal,
			requestId: "request-2",
			idempotencyKey: "intake-1",
		};
		const event: MissionPilotRealtimeEvent = {
			type: "mission_pilot.updated",
			taskId: "task-1",
			payload: {
				sessionId: "session-1",
				taskId: "task-1",
				desiredState: "playing",
				phase: "waiting_for_questionnaire",
				version: 2,
				lastActivityAt: null,
				nextEligibleAt: null,
			},
		};
		const listener = vi.fn();

		await ports.taskIntake.submitUserMessage(intake);
		const unsubscribe = ports.events.subscribe(listener);
		await ports.realtime.publish(event);
		await ports.systemContext.resolve({
			binding: { version: 1 },
			promptKey: "missionPilot.compaction",
			values: {},
		});
		await ports.structuredLlm.generate({ schemaName: "next_action" });
		await ports.authorization.assertTaskAction({
			taskId: "task-1",
			principal,
			action: "questionnaire.submit",
		});
		const handle = ports.clock.setTimeout(listener, 20_000);
		ports.clock.clearTimeout(handle);
		ports.logger.info("info", { taskId: "task-1" });
		ports.logger.error("error", { taskId: "task-1" });
		unsubscribe();

		expect(adapters.submitUserMessage).toHaveBeenCalledWith(intake);
		expect(adapters.subscribe).toHaveBeenCalledWith(listener);
		expect(adapters.publish).toHaveBeenCalledWith(event);
		expect(adapters.generateStructured).toHaveBeenCalledWith({
			schemaName: "next_action",
		});
		expect(adapters.assertTaskAction).toHaveBeenCalledWith({
			taskId: "task-1",
			principal,
			action: "questionnaire.submit",
		});
		expect(ports.clock.now()).toEqual(new Date("2026-07-31T00:00:00.000Z"));
		expect(ports.ids.random()).toBe("generated-id");
		expect(adapters.logInfo).toHaveBeenCalled();
		expect(adapters.logError).toHaveBeenCalled();
	});

	it("provides a package-only fake without NightWorkers imports", async () => {
		const fake = createMissionPilotHostPortsFake();
		await expect(
			fake.taskOperator.query({
				taskId: "task-1",
				resource: "task_timeline",
				principal,
			}),
		).resolves.toEqual({});
	});
});

function createAdapters(): MissionPilotHostPortAdapters {
	return {
		query: vi.fn(async () => ({ kind: "query-result" })),
		execute: vi.fn(async () => ({ kind: "action-result" })),
		submitUserMessage: vi.fn(async () => ({ messageId: "message-1" })),
		subscribe: vi.fn(() => vi.fn()),
		publish: vi.fn(async () => {}),
		resolveSystemContext: vi.fn(async () => ({ text: "system context" })),
		generateStructured: vi.fn(async () => ({ value: { action: "wait" } })),
		assertTaskAction: vi.fn(async () => {}),
		now: vi.fn(() => new Date("2026-07-31T00:00:00.000Z")),
		setTimeout: vi.fn(() => 7),
		clearTimeout: vi.fn(),
		randomId: vi.fn(() => "generated-id"),
		logInfo: vi.fn(),
		logError: vi.fn(),
	};
}
