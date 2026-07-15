import { createHash, randomUUID } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db/client";
import { designQuestionnaireSessions } from "../../../db/design-questionnaire-schema";
import {
	missionPilotCloseouts,
	missionPilotContextSnapshots,
	missionPilotEvents,
	missionPilotPhaseRuns,
	missionPilotPlanReviews,
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotSteps,
	missionPilotTestSnapshots,
	taskArchiveRecords,
} from "../../../db/mission-pilot-schema";
import { taskRuns, taskRunTodos } from "../../../db/schema";
import { activityEvents } from "../../../db/schema-activity";
import { implementationQueueEntries } from "../../../db/schema-task-execution";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import { createOpenApiRouter } from "../../../lib/openapi";
import * as missionPilotRepo from "../../missionPilot/mission-pilot.repository";
import { buildFeaturePlanImplementationPlanMetadata } from "../../specification/feature-plan-implementation-plan";
import * as repo from "../nightworkers.repository";
import { codingAgentChatTrace } from "../nightworkers.trace-provenance";

const preparePreQueueHandoffFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/pre-queue-handoff",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						repositoryId: z.string().uuid(),
						includeChecklist: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						sessionId: z.string().uuid(),
						activationContextRevision: z.number(),
						contextDigest: z.string(),
						planReviewId: z.string().uuid(),
						verificationDocumentId: z.string().uuid(),
						version: z.number(),
					}),
				},
			},
			description: "Prepare an isolated reviewed Mission Pilot handoff.",
		},
		404: { description: "Route unavailable" },
	},
});

const readPreQueueStateFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/pre-queue-state",
	request: {
		body: {
			content: {
				"application/json": { schema: z.object({ taskId: z.string().uuid() }) },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ state: z.unknown() }) },
			},
			description: "Read isolated pre-Queue state.",
		},
		404: { description: "Route unavailable" },
	},
});

const setPreQueueDiagnosticFixtureRoute = createRoute({
	method: "post",
	path: "/e2e/fixtures/pre-queue-diagnostic",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						taskId: z.string().uuid(),
						queueEntryId: z.string().uuid(),
						diagnosticRunId: z.string().uuid(),
						contextRevision: z.number(),
						contextDigest: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ ok: z.literal(true) }) },
			},
			description: "Set isolated pre-Queue diagnostic state.",
		},
		404: { description: "Route unavailable" },
	},
});

