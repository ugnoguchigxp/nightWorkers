import { and, asc, desc, eq } from "drizzle-orm";
import {
	type MissionActor,
	type MissionApproval,
	type MissionAttentionItem,
	type MissionAutopilotGrant,
	type MissionEvaluation,
	type MissionEvent,
	type MissionEvidenceRef,
	type MissionObjective,
	type MissionPlanRevision,
	type MissionReplanSuggestion,
	type MissionTask,
	missionApprovalSchema,
	missionAttentionItemSchema,
	missionAutopilotGrantSchema,
	missionEvaluationSchema,
	missionEventSchema,
	missionObjectiveSchema,
	missionPlanRevisionSchema,
	missionReplanSuggestionSchema,
	missionTaskSchema,
	type PilotAction,
	pilotActionSchema,
} from "../../../shared/schemas/mission-pilot.schema";
import type { MissionPlanningResult } from "../../../shared/schemas/mission-planner.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	missionApprovals,
	missionAttentionItems,
	missionAutopilotGrants,
	missionEvaluations,
	missionEvents,
	missionObjectives,
	missionPlanRevisions,
	missionReplanSuggestions,
	missionTasks,
	pilotActions,
} from "../../db/mission-pilot-schema";

type Db = typeof db | DbTransaction;

function toStringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function mapObjective(
	row: typeof missionObjectives.$inferSelect,
): MissionObjective {
	return missionObjectiveSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		planningResultId: row.planningResultId,
		externalObjectiveId: row.externalObjectiveId,
		title: row.title,
		completionCriteria: toStringArray(row.completionCriteriaJson),
		verificationGate: toStringArray(row.verificationGateJson),
		status: row.status,
		evidenceRefs: Array.isArray(row.evidenceRefsJson)
			? row.evidenceRefsJson
			: [],
		statusReason: row.statusReason ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapEvent(row: typeof missionEvents.$inferSelect): MissionEvent {
	return missionEventSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		missionTaskId: row.missionTaskId ?? null,
		eventType: row.eventType,
		summary: row.summary,
		actor: row.actorJson,
		payload: row.payloadJson ?? null,
		evidenceRefs: Array.isArray(row.evidenceRefsJson)
			? row.evidenceRefsJson
			: [],
		sourceKind: row.sourceKind,
		sourceId: row.sourceId,
		sourceVersion: row.sourceVersion,
		occurredAt: row.occurredAt,
		createdAt: row.createdAt,
	});
}

