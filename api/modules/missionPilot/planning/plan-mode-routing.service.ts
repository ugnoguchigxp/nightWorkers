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
} from "../../../../shared/schemas/plan-mode-routing.schema";
import { db } from "../../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPlanRoutingRevisions,
	missionPilotSessions,
	missionPilotSteps,
} from "../../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { AppError, NotFoundError } from "../../../lib/errors";
import { readGeneralSettings } from "../../../services/settings/general-settings";
import { listPlanModeTaskMessages } from "../../nightworkers/nightworkers.plan-mode-core.port";
import {
	planModeRoutingTerminalReason,
	readPlanModeRoutingLockedReason,
} from "./plan-mode-routing-lock";

const ALL_ROUTING_VIEWS: readonly PlanModeRoutingView[] = [
	"feature_plan",
	...EDITABLE_PLAN_MODE_ROUTING_VIEWS,
];
const REQUIRED_VIEWS = new Set<PlanModeRoutingView>(
	REQUIRED_PLAN_MODE_ROUTING_VIEWS,
);
type TaskMessage = Awaited<ReturnType<typeof listPlanModeTaskMessages>>[number];
type PlanModeCapabilities = ReturnType<
	typeof readGeneralSettings
>["planMode"]["capabilities"];

function record(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function initialEntriesFromMessages(
	messages: TaskMessage[],
	capabilities: PlanModeCapabilities,
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
					capabilityEnabled:
						REQUIRED_VIEWS.has(typedView) || capabilities[typedView],
					reason: REQUIRED_VIEWS.has(typedView)
						? "Plan Mode の必須 Artifact です。"
						: typeof value.reason === "string" && value.reason.trim()
							? value.reason.trim()
							: undefined,
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
			metadata.intent === "design_questionnaire_ready" ||
			typeof metadata.questionnaireSessionId === "string"
		) {
			generated.add("questionnaire");
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
				capabilityEnabled: REQUIRED_VIEWS.has(view) || capabilities[view],
				reason: REQUIRED_VIEWS.has(view)
					? "Plan Mode の必須 Artifact です。"
					: generated.has(view)
						? "既存 Artifact を初期 routing に引き継ぎました。"
						: "初期 routing では省略されています。",
			},
	);
}

function normalizeRoutingEntries(
	entries: PlanModeRoutingEntry[],
	capabilities: PlanModeCapabilities,
) {
	const byView = new Map(entries.map((entry) => [entry.view, entry]));
	return ALL_ROUTING_VIEWS.map((view): PlanModeRoutingEntry => {
		const entry = byView.get(view);
		const required = REQUIRED_VIEWS.has(view);
		return {
			view,
			decision: required ? "include" : (entry?.decision ?? "omit"),
			required,
			capabilityEnabled: required || capabilities[view],
			...(required
				? { reason: "Plan Mode の必須 Artifact です。" }
				: entry?.reason
					? { reason: entry.reason }
					: {}),
		};
	});
}

