import crypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
	EDITABLE_PLAN_MODE_ROUTING_VIEWS,
	type MissionPilotPlanRoutingToolCall,
	type PlanModeRoutingActor,
	type PlanModeRoutingEntry,
	type PlanModeRoutingSnapshot,
	type PlanModeRoutingView,
	REQUIRED_PLAN_MODE_ROUTING_VIEWS,
	type UpdatePlanModeRoutingRequest,
} from "../../../shared/schemas/plan-mode-routing.schema";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPlanRoutingRevisions,
	missionPilotSessions,
	missionPilotSteps,
} from "../../db/mission-pilot-schema";
import { implementationQueueEntries, taskRuns, tasks } from "../../db/schema";
import { AppError, NotFoundError } from "../../lib/errors";
import { listPlanModeTaskMessages } from "../nightworkers/nightworkers.plan-mode-core.port";

const ALL_ROUTING_VIEWS: readonly PlanModeRoutingView[] = [
	"questionnaire",
	"feature_plan",
	...EDITABLE_PLAN_MODE_ROUTING_VIEWS,
];
const REQUIRED_VIEWS = new Set<PlanModeRoutingView>(
	REQUIRED_PLAN_MODE_ROUTING_VIEWS,
);
const TERMINAL_TASK_STATUSES = new Set([
	"completed",
	"cancelled",
	"failed",
	"timed_out",
	"archived",
]);

type TaskMessage = Awaited<ReturnType<typeof listPlanModeTaskMessages>>[number];

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function initialEntriesFromMessages(
	messages: TaskMessage[],
): PlanModeRoutingEntry[] {
	const explicit = new Map<PlanModeRoutingView, PlanModeRoutingEntry>();
	const generated = new Set<PlanModeRoutingView>();
	for (const message of messages) {
		const metadata = record(message.metadataJson) ?? {};
		const planModeGate = record(metadata.planModeGate);
		const originalGate = record(planModeGate?.originalGate);
		const planMode = record(metadata.planMode);
		for (const candidate of [
			originalGate?.dedicatedViews,
			planMode?.dedicatedViews,
			planModeGate?.dedicatedViews,
			metadata.dedicatedViews,
			metadata.viewDecisions,
		]) {
			if (!Array.isArray(candidate)) continue;
			for (const item of candidate) {
				const value = record(item);
				if (!value) continue;
				const view = value?.view;
				const decision = value?.decision;
				if (
					typeof view !== "string" ||
					!ALL_ROUTING_VIEWS.includes(view as PlanModeRoutingView) ||
					(decision !== "include" && decision !== "omit")
				)
					continue;
				const typedView = view as PlanModeRoutingView;
				explicit.set(typedView, {
					view: typedView,
					decision: REQUIRED_VIEWS.has(typedView) ? "include" : decision,
					required: REQUIRED_VIEWS.has(typedView),
					...(typeof value.reason === "string" && value.reason.trim()
						? { reason: value.reason.trim() }
						: {}),
				});
			}
		}
		if (
			metadata.intent === "app_blueprint" ||
			metadata.intent === "mock_blueprint"
		) {
			generated.add("blueprint");
		}
		if (
			metadata.artifactKind === "plan_mode_dedicated_view" ||
			metadata.artifactKind === "plan_mode_api_contract" ||
			metadata.artifactKind === "plan_mode_zod_schema"
		) {
			const view = metadata.view;
			if (
				typeof view === "string" &&
				ALL_ROUTING_VIEWS.includes(view as PlanModeRoutingView)
			) {
				generated.add(view as PlanModeRoutingView);
			}
		}
	}
	return ALL_ROUTING_VIEWS.map(
		(view) =>
			explicit.get(view) ?? {
				view,
				decision:
					REQUIRED_VIEWS.has(view) || generated.has(view) ? "include" : "omit",
				required: REQUIRED_VIEWS.has(view),
				reason: REQUIRED_VIEWS.has(view)
					? "Plan Mode の必須 Artifact です。"
					: generated.has(view)
						? "既存 Artifact を初期 routing に引き継ぎました。"
						: "初期 routing では省略されています。",
			},
	);
}

async function routingLockState(taskId: string) {
	const [task, session, queueEntries, runs] = await Promise.all([
		db.query.tasks.findFirst({ where: eq(tasks.id, taskId) }),
		db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, taskId),
		}),
		db
			.select({ id: implementationQueueEntries.id })
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.taskId, taskId)),
		db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(eq(taskRuns.taskId, taskId)),
	]);
	if (!task) throw new NotFoundError("Task not found");
	if (queueEntries.length || runs.length || session?.queueHandoffJson) {
		return "Implementation Queue 投入後は routing を変更できません。";
	}
	if (TERMINAL_TASK_STATUSES.has(task.status)) {
		return `Task が ${task.status} のため routing を変更できません。`;
	}
	return null;
}