function mapPilotAction(row: typeof pilotActions.$inferSelect): PilotAction {
	return pilotActionSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		targetType: row.targetType ?? null,
		targetId: row.targetId ?? null,
		type: row.type,
		status: row.status,
		idempotencyKey: row.idempotencyKey,
		requestHash: row.requestHash,
		reason: row.reason,
		actor: row.actorJson,
		evidenceRefs: Array.isArray(row.evidenceRefsJson)
			? row.evidenceRefsJson
			: [],
		resultRef: row.resultRefJson ?? null,
		requiresHumanAttention: row.requiresHumanAttention,
		errorCode: row.errorCode ?? null,
		errorMessage: row.errorMessage ?? null,
		startedAt: row.startedAt,
		completedAt: row.completedAt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapApproval(
	row: typeof missionApprovals.$inferSelect,
): MissionApproval {
	return missionApprovalSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		targetType: row.targetType,
		targetId: row.targetId,
		approvalType: row.approvalType,
		status: row.status,
		riskLevel: row.riskLevel,
		approvalRequired: row.approvalRequired,
		requestedReason: row.requestedReason,
		requestedByActor: row.requestedByActorJson,
		decidedByActor: row.decidedByActorJson ?? null,
		decisionReason: row.decisionReason ?? null,
		snapshot: row.snapshotJson,
		snapshotHash: row.snapshotHash,
		requestedAt: row.requestedAt,
		decidedAt: row.decidedAt ?? null,
		expiresAt: row.expiresAt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapAttention(
	row: typeof missionAttentionItems.$inferSelect,
): MissionAttentionItem {
	return missionAttentionItemSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		targetType: row.targetType,
		targetId: row.targetId,
		type: row.type,
		status: row.status,
		severity: row.severity,
		title: row.title,
		summary: row.summary,
		actionSchema: row.actionSchemaJson,
		evidenceRefs: Array.isArray(row.evidenceRefsJson)
			? row.evidenceRefsJson
			: [],
		sourceEventId: row.sourceEventId ?? null,
		sourceRef: row.sourceRefJson ?? null,
		resolvedByActor: row.resolvedByActorJson ?? null,
		resolvedAt: row.resolvedAt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapMissionTask(row: typeof missionTasks.$inferSelect): MissionTask {
	return missionTaskSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		planningResultId: row.planningResultId,
		taskCandidateId: row.taskCandidateId,
		objectiveIds: Array.isArray(row.objectiveIdsJson)
			? row.objectiveIdsJson
			: [],
		nightworkersTaskId: row.nightworkersTaskId ?? null,
		queueEntryId: row.queueEntryId ?? null,
		activeRunId: row.activeRunId ?? null,
		approvalId: row.approvalId,
		approvalSnapshotHash: row.approvalSnapshotHash,
		title: row.title,
		purpose: row.purpose,
		status: row.status,
		riskLevel: row.riskLevel,
		approvalRequired: row.approvalRequired,
		dependencies: Array.isArray(row.dependenciesJson)
			? row.dependenciesJson
			: [],
		verificationGate: Array.isArray(row.verificationGateJson)
			? row.verificationGateJson
			: [],
		scheduling: row.schedulingJson,
		lastSyncedAt: row.lastSyncedAt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapAutopilotGrant(
	row: typeof missionAutopilotGrants.$inferSelect,
): MissionAutopilotGrant {
	return missionAutopilotGrantSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		autonomyLevel: row.autonomyLevel,
		allowedActions: Array.isArray(row.allowedActionsJson)
			? row.allowedActionsJson
			: [],
		status: row.status,
		grantedByActor: row.grantedByActorJson,
		expiresAt: row.expiresAt ?? null,
		pausedAt: row.pausedAt ?? null,
		revokedAt: row.revokedAt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapEvaluation(
	row: typeof missionEvaluations.$inferSelect,
): MissionEvaluation {
	return missionEvaluationSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		scopeType: row.scopeType,
		scopeId: row.scopeId,
		missionTaskId: row.missionTaskId ?? null,
		runId: row.runId ?? null,
		result: row.result,
		summary: row.summary,
		objectiveUpdates: row.objectiveUpdatesJson,
		evidenceRefs: row.evidenceRefsJson,
		inputDigest: row.inputDigest,
		nextRecommendedAction: row.nextRecommendedAction,
		createdByActor: row.createdByActorJson,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapPlanRevision(
	row: typeof missionPlanRevisions.$inferSelect,
): MissionPlanRevision {
	return missionPlanRevisionSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		baseRevisionId: row.baseRevisionId ?? null,
		planningResultId: row.planningResultId,
		revisionNumber: row.revisionNumber,
		summary: row.summary,
		taskGraph: row.taskGraphJson,
		appliedDiff: row.appliedDiffJson ?? null,
		createdByActor: row.createdByActorJson,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

function mapReplanSuggestion(
	row: typeof missionReplanSuggestions.$inferSelect,
): MissionReplanSuggestion {
	return missionReplanSuggestionSchema.parse({
		id: row.id,
		missionId: row.missionId,
		repositoryId: row.repositoryId,
		baseRevisionId: row.baseRevisionId,
		sourceEvaluationId: row.sourceEvaluationId,
		status: row.status,
		reason: row.reason,
		taskGraphDiff: row.taskGraphDiffJson,
		diffHash: row.diffHash,
		approvalId: row.approvalId ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	});
}

export async function getMissionEvaluation(id: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionEvaluations)
		.where(eq(missionEvaluations.id, id))
		.limit(1);
	return row ? mapEvaluation(row) : null;
}

export async function getLatestPlanRevision(
	missionId: string,
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionPlanRevisions)
		.where(eq(missionPlanRevisions.missionId, missionId))
		.orderBy(desc(missionPlanRevisions.revisionNumber))
		.limit(1);
	return row ? mapPlanRevision(row) : null;
}

export async function findPlanRevisionByPlanningResult(
	input: { missionId: string; planningResultId: string },
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionPlanRevisions)
		.where(
			and(
				eq(missionPlanRevisions.missionId, input.missionId),
				eq(missionPlanRevisions.planningResultId, input.planningResultId),
			),
		)
		.limit(1);
	return row ? mapPlanRevision(row) : null;
}

export async function createPlanRevision(
	input: Omit<
		typeof missionPlanRevisions.$inferInsert,
		"id" | "createdAt" | "updatedAt"
	>,
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionPlanRevisions)
		.values({ ...input, createdAt: now, updatedAt: now })
		.returning();
	return mapPlanRevision(row);
}

export async function getReplanSuggestion(id: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionReplanSuggestions)
		.where(eq(missionReplanSuggestions.id, id))
		.limit(1);
	return row ? mapReplanSuggestion(row) : null;
}

export async function listReplanSuggestions(
	missionId: string,
	database: Db = db,
) {
	const rows = await database
		.select()
		.from(missionReplanSuggestions)
		.where(eq(missionReplanSuggestions.missionId, missionId))
		.orderBy(desc(missionReplanSuggestions.createdAt));
	return rows.map(mapReplanSuggestion);
}

export async function findReplanSuggestionByDiff(
	input: { missionId: string; sourceEvaluationId: string; diffHash: string },
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionReplanSuggestions)
		.where(
			and(
				eq(missionReplanSuggestions.missionId, input.missionId),
				eq(
					missionReplanSuggestions.sourceEvaluationId,
					input.sourceEvaluationId,
				),
				eq(missionReplanSuggestions.diffHash, input.diffHash),
			),
		)
		.limit(1);
	return row ? mapReplanSuggestion(row) : null;
}

export async function createReplanSuggestion(
	input: Omit<
		typeof missionReplanSuggestions.$inferInsert,
		"id" | "createdAt" | "updatedAt"
	>,
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionReplanSuggestions)
		.values({ ...input, createdAt: now, updatedAt: now })
		.returning();
	return mapReplanSuggestion(row);
}