export async function getPlanModeRouting(
	taskId: string,
	options: {
		messages?: TaskMessage[];
		taskStatus?: string;
		allowTaskRuns?: boolean;
	} = {},
): Promise<PlanModeRoutingSnapshot> {
	const capabilities = readGeneralSettings().planMode.capabilities;
	const session = await db.query.missionPilotSessions.findFirst({
		where: eq(missionPilotSessions.taskId, taskId),
	});
	const messages =
		options.messages ??
		(session?.planRoutingRevision
			? []
			: await listPlanModeTaskMessages(taskId));
	if (!session) {
		const lockedReason =
			options.taskStatus === undefined
				? null
				: planModeRoutingTerminalReason(options.taskStatus);
		return {
			revision: 0,
			entries: initialEntriesFromMessages(messages, capabilities),
			editable: !lockedReason,
			lockedReason,
			updatedBy: null,
			updatedAt: null,
		};
	}
	const lockedReason = await readPlanModeRoutingLockedReason(taskId, {
		allowTaskRuns: options.allowTaskRuns,
	});
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
		entries: normalizeRoutingEntries(
			persisted?.entriesJson ??
				initialEntriesFromMessages(messages, capabilities),
			capabilities,
		),
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

async function isAppliedRoutingRequest(input: {
	taskId: string;
	idempotencyKey: string;
	requestHash: string;
}) {
	const session = await db.query.missionPilotSessions.findFirst({
		where: eq(missionPilotSessions.taskId, input.taskId),
	});
	if (!session) return false;
	const existing = await db.query.missionPilotPlanRoutingRevisions.findFirst({
		where: and(
			eq(missionPilotPlanRoutingRevisions.sessionId, session.id),
			eq(missionPilotPlanRoutingRevisions.idempotencyKey, input.idempotencyKey),
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
	changedViews: PlanModeRoutingView[];
	actor: PlanModeRoutingActor;
	reason: string;
}) {
	return db.transaction(async (tx) => {
		const session = await tx.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.taskId, input.taskId),
		});
		if (!session) throw new NotFoundError("Mission Pilot Session not found");
		const replay = await tx.query.missionPilotPlanRoutingRevisions.findFirst({
			where: and(
				eq(missionPilotPlanRoutingRevisions.sessionId, session.id),
				eq(
					missionPilotPlanRoutingRevisions.idempotencyKey,
					input.idempotencyKey,
				),
			),
		});
		if (replay) {
			assertIdempotencyReplayMatches(replay.requestHash, input.requestHash);
			return replay;
		}
		if (session.planRoutingRevision !== input.expectedRevision) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_REVISION_CONFLICT",
				"Plan Artifact routing が別の操作で更新されました。再読み込みしてください。",
			);
		}
		const [task, queueEntry, run, latestContext] = await Promise.all([
			tx.query.tasks.findFirst({ where: eq(tasks.id, input.taskId) }),
			tx.query.implementationQueueEntries.findFirst({
				where: eq(implementationQueueEntries.taskId, input.taskId),
			}),
			tx.query.taskRuns.findFirst({ where: eq(taskRuns.taskId, input.taskId) }),
			tx.query.missionPilotContextSnapshots.findFirst({
				where: eq(missionPilotContextSnapshots.sessionId, session.id),
				orderBy: (row, { desc }) => [desc(row.revision)],
			}),
		]);
		if (!task) throw new NotFoundError("Task not found");
		const terminalReason = planModeRoutingTerminalReason(task.status);
		if (terminalReason) {
			throw new AppError(409, "PLAN_MODE_ROUTING_LOCKED", terminalReason);
		}
		if (
			input.actor === "user" &&
			(session.desiredState === "playing" || session.leaseOwner)
		) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_REBUILD_IN_PROGRESS",
				"Mission Pilot 実行中は routing を変更できません。停止後に再試行してください。",
			);
		}
		if (
			queueEntry ||
			(input.actor !== "coding_agent" && run) ||
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
			idempotencyKey: input.idempotencyKey,
			requestHash: input.requestHash,
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
	const requestHash = routingRequestHash(input.actor, input.request);
	if (
		await isAppliedRoutingRequest({
			taskId: input.taskId,
			idempotencyKey: input.request.idempotencyKey,
			requestHash,
		})
	) {
		return getPlanModeRouting(input.taskId, {
			allowTaskRuns: input.actor === "coding_agent",
		});
	}
	const current = await getPlanModeRouting(input.taskId, {
		allowTaskRuns: input.actor === "coding_agent",
	});
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
		if (change.decision === "include" && !previous.capabilityEnabled) {
			throw new AppError(
				409,
				"PLAN_MODE_ROUTING_CAPABILITY_DISABLED",
				`${change.view} は Settings で無効なため ON にできません。`,
			);
		}
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
			reason:
				change.reason?.trim() ||
				(input.actor === "user"
					? `ユーザーが ${change.decision === "include" ? "ON" : "OFF"} に変更しました。`
					: input.actor === "coding_agent"
						? `Coding Agentが ${change.decision === "include" ? "必要" : "不要"} と判断しました。`
						: previous.reason),
		});
		changedViews.push(change.view);
	}
	if (changedViews.length === 0) return current;
	await persistRoutingRevision({
		taskId: input.taskId,
		expectedRevision: current.revision,
		idempotencyKey: input.request.idempotencyKey,
		requestHash,
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
				: input.actor === "coding_agent"
					? "Coding Agent selected the Plan Artifacts required for this task."
					: "User updated Plan Artifact routing.",
	});
	return getPlanModeRouting(input.taskId, {
		allowTaskRuns: input.actor === "coding_agent",
	});
}

export function updatePlanModeRoutingForUser(
	taskId: string,
	request: UpdatePlanModeRoutingRequest,
) {
	return updatePlanModeRouting({ taskId, request, actor: "user" });
}

export function updatePlanModeRoutingForCodingAgent(
	taskId: string,
	request: UpdatePlanModeRoutingRequest,
) {
	return updatePlanModeRouting({ taskId, request, actor: "coding_agent" });
}

export function executeMissionPilotPlanRoutingTool(
	taskId: string,
	toolCall: MissionPilotPlanRoutingToolCall,
) {
	return updatePlanModeRouting({
		taskId,
		request: {
			expectedRevision: toolCall.expectedRevision,
			idempotencyKey: toolCall.idempotencyKey,
			changes: toolCall.changes,
		},
		actor: "mission_pilot",
	});
}