export async function getPlanModeRouting(
	taskId: string,
	options: { messages?: TaskMessage[]; taskStatus?: string } = {},
): Promise<PlanModeRoutingSnapshot> {
	const [session, messages] = await Promise.all([
		db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, taskId),
		}),
		options.messages ?? listPlanModeTaskMessages(taskId),
	]);
	if (!session) {
		const lockedReason =
			options.taskStatus && TERMINAL_TASK_STATUSES.has(options.taskStatus)
				? `Task が ${options.taskStatus} のため routing を変更できません。`
				: null;
		return {
			revision: 0,
			entries: initialEntriesFromMessages(messages),
			editable: !lockedReason,
			lockedReason,
			updatedBy: null,
			updatedAt: null,
		};
	}
	const lockedReason = await routingLockState(taskId);
	const revision = session.planRoutingRevision;
	const persisted = revision
		? await db.query.missionPilotPlanRoutingRevisions.findFirst({
				where: and(
					eq(missionPilotPlanRoutingRevisions.sessionId, session.id),
					eq(missionPilotPlanRoutingRevisions.revision, revision),
				),
			})
		: null;
	return {
		revision,
		entries: persisted?.entriesJson ?? initialEntriesFromMessages(messages),
		editable: !lockedReason,
		lockedReason,
		updatedBy: persisted?.updatedBy ?? null,
		updatedAt: persisted?.createdAt ?? null,
	};
}

function stepKeyForView(view: PlanModeRoutingView) {
	if (view === "questionnaire" || view === "feature_plan") return view;
	if (view === "blueprint" || view === "data_model") return view;
	return `view:${view}`;
}

async function persistRoutingRevision(input: {
	taskId: string;
	expectedRevision: number;
	entries: PlanModeRoutingEntry[];
	changedViews: PlanModeRoutingView[];
	actor: PlanModeRoutingActor;
	reason: string;
}) {
	return db.transaction(async (tx) => {
		const session = await tx.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, input.taskId),
		});
		if (!session) throw new NotFoundError("Mission Pilot Session not found");
		if (session.planRoutingRevision !== input.expectedRevision) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_REVISION_CONFLICT",
				"Plan Artifact routing が別の操作で更新されました。再読み込みしてください。",
			);
		}
		const [queueEntry, run, latestContext] = await Promise.all([
			tx.query.implementationQueueEntries.findFirst({
				where: eq(implementationQueueEntries.taskId, input.taskId),
			}),
			tx.query.taskRuns.findFirst({ where: eq(taskRuns.taskId, input.taskId) }),
			tx.query.missionPilotContextSnapshots.findFirst({
				where: eq(missionPilotContextSnapshots.sessionId, session.id),
				orderBy: (row, { desc }) => [desc(row.revision)],
			}),
		]);
		if (
			queueEntry ||
			run ||
			session.queueHandoffJson ||
			session.phase === "queued"
		) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_LOCKED",
				"Implementation Queue 投入後は routing を変更できません。",
			);
		}
		if (
			!latestContext ||
			latestContext.revision !== session.contextRevision ||
			latestContext.digest !== session.contextDigest
		) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_CONTEXT_CONFLICT",
				"Mission Pilot Context が更新中です。再試行してください。",
			);
		}
		const nextRoutingRevision = session.planRoutingRevision + 1;
		const currentContext = record(latestContext.contextJson) ?? {};
		const currentPlan = record(currentContext.plan) ?? {};
		const routing = {
			revision: nextRoutingRevision,
			entries: input.entries,
			updatedBy: input.actor,
			reason: input.reason,
			updatedAt: new Date().toISOString(),
		};
		const contextJson = {
			...currentContext,
			plan: { ...currentPlan, routing },
		};
		const serialized = JSON.stringify(contextJson);
		const contextDigest = crypto
			.createHash("sha256")
			.update(serialized)
			.digest("hex");
		const contextRevision = session.contextRevision + 1;
		const now = new Date();
		await tx.insert(missionPilotPlanRoutingRevisions).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			revision: nextRoutingRevision,
			entriesJson: input.entries,
			updatedBy: input.actor,
			reason: input.reason,
			createdAt: now,
		});
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			revision: contextRevision,
			reason: "routing",
			contextJson,
			digest: contextDigest,
			tokenEstimate: Math.ceil(serialized.length / 4),
			createdAt: now,
		});
		const [updated] = await tx
			.update(missionPilotSessions)
			.set({
				planRoutingRevision: nextRoutingRevision,
				contextRevision,
				contextDigest,
				version: session.version + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.version, session.version),
					eq(missionPilotSessions.planRoutingRevision, input.expectedRevision),
					eq(missionPilotSessions.contextRevision, session.contextRevision),
					isNull(missionPilotSessions.queueHandoffJson),
				),
			)
			.returning();
		if (!updated) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_REVISION_CONFLICT",
				"Plan Artifact routing が更新中です。再試行してください。",
			);
		}
		const decisions = new Map(
			input.entries.map((entry) => [entry.view, entry.decision]),
		);
		for (const view of new Set<PlanModeRoutingView>([
			...input.changedViews,
			"feature_plan",
		])) {
			const key = stepKeyForView(view);
			const step = await tx.query.missionPilotSteps.findFirst({
				where: and(
					eq(missionPilotSteps.sessionId, session.id),
					eq(missionPilotSteps.stepKey, key),
				),
			});
			if (!step) continue;
			if (step.status === "running") {
				throw new AppError(
					409,
					"PLAN_MODE_ROUTING_STEP_RUNNING",
					`${view} の生成中は routing を変更できません。`,
				);
			}
			const decision =
				view === "feature_plan" ? "include" : decisions.get(view);
			await tx
				.update(missionPilotSteps)
				.set({
					status: decision === "omit" ? "skipped" : "pending",
					artifactMessageId: null,
					lastError: null,
					finishedAt: null,
					contextRevision,
					contextDigest,
					evidenceJson: {
						...step.evidenceJson,
						decision,
						invalidatedByRoutingRevision: nextRoutingRevision,
					},
					updatedAt: now,
				})
				.where(eq(missionPilotSteps.id, step.id));
		}
		return routing;
	});
}