export async function updateReplanSuggestion(
	id: string,
	input: Partial<
		Pick<typeof missionReplanSuggestions.$inferInsert, "status" | "approvalId">
	>,
	database: Db = db,
) {
	const [row] = await database
		.update(missionReplanSuggestions)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(missionReplanSuggestions.id, id))
		.returning();
	return row ? mapReplanSuggestion(row) : null;
}

export async function getLatestMissionEvaluation(
	missionId: string,
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionEvaluations)
		.where(eq(missionEvaluations.missionId, missionId))
		.orderBy(desc(missionEvaluations.createdAt))
		.limit(1);
	return row ? mapEvaluation(row) : null;
}

export async function findMissionEvaluationByDigest(
	input: {
		missionId: string;
		scopeType: "mission" | "mission_task";
		scopeId: string;
		inputDigest: string;
	},
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionEvaluations)
		.where(
			and(
				eq(missionEvaluations.missionId, input.missionId),
				eq(missionEvaluations.scopeType, input.scopeType),
				eq(missionEvaluations.scopeId, input.scopeId),
				eq(missionEvaluations.inputDigest, input.inputDigest),
			),
		)
		.limit(1);
	return row ? mapEvaluation(row) : null;
}

export async function createMissionEvaluation(
	input: Omit<
		typeof missionEvaluations.$inferInsert,
		"id" | "createdAt" | "updatedAt"
	>,
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionEvaluations)
		.values({ ...input, createdAt: now, updatedAt: now })
		.returning();
	return mapEvaluation(row);
}

export async function updateObjectiveStatus(
	input: {
		objectiveId: string;
		status: string;
		statusReason: string;
		evidenceRefs: MissionEvidenceRef[];
	},
	database: Db = db,
) {
	const [row] = await database
		.update(missionObjectives)
		.set({
			status: input.status,
			statusReason: input.statusReason,
			evidenceRefsJson: input.evidenceRefs,
			updatedAt: new Date(),
		})
		.where(eq(missionObjectives.id, input.objectiveId))
		.returning();
	return row ? mapObjective(row) : null;
}

