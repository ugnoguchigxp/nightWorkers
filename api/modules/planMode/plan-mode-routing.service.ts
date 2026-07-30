import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type {
	PlanModeRoutingActor,
	PlanModeRoutingEntry,
	PlanModeRoutingSnapshot,
	PlanModeRoutingView,
	UpdatePlanModeRoutingRequest,
} from "../../../shared/schemas/plan-mode-routing.schema";
import { db } from "../../db/client";
import { planModeRoutingRevisions } from "../../db/plan-mode-schema";
import { tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { readGeneralSettings } from "../../services/settings/general-settings";
import {
	ALL_PLAN_MODE_ROUTING_VIEWS,
	buildInitialPlanModeRoutingEntries,
	normalizePlanModeRoutingEntries,
	planModeRoutingTerminalReason,
} from "../agentsShare";
import { listPlanModeTaskMessages } from "../nightworkers/nightworkers.plan-mode-core.port";
import { publishPlanModeRoutingChanged } from "./plan-mode-routing-realtime";

type TaskMessage = Awaited<ReturnType<typeof listPlanModeTaskMessages>>[number];

function routingRequestHash(
	actor: PlanModeRoutingActor,
	request: UpdatePlanModeRoutingRequest,
) {
	const serialized = JSON.stringify({
		actor,
		expectedRevision: request.expectedRevision,
		changes: [...request.changes].sort((left, right) =>
			left.view.localeCompare(right.view),
		),
	});
	return crypto.createHash("sha256").update(serialized).digest("hex");
}

function assertIdempotencyReplayMatches(
	requestHash: string | null,
	expectedHash: string,
) {
	if (requestHash === expectedHash) return;
	throw new AppError(
		409,
		"PLAN_MODE_ROUTING_IDEMPOTENCY_CONFLICT",
		"同じ idempotency key が別の routing 変更に使用されています。",
	);
}

async function latestRoutingRevision(taskId: string) {
	return db.query.planModeRoutingRevisions.findFirst({
		where: eq(planModeRoutingRevisions.taskId, taskId),
		orderBy: [desc(planModeRoutingRevisions.revision)],
	});
}

export async function getPlanModeRouting(
	taskId: string,
	options: {
		messages?: TaskMessage[];
		taskStatus?: string;
	} = {},
): Promise<PlanModeRoutingSnapshot> {
	const capabilities = readGeneralSettings().planMode.capabilities;
	const [task, persisted] = await Promise.all([
		db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
		latestRoutingRevision(taskId),
	]);
	if (!task) throw new NotFoundError("Task not found");
	const lockedReason = planModeRoutingTerminalReason(
		options.taskStatus ?? task.status,
	);
	if (!persisted) {
		const messages =
			options.messages ?? (await listPlanModeTaskMessages(taskId));
		return {
			revision: 0,
			entries: buildInitialPlanModeRoutingEntries(messages, capabilities),
			editable: !lockedReason,
			lockedReason,
			updatedBy: null,
			updatedAt: null,
		};
	}
	return {
		revision: persisted.revision,
		entries: normalizePlanModeRoutingEntries(
			persisted.entriesJson,
			capabilities,
		),
		editable: !lockedReason,
		lockedReason,
		updatedBy: persisted.updatedBy,
		updatedAt: persisted.createdAt,
	};
}

function defaultChangeReason(
	actor: PlanModeRoutingActor,
	view: PlanModeRoutingView,
	decision: "include" | "omit",
) {
	const action = decision === "include" ? "必要" : "対象外";
	if (actor === "questionnaire_recommender")
		return `Questionnaire回答に基づき、${view}を${action}と判断しました。`;
	if (actor === "delegated_user")
		return `ユーザー代理が${view}を${action}と判断しました。`;
	return `ユーザーが${view}を${action}に変更しました。`;
}

function updateReason(actor: PlanModeRoutingActor) {
	if (actor === "questionnaire_recommender")
		return "Questionnaire回答からPlan Artifact routingを更新しました。";
	if (actor === "delegated_user")
		return "ユーザー代理がPlan Artifact routingを更新しました。";
	return "ユーザーがPlan Artifact routingを更新しました。";
}

async function isAppliedRoutingRequest(input: {
	taskId: string;
	idempotencyKey: string;
	requestHash: string;
}) {
	const existing = await db.query.planModeRoutingRevisions.findFirst({
		where: and(
			eq(planModeRoutingRevisions.taskId, input.taskId),
			eq(planModeRoutingRevisions.idempotencyKey, input.idempotencyKey),
		),
	});
	if (!existing) return false;
	assertIdempotencyReplayMatches(existing.requestHash, input.requestHash);
	return true;
}

async function persistRoutingRevision(input: {
	taskId: string;
	expectedRevision: number;
	idempotencyKey: string;
	requestHash: string;
	entries: PlanModeRoutingEntry[];
	actor: PlanModeRoutingActor;
}) {
	return db.transaction(async (tx) => {
		const task = await tx.query.tasks.findFirst({
			where: eq(tasks.id, input.taskId),
		});
		if (!task) throw new NotFoundError("Task not found");
		const replay = await tx.query.planModeRoutingRevisions.findFirst({
			where: and(
				eq(planModeRoutingRevisions.taskId, input.taskId),
				eq(planModeRoutingRevisions.idempotencyKey, input.idempotencyKey),
			),
		});
		if (replay) {
			assertIdempotencyReplayMatches(replay.requestHash, input.requestHash);
			return replay;
		}
		const latest = await tx.query.planModeRoutingRevisions.findFirst({
			where: eq(planModeRoutingRevisions.taskId, input.taskId),
			orderBy: [desc(planModeRoutingRevisions.revision)],
		});
		const currentRevision = latest?.revision ?? 0;
		if (currentRevision !== input.expectedRevision) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_REVISION_CONFLICT",
				"Plan Artifact routing が別の操作で更新されました。再読み込みしてください。",
				{ currentRevision },
			);
		}
		const [created] = await tx
			.insert(planModeRoutingRevisions)
			.values({
				id: crypto.randomUUID(),
				taskId: input.taskId,
				revision: currentRevision + 1,
				entriesJson: input.entries,
				updatedBy: input.actor,
				reason: updateReason(input.actor),
				idempotencyKey: input.idempotencyKey,
				requestHash: input.requestHash,
				createdAt: new Date(),
			})
			.returning();
		if (!created)
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_REVISION_CONFLICT",
				"Plan Artifact routing が更新中です。再読み込みしてください。",
			);
		return created;
	});
}

