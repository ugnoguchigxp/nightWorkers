import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
	missionPilotSteps,
} from "../api/db/mission-pilot-schema";
import { repositories, tasks } from "../api/db/schema";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import {
	executeMissionPilotPlanRoutingTool,
	getPlanModeRouting,
	updatePlanModeRoutingForUser,
} from "../api/modules/planMode/plan-mode-routing.service";
import * as generalSettings from "../api/services/settings/general-settings";
import {
	missionPilotPlanRoutingToolCallSchema,
	updatePlanModeRoutingRequestSchema,
} from "../shared/schemas/plan-mode-routing.schema";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	return db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "Plan routing fixture",
			localPath: "/tmp/plan-routing-fixture",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "Edit Plan Artifact routing",
				objective: "Keep required artifacts and edit optional routing",
				status: "ready",
			})
			.returning();
		const session = await createSession(
			{
				task,
				sourceKind: "task",
				sourceId: task.id,
			},
			tx,
		);
		return { task, session };
	});
}

describe("Plan Mode routing service", () => {
	it("keeps questionnaire and feature plan required in the initial snapshot", async () => {
		const { task } = await createFixture();
		const routing = await getPlanModeRouting(task.id);

		expect(routing.revision).toBe(0);
		expect(routing.entries.filter((entry) => entry.required)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					view: "questionnaire",
					decision: "include",
				}),
				expect.objectContaining({
					view: "feature_plan",
					decision: "include",
				}),
			]),
		);
	});

	it("updates routing and Context atomically while invalidating affected steps", async () => {
		const { task, session } = await createFixture();
		const now = new Date();
		for (const [stepKey, decision] of [
			["view:api_io_contract", "omit"],
			["feature_plan", "include"],
		] as const) {
			await db.insert(missionPilotSteps).values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				stepKey,
				ordinal: stepKey === "feature_plan" ? 2 : 1,
				status: decision === "omit" ? "skipped" : "completed",
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				evidenceJson: { decision },
				createdAt: now,
				updatedAt: now,
			});
		}

		const updated = await updatePlanModeRoutingForUser(task.id, {
			expectedRevision: 0,
			idempotencyKey: crypto.randomUUID(),
			changes: [
				{
					view: "api_io_contract",
					decision: "include",
					reason: "The API boundary is part of the accepted scope.",
				},
			],
		});

		expect(updated.revision).toBe(1);
		expect(
			updated.entries.find((entry) => entry.view === "api_io_contract")
				?.decision,
		).toBe("include");
		const persistedSession = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, session.id),
		});
		expect(persistedSession?.planRoutingRevision).toBe(1);
		expect(persistedSession?.contextRevision).toBe(2);
		const context = await db.query.missionPilotContextSnapshots.findFirst({
			where: eq(missionPilotContextSnapshots.sessionId, session.id),
			orderBy: (row, { desc }) => [desc(row.revision)],
		});
		expect(
			(context?.contextJson.plan as Record<string, unknown>)?.routing,
		).toEqual(expect.objectContaining({ revision: 1, updatedBy: "user" }));
		const steps = await db
			.select()
			.from(missionPilotSteps)
			.where(eq(missionPilotSteps.sessionId, session.id));
		expect(
			steps.find((step) => step.stepKey === "view:api_io_contract")?.status,
		).toBe("pending");
		expect(steps.find((step) => step.stepKey === "feature_plan")?.status).toBe(
			"pending",
		);
	});

	it("limits the Mission Pilot tool to omit-to-include expansion", async () => {
		const { task } = await createFixture();
		const updated = await updatePlanModeRoutingForUser(task.id, {
			expectedRevision: 0,
			idempotencyKey: crypto.randomUUID(),
			changes: [{ view: "blueprint", decision: "include" }],
		});
		expect(
			updated.entries.find((entry) => entry.view === "blueprint")?.reason,
		).toBe("ユーザーが ON に変更しました。");

		await expect(
			executeMissionPilotPlanRoutingTool(task.id, {
				tool: "edit_plan_artifact_routing",
				expectedRevision: 1,
				idempotencyKey: crypto.randomUUID(),
				changes: [
					{
						view: "blueprint",
						decision: "include",
						reason: "Already included",
					},
				],
			}),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_ROUTING_TOOL_SCOPE_VIOLATION",
		});
	});

	it("rejects duplicate views in user and Mission Pilot changes", () => {
		expect(
			updatePlanModeRoutingRequestSchema.safeParse({
				expectedRevision: 0,
				idempotencyKey: crypto.randomUUID(),
				changes: [
					{ view: "blueprint", decision: "include" },
					{ view: "blueprint", decision: "omit" },
				],
			}).success,
		).toBe(false);
		expect(
			missionPilotPlanRoutingToolCallSchema.safeParse({
				tool: "edit_plan_artifact_routing",
				expectedRevision: 0,
				idempotencyKey: crypto.randomUUID(),
				changes: [
					{
						view: "api_io_contract",
						decision: "include",
						reason: "API contract is required.",
					},
					{
						view: "api_io_contract",
						decision: "include",
						reason: "Duplicate request.",
					},
				],
			}).success,
		).toBe(false);
	});

	it("projects Settings capability separately and rejects unavailable includes", async () => {
		const { task } = await createFixture();
		const currentSettings = generalSettings.readGeneralSettings();
		const settingsSpy = vi
			.spyOn(generalSettings, "readGeneralSettings")
			.mockReturnValue({
				...currentSettings,
				planMode: {
					capabilities: {
						...currentSettings.planMode.capabilities,
						api_io_contract: false,
					},
				},
			});
		try {
			const routing = await getPlanModeRouting(task.id);
			expect(
				routing.entries.find((entry) => entry.view === "api_io_contract"),
			).toMatchObject({
				decision: "omit",
				capabilityEnabled: false,
			});
			await expect(
				updatePlanModeRoutingForUser(task.id, {
					expectedRevision: 0,
					idempotencyKey: crypto.randomUUID(),
					changes: [{ view: "api_io_contract", decision: "include" }],
				}),
			).rejects.toMatchObject({
				code: "PLAN_MODE_ROUTING_CAPABILITY_DISABLED",
			});
		} finally {
			settingsSpy.mockRestore();
		}
	});

	it("converges idempotent retries and rejects key reuse with different content", async () => {
		const { task } = await createFixture();
		const idempotencyKey = crypto.randomUUID();
		const request = {
			expectedRevision: 0,
			idempotencyKey,
			changes: [
				{
					view: "sequence_flow" as const,
					decision: "include" as const,
					reason: "Concurrency order must be explicit.",
				},
			],
		};
		const first = await updatePlanModeRoutingForUser(task.id, request);
		const replay = await updatePlanModeRoutingForUser(task.id, request);
		expect(first.revision).toBe(1);
		expect(replay.revision).toBe(1);

		await expect(
			updatePlanModeRoutingForUser(task.id, {
				...request,
				changes: [
					{
						view: "activity_flow",
						decision: "include",
						reason: "Different operation with a reused key.",
					},
				],
			}),
		).rejects.toMatchObject({
			code: "PLAN_MODE_ROUTING_IDEMPOTENCY_CONFLICT",
		});
	});

	it("rejects edits after the Mission Pilot reaches Queue state", async () => {
		const { task, session } = await createFixture();
		await db
			.update(missionPilotSessions)
			.set({ phase: "queued" })
			.where(eq(missionPilotSessions.id, session.id));

		await expect(
			updatePlanModeRoutingForUser(task.id, {
				expectedRevision: 0,
				idempotencyKey: crypto.randomUUID(),
				changes: [{ view: "data_model", decision: "include" }],
			}),
		).rejects.toMatchObject({ code: "PLAN_MODE_ROUTING_LOCKED" });
	});

	it("rejects user edits while Mission Pilot is rebuilding the plan", async () => {
		const { task, session } = await createFixture();
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing", leaseOwner: "test-owner" })
			.where(eq(missionPilotSessions.id, session.id));

		await expect(
			updatePlanModeRoutingForUser(task.id, {
				expectedRevision: 0,
				idempotencyKey: crypto.randomUUID(),
				changes: [{ view: "data_model", decision: "include" }],
			}),
		).rejects.toMatchObject({
			code: "PLAN_MODE_ROUTING_REBUILD_IN_PROGRESS",
		});
	});
});