export async function getAutopilotGrant(id: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionAutopilotGrants)
		.where(eq(missionAutopilotGrants.id, id))
		.limit(1);
	return row ? mapAutopilotGrant(row) : null;
}

export async function getActiveAutopilotGrant(
	missionId: string,
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionAutopilotGrants)
		.where(
			and(
				eq(missionAutopilotGrants.missionId, missionId),
				eq(missionAutopilotGrants.status, "active"),
			),
		)
		.limit(1);
	return row ? mapAutopilotGrant(row) : null;
}

export async function getLatestAutopilotGrant(
	missionId: string,
	database: Db = db,
) {
	const rows = await database
		.select()
		.from(missionAutopilotGrants)
		.where(eq(missionAutopilotGrants.missionId, missionId))
		.orderBy(desc(missionAutopilotGrants.createdAt))
		.limit(1);
	return rows[0] ? mapAutopilotGrant(rows[0]) : null;
}

export async function createAutopilotGrant(
	input: {
		missionId: string;
		repositoryId: string;
		autonomyLevel: 1;
		allowedActions: string[];
		grantedByActor: MissionActor;
		expiresAt?: Date | null;
	},
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionAutopilotGrants)
		.values({
			missionId: input.missionId,
			repositoryId: input.repositoryId,
			autonomyLevel: input.autonomyLevel,
			allowedActionsJson: input.allowedActions,
			status: "active",
			grantedByActorJson: input.grantedByActor,
			expiresAt: input.expiresAt ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return mapAutopilotGrant(row);
}

export async function updateAutopilotGrant(
	id: string,
	input: {
		status: "active" | "paused" | "revoked" | "expired";
		pausedAt?: Date | null;
		revokedAt?: Date | null;
	},
	database: Db = db,
) {
	const [row] = await database
		.update(missionAutopilotGrants)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(missionAutopilotGrants.id, id))
		.returning();
	return row ? mapAutopilotGrant(row) : null;
}

export async function getMissionTask(id: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionTasks)
		.where(eq(missionTasks.id, id))
		.limit(1);
	return row ? mapMissionTask(row) : null;
}

export async function findMissionTaskByCandidate(
	taskCandidateId: string,
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionTasks)
		.where(eq(missionTasks.taskCandidateId, taskCandidateId))
		.limit(1);
	return row ? mapMissionTask(row) : null;
}

export async function findMissionTaskByNightworkersTask(
	nightworkersTaskId: string,
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionTasks)
		.where(eq(missionTasks.nightworkersTaskId, nightworkersTaskId))
		.limit(1);
	return row ? mapMissionTask(row) : null;
}

export async function listMissionTasks(missionId: string, database: Db = db) {
	const rows = await database
		.select()
		.from(missionTasks)
		.where(eq(missionTasks.missionId, missionId))
		.orderBy(asc(missionTasks.createdAt));
	return rows.map(mapMissionTask);
}

export async function createMissionTask(
	input: Omit<
		typeof missionTasks.$inferInsert,
		"id" | "createdAt" | "updatedAt"
	>,
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionTasks)
		.values({ ...input, createdAt: now, updatedAt: now })
		.returning();
	return mapMissionTask(row);
}

export async function updateMissionTask(
	id: string,
	input: Partial<
		Pick<
			typeof missionTasks.$inferInsert,
			| "status"
			| "nightworkersTaskId"
			| "queueEntryId"
			| "activeRunId"
			| "lastSyncedAt"
		>
	>,
	database: Db = db,
) {
	const [row] = await database
		.update(missionTasks)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(missionTasks.id, id))
		.returning();
	return row ? mapMissionTask(row) : null;
}

export async function getApproval(approvalId: string, database: Db = db) {
	const [row] = await database
		.select()
		.from(missionApprovals)
		.where(eq(missionApprovals.id, approvalId))
		.limit(1);
	return row ? mapApproval(row) : null;
}

export async function listApprovals(missionId: string, database: Db = db) {
	const rows = await database
		.select()
		.from(missionApprovals)
		.where(eq(missionApprovals.missionId, missionId))
		.orderBy(asc(missionApprovals.createdAt));
	return rows.map(mapApproval);
}

