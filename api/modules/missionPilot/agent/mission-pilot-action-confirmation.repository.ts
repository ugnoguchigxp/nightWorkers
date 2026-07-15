import crypto from "node:crypto";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import type { MissionPilotActionConfirmation } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../../db/client";
import { missionPilotActionConfirmations } from "../../../db/mission-pilot-agent-schema";
import { tasks } from "../../../db/schema";

const CONFIRMATION_TTL_MS = 15 * 60_000;

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalize(item)]),
	);
}

export function digestMissionPilotActionArguments(
	argumentsJson: Record<string, unknown>,
) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(canonicalize(argumentsJson)))
		.digest("hex");
}

function confirmationKey(input: {
	actionId: string;
	argumentsDigest: string;
	taskRevision: number;
	taskSnapshotDigest: string;
}) {
	return crypto
		.createHash("sha256")
		.update(
			`${input.actionId}\n${input.argumentsDigest}\n${input.taskRevision}\n${input.taskSnapshotDigest}`,
		)
		.digest("hex");
}

export async function requireOrConsumeMissionPilotActionConfirmation(input: {
	sessionId: string;
	taskId: string;
	toolCallId: string;
	actionId: string;
	argumentsJson: Record<string, unknown>;
	taskRevision: number;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const argumentsDigest = digestMissionPilotActionArguments(
		input.argumentsJson,
	);
	return db.transaction(async (tx) => {
		const [currentTask] = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, input.taskId));
		if (
			!currentTask ||
			currentTask.updatedAt.getTime() !== input.taskRevision
		) {
			return { kind: "stale_revision" } as const;
		}
		const activeKey = confirmationKey({
			actionId: input.actionId,
			argumentsDigest,
			taskRevision: input.taskRevision,
			taskSnapshotDigest: digestTaskSnapshot(currentTask),
		});
		await tx
			.update(missionPilotActionConfirmations)
			.set({ status: "expired", activeKey: null, resolvedAt: now })
			.where(
				and(
					eq(missionPilotActionConfirmations.sessionId, input.sessionId),
					inArray(missionPilotActionConfirmations.status, [
						"pending",
						"approved",
						"denied",
					]),
					lte(missionPilotActionConfirmations.expiresAt, now),
				),
			);
		const [existing] = await tx
			.select()
			.from(missionPilotActionConfirmations)
			.where(
				and(
					eq(missionPilotActionConfirmations.sessionId, input.sessionId),
					eq(missionPilotActionConfirmations.activeKey, activeKey),
				),
			)
			.limit(1);
		if (existing?.status === "approved") {
			const [consumed] = await tx
				.update(missionPilotActionConfirmations)
				.set({
					status: "consumed",
					activeKey: null,
					consumedByToolCallId: input.toolCallId,
					consumedAt: now,
					version: existing.version + 1,
				})
				.where(
					and(
						eq(missionPilotActionConfirmations.id, existing.id),
						eq(missionPilotActionConfirmations.version, existing.version),
						eq(missionPilotActionConfirmations.status, "approved"),
					),
				)
				.returning();
			return consumed
				? ({ kind: "consumed", confirmation: toPublic(consumed) } as const)
				: ({ kind: "conflict" } as const);
		}
		if (existing?.status === "pending") {
			return {
				kind: "pending",
				confirmation: toPublic(existing),
				created: false,
			} as const;
		}
		if (existing?.status === "denied") {
			return {
				kind: "denied",
				confirmation: toPublic(existing),
			} as const;
		}
		const [created] = await tx
			.insert(missionPilotActionConfirmations)
			.values({
				id: crypto.randomUUID(),
				sessionId: input.sessionId,
				taskId: input.taskId,
				requestedToolCallId: input.toolCallId,
				actionId: input.actionId,
				argumentsJson: input.argumentsJson,
				argumentsDigest,
				taskRevision: input.taskRevision,
				activeKey,
				status: "pending",
				version: 0,
				expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_MS),
				createdAt: now,
			})
			.returning();
		if (!created) return { kind: "conflict" } as const;
		return {
			kind: "pending",
			confirmation: toPublic(created),
			created: true,
		} as const;
	});
}

function digestTaskSnapshot(task: typeof tasks.$inferSelect) {
	return crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				title: task.title,
				description: task.description,
				objective: task.objective,
				acceptanceCriteria: task.acceptanceCriteria,
				status: task.status,
				priority: task.priority,
				timeoutSeconds: task.timeoutSeconds,
				worktreePath: task.worktreePath,
			}),
		)
		.digest("hex");
}

export async function listPendingMissionPilotActionConfirmations(
	taskId: string,
) {
	const now = new Date();
	await db
		.update(missionPilotActionConfirmations)
		.set({ status: "expired", activeKey: null, resolvedAt: now })
		.where(
			and(
				eq(missionPilotActionConfirmations.taskId, taskId),
				inArray(missionPilotActionConfirmations.status, [
					"pending",
					"approved",
					"denied",
				]),
				lte(missionPilotActionConfirmations.expiresAt, now),
			),
		);
	const rows = await db
		.select()
		.from(missionPilotActionConfirmations)
		.where(
			and(
				eq(missionPilotActionConfirmations.taskId, taskId),
				inArray(missionPilotActionConfirmations.status, [
					"pending",
					"approved",
				]),
			),
		)
		.orderBy(asc(missionPilotActionConfirmations.createdAt));
	return rows.map(toPublic);
}

export async function resolveMissionPilotActionConfirmation(input: {
	id: string;
	expectedVersion: number;
	decision: "approved" | "denied";
}) {
	const now = new Date();
	const [updated] = await db
		.update(missionPilotActionConfirmations)
		.set({
			status: input.decision,
			resolvedAt: now,
			version: input.expectedVersion + 1,
		})
		.where(
			and(
				eq(missionPilotActionConfirmations.id, input.id),
				eq(missionPilotActionConfirmations.version, input.expectedVersion),
				eq(missionPilotActionConfirmations.status, "pending"),
				gt(missionPilotActionConfirmations.expiresAt, now),
			),
		)
		.returning();
	if (updated) return toPublic(updated);
	const [idempotent] = await db
		.select()
		.from(missionPilotActionConfirmations)
		.where(
			and(
				eq(missionPilotActionConfirmations.id, input.id),
				eq(missionPilotActionConfirmations.version, input.expectedVersion + 1),
				eq(missionPilotActionConfirmations.status, input.decision),
				gt(missionPilotActionConfirmations.expiresAt, now),
			),
		);
	return idempotent ? toPublic(idempotent) : null;
}

export async function listApprovedMissionPilotActionConfirmationSessionIds() {
	const now = new Date();
	const rows = await db
		.select({ sessionId: missionPilotActionConfirmations.sessionId })
		.from(missionPilotActionConfirmations)
		.where(
			and(
				eq(missionPilotActionConfirmations.status, "approved"),
				gt(missionPilotActionConfirmations.expiresAt, now),
			),
		);
	return [...new Set(rows.map((row) => row.sessionId))];
}

function toPublic(
	row: typeof missionPilotActionConfirmations.$inferSelect,
): MissionPilotActionConfirmation {
	return {
		id: row.id,
		sessionId: row.sessionId,
		taskId: row.taskId,
		actionId: row.actionId,
		arguments: row.argumentsJson,
		argumentsDigest: row.argumentsDigest,
		taskRevision: row.taskRevision,
		status: row.status,
		version: row.version,
		expiresAt: row.expiresAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		resolvedAt: row.resolvedAt?.toISOString() ?? null,
		consumedAt: row.consumedAt?.toISOString() ?? null,
	};
}
