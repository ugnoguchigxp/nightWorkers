import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { planModeRoutingRevisions } from "../api/db/plan-mode-schema";
import { repositories, taskMessages, tasks } from "../api/db/schema";
import {
	getPlanModeRouting,
	updatePlanModeRoutingForDelegatedUser,
	updatePlanModeRoutingForUser,
} from "../api/modules/planMode";
import * as generalSettings from "../api/services/settings/general-settings";
import { updatePlanModeRoutingRequestSchema } from "../shared/schemas/plan-mode-routing.schema";

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
	await db.insert(repositories).values({
		id: repositoryId,
		name: "Plan routing fixture",
		localPath: "/tmp/plan-routing-fixture",
		branch: "main",
	});
	const [task] = await db
		.insert(tasks)
		.values({
			id: taskId,
			repositoryId,
			title: "Edit Plan Artifact routing",
			objective: "Keep required artifacts and edit optional routing",
			status: "ready",
		})
		.returning();
	if (!task) throw new Error("Task fixture was not created.");
	return { task };
}

describe("Plan Mode routing service", () => {
	it("owns a complete initial snapshot without a Mission Pilot session", async () => {
		const { task } = await createFixture();
		const routing = await getPlanModeRouting(task.id);

		expect(routing.revision).toBe(0);
		expect(routing.entries).toHaveLength(9);
		expect(routing.entries.every((entry) => Boolean(entry.reason))).toBe(true);
		expect(routing.entries.filter((entry) => entry.required)).toEqual([
			expect.objectContaining({
				view: "feature_plan",
				decision: "include",
			}),
			expect.objectContaining({
				view: "questionnaire",
				decision: "include",
			}),
		]);
	});

	it("keeps explicit include and omit reasons from canonical Plan Mode messages", async () => {
		const { task } = await createFixture();
		await db.insert(taskMessages).values({
			taskId: task.id,
			role: "system",
			content: "Questionnaire artifact routing",
			messageType: "text",
			metadataJson: {
				viewDecisions: [
					{
						view: "api_io_contract",
						decision: "include",
						reason: "外部APIの入出力境界を確定する必要があります。",
					},
					{
						view: "blueprint",
						decision: "omit",
						reason: "画面変更を伴わないため対象外です。",
					},
				],
			},
		});

		const routing = await getPlanModeRouting(task.id);
		expect(
			routing.entries.find((entry) => entry.view === "api_io_contract"),
		).toMatchObject({
			decision: "include",
			reason: "外部APIの入出力境界を確定する必要があります。",
		});
		expect(
			routing.entries.find((entry) => entry.view === "blueprint"),
		).toMatchObject({
			decision: "omit",
			reason: "画面変更を伴わないため対象外です。",
		});
	});

	it("persists user routing by Task rather than by Mission Pilot session", async () => {
		const { task } = await createFixture();
		const updated = await updatePlanModeRoutingForUser(task.id, {
			expectedRevision: 0,
			idempotencyKey: crypto.randomUUID(),
			changes: [
				{
					view: "api_io_contract",
					decision: "include",
					reason: "request/response契約が実装判断を左右します。",
				},
			],
		});

		expect(updated).toMatchObject({ revision: 1, updatedBy: "user" });
		const persisted = await db.query.planModeRoutingRevisions.findFirst({
			where: eq(planModeRoutingRevisions.taskId, task.id),
		});
		expect(persisted).toMatchObject({
			taskId: task.id,
			revision: 1,
			updatedBy: "user",
		});
	});

	it("gives a delegated user the same routing decisions as a human user", async () => {
		const { task } = await createFixture();
		const included = await updatePlanModeRoutingForDelegatedUser(task.id, {
			expectedRevision: 0,
			idempotencyKey: crypto.randomUUID(),
			changes: [
				{
					view: "api_io_contract",
					decision: "include",
					reason: "外部API境界を明示します。",
				},
			],
		});
		const omitted = await updatePlanModeRoutingForDelegatedUser(task.id, {
			expectedRevision: included.revision,
			idempotencyKey: crypto.randomUUID(),
			changes: [
				{
					view: "api_io_contract",
					decision: "omit",
					reason: "既存契約を変更しない方針に確定しました。",
				},
			],
		});

		expect(omitted.updatedBy).toBe("delegated_user");
		expect(
			omitted.entries.find((entry) => entry.view === "api_io_contract"),
		).toMatchObject({
			decision: "omit",
			reason: "既存契約を変更しない方針に確定しました。",
		});
	});

	it("rejects duplicate views in a routing request", () => {
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
	});

	it("projects Settings capability and rejects unavailable includes", async () => {
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
		const request = {
			expectedRevision: 0,
			idempotencyKey: crypto.randomUUID(),
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
});