export async function findOpenApproval(
	input: {
		missionId: string;
		targetType: string;
		targetId: string;
		approvalType: string;
		snapshotHash: string;
	},
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionApprovals)
		.where(
			and(
				eq(missionApprovals.missionId, input.missionId),
				eq(missionApprovals.targetType, input.targetType),
				eq(missionApprovals.targetId, input.targetId),
				eq(missionApprovals.approvalType, input.approvalType),
				eq(missionApprovals.snapshotHash, input.snapshotHash),
				eq(missionApprovals.status, "requested"),
			),
		)
		.limit(1);
	return row ? mapApproval(row) : null;
}

export async function createApproval(
	input: {
		missionId: string;
		repositoryId: string;
		targetType: string;
		targetId: string;
		approvalType: string;
		riskLevel: string;
		approvalRequired: boolean;
		requestedReason: string;
		requestedByActor: MissionActor;
		snapshot: unknown;
		snapshotHash: string;
	},
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionApprovals)
		.values({
			missionId: input.missionId,
			repositoryId: input.repositoryId,
			targetType: input.targetType,
			targetId: input.targetId,
			approvalType: input.approvalType,
			status: "requested",
			riskLevel: input.riskLevel,
			approvalRequired: input.approvalRequired,
			requestedReason: input.requestedReason,
			requestedByActorJson: input.requestedByActor,
			snapshotJson: input.snapshot,
			snapshotHash: input.snapshotHash,
			requestedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return mapApproval(row);
}

export async function decideApproval(
	input: {
		approvalId: string;
		status: "approved" | "rejected" | "stale";
		actor: MissionActor;
		reason: string;
	},
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.update(missionApprovals)
		.set({
			status: input.status,
			decidedByActorJson: input.actor,
			decisionReason: input.reason,
			decidedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionApprovals.id, input.approvalId),
				eq(missionApprovals.status, "requested"),
			),
		)
		.returning();
	return row ? mapApproval(row) : null;
}

export async function listAttentionItems(missionId: string, database: Db = db) {
	const rows = await database
		.select()
		.from(missionAttentionItems)
		.where(eq(missionAttentionItems.missionId, missionId))
		.orderBy(asc(missionAttentionItems.createdAt));
	return rows.map(mapAttention);
}

export async function findOpenAttention(
	input: {
		missionId: string;
		type: string;
		targetType: string;
		targetId: string;
	},
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(missionAttentionItems)
		.where(
			and(
				eq(missionAttentionItems.missionId, input.missionId),
				eq(missionAttentionItems.type, input.type),
				eq(missionAttentionItems.targetType, input.targetType),
				eq(missionAttentionItems.targetId, input.targetId),
				eq(missionAttentionItems.status, "open"),
			),
		)
		.limit(1);
	return row ? mapAttention(row) : null;
}