export async function updatePlanModeRouting(input: {
	taskId: string;
	request: UpdatePlanModeRoutingRequest;
	actor: PlanModeRoutingActor;
}) {
	const requestHash = routingRequestHash(input.actor, input.request);
	if (
		await isAppliedRoutingRequest({
			taskId: input.taskId,
			idempotencyKey: input.request.idempotencyKey,
			requestHash,
		})
	)
		return getPlanModeRouting(input.taskId);

	const current = await getPlanModeRouting(input.taskId);
	if (!current.editable)
		throw new AppError(
			409,
			"PLAN_MODE_ROUTING_LOCKED",
			current.lockedReason ?? "Plan Artifact routing is locked",
		);
	if (current.revision !== input.request.expectedRevision)
		throw new AppError(
			409,
			"PLAN_MODE_ROUTING_REVISION_CONFLICT",
			"Plan Artifact routing が別の操作で更新されました。再読み込みしてください。",
			{ currentRevision: current.revision },
		);

	const nextByView = new Map(
		current.entries.map((entry) => [entry.view, entry]),
	);
	let changed = false;
	for (const change of input.request.changes) {
		const previous = nextByView.get(change.view);
		if (!previous) continue;
		if (change.decision === "include" && !previous.capabilityEnabled)
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_CAPABILITY_DISABLED",
				`${change.view} は Settings で無効なため ON にできません。`,
			);
		const reason =
			change.reason?.trim() ||
			defaultChangeReason(input.actor, change.view, change.decision);
		if (previous.decision === change.decision && previous.reason === reason)
			continue;
		nextByView.set(change.view, {
			...previous,
			decision: change.decision,
			reason,
		});
		changed = true;
	}
	if (!changed) return current;

	await persistRoutingRevision({
		taskId: input.taskId,
		expectedRevision: current.revision,
		idempotencyKey: input.request.idempotencyKey,
		requestHash,
		entries: ALL_PLAN_MODE_ROUTING_VIEWS.map((view) => {
			const entry = nextByView.get(view);
			if (!entry) throw new Error(`Routing entry is missing: ${view}`);
			return entry;
		}),
		actor: input.actor,
	});
	const updated = await getPlanModeRouting(input.taskId);
	publishPlanModeRoutingChanged(input.taskId, updated);
	return updated;
}

export function updatePlanModeRoutingForUser(
	taskId: string,
	request: UpdatePlanModeRoutingRequest,
) {
	return updatePlanModeRouting({ taskId, request, actor: "user" });
}

export function updatePlanModeRoutingForDelegatedUser(
	taskId: string,
	request: UpdatePlanModeRoutingRequest,
) {
	return updatePlanModeRouting({
		taskId,
		request,
		actor: "delegated_user",
	});
}

export function updatePlanModeRoutingFromQuestionnaire(
	taskId: string,
	request: UpdatePlanModeRoutingRequest,
) {
	return updatePlanModeRouting({
		taskId,
		request,
		actor: "questionnaire_recommender",
	});
}
