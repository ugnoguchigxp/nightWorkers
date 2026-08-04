import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { RuntimeSessionStateStore } from "../api/services/runtime-session-state";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("RuntimeSessionStateStore", () => {
	const store = new RuntimeSessionStateStore();

	it("performs upsert, retrieve, and status updates with all branches", async () => {
		const project = await repo.createRepository({
			name: `TEST: session state repo ${crypto.randomUUID()}`,
			localPath: "/tmp/dummy",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: project.id,
			title: "TEST: session state task",
			status: "running",
		});

		const lookup = {
			taskId: task.id,
			repositoryId: project.id,
			runtimeLane: "test-lane",
			provider: "test-provider",
			executionMode: "test-mode",
		};

		// 1. Upsert first state
		const state1 = await store.upsertRuntimeSessionState({
			...lookup,
			runId: null,
			providerSessionId: "sess-1",
			model: "model-1",
			status: "active",
			metadata: { key: "val1" },
		});
		expect(state1).toBeDefined();
		expect(state1.providerSessionId).toBe("sess-1");
		expect(state1.status).toBe("active");

		// 2. Retrieve latest
		const retrieved1 = await store.getLatestRuntimeSessionStateForTask(lookup);
		expect(retrieved1).toBeDefined();
		expect(retrieved1?.id).toBe(state1.id);

		// 3. Upsert second state (should supersede state1)
		const state2 = await store.upsertRuntimeSessionState({
			...lookup,
			runId: null,
			providerSessionId: "sess-2",
			model: "model-2",
			status: "active",
			metadata: { rawProviderState: { source: "thread.started" } },
		});
		expect(state2).toBeDefined();
		expect(state2.providerSessionId).toBe("sess-2");

		// Retrieve should now return state2
		const retrieved2 = await store.getLatestRuntimeSessionStateForTask(lookup);
		expect(retrieved2?.id).toBe(state2.id);
		const touchedAt = new Date("2026-08-03T05:00:00.000Z");
		const touched = await store.touchRuntimeSessionState({
			id: state2.id,
			now: touchedAt,
		});
		expect(touched?.lastSeenAt).toEqual(touchedAt);

		// 4. Mark invalid
		const invalidState = await store.markRuntimeSessionStateInvalid({
			id: state2.id,
		});
		expect(invalidState?.status).toBe("invalid");

		// 5. Mark superseded
		const supersededState = await store.markRuntimeSessionStateSuperseded({
			id: state2.id,
		});
		expect(supersededState?.status).toBe("superseded");

		// 6. Mark resume failed
		const failedState1 = await store.markRuntimeSessionStateResumeFailed({
			id: state2.id,
		});
		expect(failedState1?.status).toBe("resume_failed");

		const failedState2 = await store.markRuntimeSessionStateResumeFailed({
			id: state2.id,
			error: new Error(
				"Failed to resume; Authorization: Bearer top-secret-token",
			),
		});
		expect(failedState2?.status).toBe("resume_failed");
		expect(failedState2?.metadataJson).toEqual({
			rawProviderState: { source: "thread.started" },
			resumeError: "Error: Failed to resume; Authorization: [REDACTED]",
		});

		// 7. Test nullish variants for repositoryId and executionMode in lookup and matchings
		const lookupNullish = {
			taskId: task.id,
			repositoryId: null,
			runtimeLane: "test-lane-null",
			provider: "test-provider-null",
			executionMode: null,
		};

		const stateNullish1 = await store.upsertRuntimeSessionState({
			...lookupNullish,
			providerSessionId: "sess-null-1",
		});
		expect(stateNullish1.repositoryId).toBeNull();
		expect(stateNullish1.executionMode).toBeNull();

		const retrievedNullish =
			await store.getLatestRuntimeSessionStateForTask(lookupNullish);
		expect(retrievedNullish?.id).toBe(stateNullish1.id);

		// Trigger superseding with nullish fields
		const stateNullish2 = await store.upsertRuntimeSessionState({
			...lookupNullish,
			providerSessionId: "sess-null-2",
		});
		expect(stateNullish2.providerSessionId).toBe("sess-null-2");
	});
});