export async function createAttention(
	input: {
		missionId: string;
		repositoryId: string;
		targetType: string;
		targetId: string;
		type: string;
		severity: string;
		title: string;
		summary: string;
		actionSchema: unknown;
		sourceRef?: unknown;
	},
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(missionAttentionItems)
		.values({
			missionId: input.missionId,
			repositoryId: input.repositoryId,
			targetType: input.targetType,
			targetId: input.targetId,
			type: input.type,
			status: "open",
			severity: input.severity,
			title: input.title,
			summary: input.summary,
			actionSchemaJson: input.actionSchema,
			evidenceRefsJson: [],
			sourceRefJson: input.sourceRef ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return mapAttention(row);
}

export async function resolveAttentionForTarget(
	input: {
		missionId: string;
		type: string;
		targetType: string;
		targetId: string;
		actor: MissionActor;
	},
	database: Db = db,
) {
	const now = new Date();
	await database
		.update(missionAttentionItems)
		.set({
			status: "resolved",
			resolvedByActorJson: input.actor,
			resolvedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(missionAttentionItems.missionId, input.missionId),
				eq(missionAttentionItems.type, input.type),
				eq(missionAttentionItems.targetType, input.targetType),
				eq(missionAttentionItems.targetId, input.targetId),
				eq(missionAttentionItems.status, "open"),
			),
		);
}

export async function getPilotActionByKey(
	input: { missionId: string; type: string; idempotencyKey: string },
	database: Db = db,
) {
	const [row] = await database
		.select()
		.from(pilotActions)
		.where(
			and(
				eq(pilotActions.missionId, input.missionId),
				eq(pilotActions.type, input.type),
				eq(pilotActions.idempotencyKey, input.idempotencyKey),
			),
		)
		.limit(1);
	return row ? mapPilotAction(row) : null;
}

export async function createCompletedPilotAction(
	input: {
		missionId: string;
		repositoryId: string;
		targetType?: string | null;
		targetId?: string | null;
		type: string;
		idempotencyKey: string;
		requestHash: string;
		reason: string;
		actor: MissionActor;
		resultRef?: unknown;
	},
	database: Db = db,
) {
	const now = new Date();
	const [row] = await database
		.insert(pilotActions)
		.values({
			missionId: input.missionId,
			repositoryId: input.repositoryId,
			targetType: input.targetType ?? null,
			targetId: input.targetId ?? null,
			type: input.type,
			status: "completed",
			idempotencyKey: input.idempotencyKey,
			requestHash: input.requestHash,
			reason: input.reason,
			actorJson: input.actor,
			evidenceRefsJson: [],
			resultRefJson: input.resultRef ?? null,
			requiresHumanAttention: false,
			startedAt: now,
			completedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return mapPilotAction(row);
}

export async function upsertObjectivesFromPlanningResult(
	input: {
		missionId: string;
		repositoryId: string;
		planningResult: MissionPlanningResult;
	},
	database: Db = db,
) {
	const now = new Date();
	for (const objective of input.planningResult.planningResult.objectives) {
		await database
			.insert(missionObjectives)
			.values({
				missionId: input.missionId,
				repositoryId: input.repositoryId,
				planningResultId: input.planningResult.id,
				externalObjectiveId: objective.id,
				title: objective.title,
				completionCriteriaJson: objective.completionCriteria,
				verificationGateJson: objective.verificationGate,
				status: "pending",
				evidenceRefsJson: [],
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					missionObjectives.planningResultId,
					missionObjectives.externalObjectiveId,
				],
				set: {
					title: objective.title,
					completionCriteriaJson: objective.completionCriteria,
					verificationGateJson: objective.verificationGate,
					updatedAt: now,
				},
			});
	}
	return listObjectives(input.missionId, input.planningResult.id, database);
}

export async function listObjectives(
	missionId: string,
	planningResultId?: string,
	database: Db = db,
) {
	const rows = await database
		.select()
		.from(missionObjectives)
		.where(
			planningResultId
				? and(
						eq(missionObjectives.missionId, missionId),
						eq(missionObjectives.planningResultId, planningResultId),
					)
				: eq(missionObjectives.missionId, missionId),
		)
		.orderBy(asc(missionObjectives.createdAt));
	return rows.map(mapObjective);
}

export async function appendMissionEvent(
	input: {
		missionId: string;
		repositoryId: string;
		missionTaskId?: string | null;
		eventType: string;
		summary: string;
		actor: MissionActor;
		payload?: unknown;
		evidenceRefs?: MissionEvidenceRef[];
		sourceKind: string;
		sourceId: string;
		sourceVersion?: string;
		occurredAt?: Date;
	},
	database: Db = db,
) {
	await database
		.insert(missionEvents)
		.values({
			missionId: input.missionId,
			repositoryId: input.repositoryId,
			missionTaskId: input.missionTaskId ?? null,
			eventType: input.eventType,
			summary: input.summary,
			actorJson: input.actor,
			payloadJson: input.payload ?? null,
			evidenceRefsJson: input.evidenceRefs ?? [],
			sourceKind: input.sourceKind,
			sourceId: input.sourceId,
			sourceVersion: input.sourceVersion ?? "1",
			occurredAt: input.occurredAt ?? new Date(),
			createdAt: new Date(),
		})
		.onConflictDoNothing();
}

export async function listMissionEvents(missionId: string, database: Db = db) {
	const rows = await database
		.select()
		.from(missionEvents)
		.where(eq(missionEvents.missionId, missionId))
		.orderBy(asc(missionEvents.occurredAt), asc(missionEvents.createdAt));
	return rows.map(mapEvent);
}