export const missionPilotFixtureRouter = createOpenApiRouter()
	.openapi(preparePreQueueHandoffFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const input = c.req.valid("json");
		const session = await missionPilotRepo.getSessionByTaskId(input.taskId);
		if (!session || session.repositoryId !== input.repositoryId) {
			return c.json({ error: "Mission Pilot session not found" }, 404);
		}
		const [contextRow] = await db
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, session.id))
			.orderBy(desc(missionPilotContextSnapshots.revision))
			.limit(1);
		if (!contextRow)
			return c.json({ error: "Context snapshot not found" }, 404);
		const now = new Date();
		const questionnaireId = randomUUID();
		const implementationPlan = buildFeaturePlanImplementationPlanMetadata({
			version: 1,
			requiresDataMigration: false,
			steps: [
				{
					key: "fixture-implementation",
					title: "fixture実装を確認する",
					description: "Mission Pilot E2E fixtureの実装経路を確認する。",
					taskType: "implementation",
					dependsOnKeys: [],
				},
			],
		});
		const featurePlan = await repo.createTaskMessage({
			taskId: input.taskId,
			role: "assistant",
			content:
				"# Feature Plan\n\n## Completion Conditions\n\n- Assert the immutable Queue handoff",
			messageType: "markdown_document",
			payloadJson: {
				intent: "feature_plan",
				title: "Feature Plan",
				implementationPlan,
			},
			trace: codingAgentChatTrace(),
		});
		await db.insert(designQuestionnaireSessions).values({
			id: questionnaireId,
			createdAt: now,
			updatedAt: now,
			taskId: input.taskId,
			repositoryId: input.repositoryId,
			status: "accepted",
		});
		const questionnaireDigest = createHash("sha256")
			.update(
				JSON.stringify({ status: "accepted", answers: [], questionSets: [] }),
			)
			.digest("hex");
		const context = {
			...contextRow.contextJson,
			plan: {
				questionnaire: {
					sessionId: questionnaireId,
					status: "accepted",
					answers: [],
					questionSets: [],
					questionnaireDigest,
				},
				artifacts: [
					{
						stepKey: "feature_plan",
						sourceMessageId: featurePlan.id,
						digest: createHash("sha256").update("# Feature Plan").digest("hex"),
					},
				],
			},
		};
		const serializedContext = JSON.stringify(context);
		const contextDigest = createHash("sha256")
			.update(serializedContext)
			.digest("hex");
		const activationContextRevision = session.contextRevision + 1;
		await db
			.update(missionPilotContextSnapshots)
			.set({
				contextJson: context,
				digest: contextDigest,
				revision: activationContextRevision,
			})
			.where(eq(missionPilotContextSnapshots.id, contextRow.id));
		await db
			.update(missionPilotSessions)
			.set({
				contextRevision: activationContextRevision,
				contextDigest,
				planRoutingRevision: 0,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
		await db.insert(missionPilotSteps).values([
			{
				id: randomUUID(),
				sessionId: session.id,
				stepKey: "questionnaire",
				ordinal: 1,
				status: "completed",
				attempt: 1,
				contextRevision: activationContextRevision,
				contextDigest,
				artifactMessageId: null,
				evidenceJson: { kind: "questionnaire", required: true, enabled: true },
				startedAt: now,
				finishedAt: now,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: randomUUID(),
				sessionId: session.id,
				stepKey: "feature_plan",
				ordinal: 2,
				status: "completed",
				attempt: 1,
				contextRevision: activationContextRevision,
				contextDigest,
				artifactMessageId: featurePlan.id,
				evidenceJson: {
					kind: "feature_plan",
					required: true,
					enabled: true,
					sourceMessageId: featurePlan.id,
					preFeaturePlanQuestionnaireStatus: "completed",
				},
				startedAt: now,
				finishedAt: now,
				createdAt: now,
				updatedAt: now,
			},
		]);
		const planReviewId = randomUUID();
		await db.insert(missionPilotPlanReviews).values({
			id: planReviewId,
			sessionId: session.id,
			contextRevision: activationContextRevision,
			contextDigest,
			featurePlanMessageId: featurePlan.id,
			attempt: 1,
			verdict: "pass",
			reviewJson: {
				verdict: "pass",
				summary: "Ready for implementation",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				artifactScores: [],
				findings: [],
				revisionTargets: [],
				routingToolCall: null,
			},
			createdAt: now,
		});
		const verificationDocumentId = randomUUID();
		await db.insert(verificationDocuments).values({
			id: verificationDocumentId,
			createdAt: now,
			updatedAt: now,
			taskId: input.taskId,
			runId: null,
			specMessageId: featurePlan.id,
			sourceSpecPath: "task-message",
			schemaVersion: 1,
			status: "active",
			documentJson: { version: 1, conditions: [], commands: [] },
			generatedAt: now,
		});
		if (input.includeChecklist) {
			await db.insert(verificationChecklistItems).values({
				id: randomUUID(),
				createdAt: now,
				updatedAt: now,
				verificationDocumentId,
				taskId: input.taskId,
				conditionId: "mission-pilot-archive",
				text: "Mission reaches true Archive",
				required: true,
				status: "pending",
				evidenceIdsJson: [],
			});
		}
		const queueEntryId = randomUUID();
		const admissionKey = `mission-pilot:${session.id}:${contextDigest}:${planReviewId}`;
		const authorization = {
			version: 3 as const,
			sessionId: session.id,
			taskId: input.taskId,
			taskRef: { source: "task" as const, id: input.taskId },
			activationContextRevision,
			activationContextDigest: contextDigest,
			grantedByAction: "mission_pilot_play" as const,
			grantedAt: new Date().toISOString(),
			scopes: {
				plan: true,
				queue: true,
				implementation: true,
				testMutation: true,
				review: true,
				localCommit: true,
				taskComplete: true,
				taskArchive: true,
				push: false,
			} as const,
			pushPolicy: "never" as const,
		};
		const queueHandoff = {
			sessionId: session.id,
			taskId: input.taskId,
			admissionKey,
			queueEntryId,
			queueEntryStatus: "queued" as const,
			queueClaimReady: false as const,
			reviewedContextRevision: activationContextRevision,
			reviewedContextDigest: contextDigest,
			featurePlanMessageId: featurePlan.id,
			implementationTodoProjectionVersion: 1 as const,
			implementationPlanSourceMessageId: featurePlan.id,
			implementationPlanDigest: implementationPlan.digest,
			verificationDocumentId,
			planReviewId,
			planReviewVerdict: "pass" as const,
			routingRevision: 0,
			queuedAt: new Date().toISOString(),
		};
		await db.insert(implementationQueueEntries).values({
			id: queueEntryId,
			createdAt: now,
			updatedAt: now,
			taskId: input.taskId,
			repositoryId: input.repositoryId,
			status: "queued",
			executionType: "normal",
			missionPilotAdmissionKey: admissionKey,
			claimReady: false,
		});
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: input.includeChecklist ? "playing" : "stopped",
				phase: input.includeChecklist ? "queued" : "attention",
				authorizationVersion: 3,
				authorizationJson: authorization,
				queueHandoffJson: queueHandoff,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, session.id));
		await repo.updateTaskStatus(input.taskId, "queued");
		return c.json(
			{
				sessionId: session.id,
				activationContextRevision,
				contextDigest,
				planReviewId,
				verificationDocumentId,
				version: session.version,
			},
			201,
		);
	})
	.openapi(readPreQueueStateFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const { taskId } = c.req.valid("json");
		const session = await missionPilotRepo.getSessionByTaskId(taskId);
		const task = await repo.getTask(taskId);
		if (!session || !task) return c.json({ error: "Task not found" }, 404);
		const [
			queueRows,
			runRows,
			contextRows,
			phaseRows,
			testSnapshotRows,
			reviewDecisionRows,
			closeoutRows,
			eventRows,
			archiveRows,
			evidenceRows,
			activityRows,
		] = await Promise.all([
			db
				.select()
				.from(implementationQueueEntries)
				.where(eq(implementationQueueEntries.taskId, taskId)),
			db.select().from(taskRuns).where(eq(taskRuns.taskId, taskId)),
			db
				.select()
				.from(missionPilotContextSnapshots)
				.where(eq(missionPilotContextSnapshots.sessionId, session.id))
				.orderBy(desc(missionPilotContextSnapshots.revision)),
			db
				.select()
				.from(missionPilotPhaseRuns)
				.where(eq(missionPilotPhaseRuns.sessionId, session.id)),
			db
				.select()
				.from(missionPilotTestSnapshots)
				.where(eq(missionPilotTestSnapshots.sessionId, session.id)),
			db
				.select()
				.from(missionPilotReviewDecisions)
				.where(eq(missionPilotReviewDecisions.sessionId, session.id)),
			db
				.select()
				.from(missionPilotCloseouts)
				.where(eq(missionPilotCloseouts.sessionId, session.id)),
			db
				.select()
				.from(missionPilotEvents)
				.where(eq(missionPilotEvents.sessionId, session.id)),
			db
				.select()
				.from(taskArchiveRecords)
				.where(eq(taskArchiveRecords.taskId, taskId)),
			db
				.select()
				.from(verificationEvidenceRuns)
				.where(eq(verificationEvidenceRuns.taskId, taskId)),
			db.select().from(activityEvents).where(eq(activityEvents.taskId, taskId)),
		]);
		const latestRun = [...runRows].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		)[0];
		const latestRunTodos = latestRun
			? await db
					.select()
					.from(taskRunTodos)
					.where(eq(taskRunTodos.runId, latestRun.id))
			: [];
		return c.json(
			{
				state: {
					taskStatus: task.status,
					phase: session.phase,
					desiredState: session.desiredState,
					lastErrorCode: session.lastErrorCode,
					lastErrorMessage: session.lastErrorMessage,
					latestFinalReport: latestRun?.finalReport ?? null,
					latestRunStatus: latestRun?.status ?? null,
					latestRunTodos: latestRunTodos.map((todo) => ({
						seq: todo.seq,
						title: todo.title,
						status: todo.status,
						procedureId: todo.procedureId,
					})),
					latestContextSnapshot: latestRun?.contextSnapshot ?? null,
					finalContextJson: contextRows[0]?.contextJson ?? null,
					contextRevision: session.contextRevision,
					contextDigest: session.contextDigest,
					queueHandoffJson: session.queueHandoffJson,
					queueCount: queueRows.length,
					runCount: runRows.length,
					unclaimedQueueCount: queueRows.filter(
						(row) => row.status === "queued" && row.activeRunId === null,
					).length,
					implementationRunCount: phaseRows.filter(
						(row) => row.phase === "implementation",
					).length,
					snapshotCount: testSnapshotRows.length,
					reviewPassCount: reviewDecisionRows.filter(
						(row) => row.verdict === "pass",
					).length,
					closeoutCount: closeoutRows.length,
					invalidationCount: eventRows.filter(
						(row) => row.eventType === "mission_pilot.evidence_invalidated",
					).length,
					archiveCount: archiveRows.filter((row) => row.restoredAt === null)
						.length,
					evidenceRows: evidenceRows.map((row) => ({
						id: row.id,
						phaseRunId:
							phaseRows.find((phase) => phase.runId === row.runId)?.id ?? null,
						command: row.command,
						exitCode: row.exitCode,
					})),
					snapshots: testSnapshotRows.map((row) => ({
						evidenceRunIds: row.evidenceRunIdsJson,
					})),
					forbiddenCount: activityRows.filter(
						(row) =>
							phaseRows.some((phase) => phase.runId === row.runId) &&
							(row.traceOwner !== "coding_agent" ||
								row.traceChannel !== "chat"),
					).length,
				},
			},
			200,
		);
	})
	.openapi(setPreQueueDiagnosticFixtureRoute, async (c) => {
		if (
			process.env.NIGHTWORKERS_E2E_ISOLATED !== "1" ||
			c.req.header("x-nightworkers-e2e") !== "1"
		) {
			return c.json({ error: "Not found" }, 404);
		}
		const input = c.req.valid("json");
		const session = await missionPilotRepo.getSessionByTaskId(input.taskId);
		if (!session)
			return c.json({ error: "Mission Pilot session not found" }, 404);
		const diagnostic = {
			code: "MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN" as const,
			detectedAt: new Date().toISOString(),
			taskStatus: "queued",
			sessionPhase: "queueing",
			queueEntryIds: [input.queueEntryId],
			runIds: [input.diagnosticRunId],
			runSourceRefs: [
				{
					runId: input.diagnosticRunId,
					executionMode: "implementation",
					executionModeSource: "workbench_intake",
				},
			],
			commitRecordIds: [],
			diffEventIds: [],
			contextRevision: input.contextRevision,
			contextDigest: input.contextDigest,
			reviewedContextRevision: input.contextRevision,
			reviewedContextDigest: input.contextDigest,
		};
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: "stopped",
				phase: "attention",
				lastErrorCode: diagnostic.code,
				lastErrorMessage: "Unexpected pre-Queue run detected",
				preQueueDiagnosticJson: diagnostic,
				version: session.version + 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.id, session.id));
		return c.json({ ok: true }, 200);
	});