async function updatePlanModeRouting(input: {
	taskId: string;
	request: UpdatePlanModeRoutingRequest;
	actor: PlanModeRoutingActor;
}) {
	const current = await getPlanModeRouting(input.taskId);
	if (!current.editable) {
		throw new AppError(
			409,
			"PLAN_MODE_ROUTING_LOCKED",
			current.lockedReason ?? "Plan Artifact routing is locked",
		);
	}
	if (current.revision !== input.request.expectedRevision) {
		throw new AppError(
			409,
			"PLAN_MODE_ROUTING_REVISION_CONFLICT",
			"Plan Artifact routing が別の操作で更新されました。再読み込みしてください。",
		);
	}
	const nextByView = new Map(
		current.entries.map((entry) => [entry.view, entry]),
	);
	const changedViews: PlanModeRoutingView[] = [];
	for (const change of input.request.changes) {
		const previous = nextByView.get(change.view);
		if (!previous) continue;
		if (
			input.actor === "mission_pilot" &&
			(previous.decision !== "omit" || change.decision !== "include")
		) {
			throw new AppError(
				400,
				"MISSION_PILOT_ROUTING_TOOL_SCOPE_VIOLATION",
				"Mission Pilot は省略中 Artifact の include だけを実行できます。",
			);
		}
		if (previous.decision === change.decision) continue;
		nextByView.set(change.view, {
			...previous,
			decision: change.decision,
			reason: change.reason ?? previous.reason,
		});
		changedViews.push(change.view);
	}
	if (changedViews.length === 0) return current;
	await persistRoutingRevision({
		taskId: input.taskId,
		expectedRevision: current.revision,
		entries: ALL_ROUTING_VIEWS.map((view) => {
			const entry = nextByView.get(view);
			if (!entry) throw new Error(`Routing entry is missing: ${view}`);
			return entry;
		}),
		changedViews,
		actor: input.actor,
		reason:
			input.actor === "mission_pilot"
				? "Mission Pilot review requested additional Plan Artifacts."
				: "User updated Plan Artifact routing.",
	});
	return getPlanModeRouting(input.taskId);
}

export function updatePlanModeRoutingForUser(
	taskId: string,
	request: UpdatePlanModeRoutingRequest,
) {
	return updatePlanModeRouting({ taskId, request, actor: "user" });
}

export function executeMissionPilotPlanRoutingTool(
	taskId: string,
	toolCall: MissionPilotPlanRoutingToolCall,
) {
	return updatePlanModeRouting({
		taskId,
		request: {
			expectedRevision: toolCall.expectedRevision,
			changes: toolCall.changes,
		},
		actor: "mission_pilot",
	});
}
