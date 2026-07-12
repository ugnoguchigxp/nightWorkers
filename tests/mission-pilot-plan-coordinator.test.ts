import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskMessages, tasks } from "../api/db/schema";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";
import * as planRepo from "../api/modules/missionPilot/mission-pilot-plan.repository";

const mocks = vi.hoisted(() => ({
	generateFeaturePlan: vi.fn(),
	generateBlueprint: vi.fn(),
	generateDataModel: vi.fn(),
	generatePlanView: vi.fn(),
	getWorkspace: vi.fn(),
	getQuestionnaire: vi.fn(),
	generateAdditionalQuestionnaire: vi.fn(),
	saveQuestionnaireAnswers: vi.fn(),
	callLlm: vi.fn(),
	createQueueEntry: vi.fn(),
	getVerificationDocument: vi.fn(),
}));

vi.mock(
	"../api/modules/specification/specification-generation.service",
	() => ({
		generateFeaturePlanArtifact: mocks.generateFeaturePlan,
	}),
);
vi.mock("../api/modules/blueprint/blueprint-generation.service", () => ({
	generateBlueprintArtifact: mocks.generateBlueprint,
}));
vi.mock("../api/modules/dataModel/dataModel-generation.service", () => ({
	generateDataModelArtifact: mocks.generateDataModel,
}));
vi.mock("../api/modules/planViews/planView-generation.service", () => ({
	generatePlanViewArtifact: mocks.generatePlanView,
}));
vi.mock("../api/modules/specification/plan-mode-workspace.service", () => ({
	getPlanModeWorkspace: mocks.getWorkspace,
}));
vi.mock("../api/modules/questionnaire/questionnaire.service", () => ({
	getDesignQuestionnaireSession: mocks.getQuestionnaire,
	saveDesignQuestionnaireAnswers: mocks.saveQuestionnaireAnswers,
}));
vi.mock(
	"../api/modules/questionnaire/questionnaire-additional.service",
	() => ({
		generateAdditionalDesignQuestionnaireQuestions:
			mocks.generateAdditionalQuestionnaire,
	}),
);
vi.mock("../api/services/structured-llm", () => ({
	callStructuredJsonLLM: mocks.callLlm,
}));
vi.mock(
	"../api/modules/missionPilot/mission-pilot-queue-handoff.service",
	() => ({
		admitMissionPilotQueueHandoff: mocks.createQueueEntry,
		MissionPilotPreQueueError: class MissionPilotPreQueueError extends Error {},
	}),
);
vi.mock(
	"../api/modules/nightworkers/nightworkers.verification.repository",
	() => ({
		getLatestVerificationDocumentForTask: mocks.getVerificationDocument,
	}),
);

const {
	buildMissionPilotPlanReviewResponseJsonSchema,
	runMissionPilotPlanPipeline,
} = await import(
	"../api/modules/missionPilot/mission-pilot-plan-coordinator.service"
);

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());
beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.generateAdditionalQuestionnaire.mockImplementation(async () => ({
		session: await mocks.getQuestionnaire(),
		result: {
			sessionId: null,
			createdQuestionSetId: null,
			addedCount: 0,
			skippedDuplicateCount: 0,
			blockingCount: 0,
			nonBlockingCount: 0,
		},
	}));
});
afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

describe("Mission Pilot plan coordinator", () => {
	it("builds a Codex-compatible plan review response schema", () => {
		const schema = buildMissionPilotPlanReviewResponseJsonSchema();
		const serialized = JSON.stringify(schema);

		expect(serialized).not.toContain('"$schema"');
		expect(serialized).not.toContain('"default"');
		expect(serialized).not.toContain('"oneOf"');
		expect(serialized).toContain('"anyOf"');
		expectAllObjectPropertiesRequired(schema);
	});

	it("does not churn Session version before Questionnaire completion", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const session = await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "Mission Pilot preflight",
				localPath: "/tmp/mission-pilot-preflight",
				branch: "main",
			});
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Wait for Questionnaire",
					objective: "Do not mutate control state before planning is ready",
					status: "ready",
				})
				.returning();
			return createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId: crypto.randomUUID(),
				},
				tx,
			);
		});
		await db
			.update(missionPilotSessions)
			.set({ desiredState: "playing", phase: "initial_intake" })
			.where(eq(missionPilotSessions.id, session.id));
		mocks.getWorkspace.mockResolvedValue({ questionnaireSessions: [] });

		const before = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, session.id),
		});
		await runMissionPilotPlanPipeline(taskId);
		const after = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, session.id),
		});

		expect(after?.version).toBe(before?.version);
		expect(after?.leaseOwner).toBeNull();
	});

	it("re-reviews a changed Task Context before delegating Queue admission", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const sourceId = crypto.randomUUID();
		const questionnaireId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		const { session } = await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "Mission Pilot coordinator",
				localPath: "/tmp/mission-pilot-coordinator",
				branch: "main",
			});
			const [task] = await tx
				.insert(tasks)
				.values({
					id: taskId,
					repositoryId,
					title: "Autonomous plan",
					objective: "Generate a reviewed implementation plan",
					acceptanceCriteria: "The reviewed plan enters the queue",
					status: "ready",
				})
				.returning();
			const session = await createSession(
				{
					task,
					sourceKind: "mission_task_candidate",
					sourceId,
				},
				tx,
			);
			return { session };
		});
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "initial_intake",
				authorizationVersion: 2,
				authorizationJson: {
					version: 2,
					sessionId: session.id,
					taskId,
					sourceRef: { source: "mission_task_candidate", id: sourceId },
					grantedByAction: "mission_pilot_play",
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
					},
					pushPolicy: "never",
				},
			})
			.where(eq(missionPilotSessions.id, session.id));

		let featurePlanMessageId: string | null = null;
		const verificationDocumentId = crypto.randomUUID();
		mocks.getWorkspace.mockImplementation(async () => ({
			taskId,
			repositoryId,
			generatedAt: new Date().toISOString(),
			featurePlanArtifacts: featurePlanMessageId
				? [
						{
							id: `feature-plan-${featurePlanMessageId}`,
							kind: "feature_plan",
							title: "Feature Plan",
							sourceMessageId: featurePlanMessageId,
							createdAt: new Date(),
						},
					]
				: [],
			blueprintArtifacts: [],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [],
			questionnaireSessions: [
				{
					id: questionnaireId,
					status: "review_ready",
					answeredCount: 1,
					totalQuestionCount: 1,
					unansweredCount: 0,
					blockingUnansweredCount: 0,
					nonBlockingUnansweredCount: 0,
				},
			],
			decisionReviews: [],
			implementationReferences: [],
			viewDecisions: [],
		}));
		mocks.getQuestionnaire.mockResolvedValue({
			id: questionnaireId,
			taskId,
			status: "review_ready",
			questionSets: [],
			answers: [],
		});
		const preFeaturePlanQuestionnaire = {
			id: questionnaireId,
			taskId,
			status: "answering",
			questionSets: [
				{
					id: crypto.randomUUID(),
					sequence: 2,
					validationStatus: "valid",
					createdAt: new Date(),
					rawOutput: "raw candidate must not enter canonical context",
					questionnaire: {
						questionSets: [
							{
								metadata: { source: "pre_feature_plan_gate" },
								questions: [
									{
										id: "additional-2-q1",
										topic: "verification.scope",
										question: "Spec直前の検証範囲はどれですか？",
										answerType: "single_choice",
										options: [
											{
												id: "focused",
												label: "Focused verification",
												tradeoff: "Fast",
											},
										],
									},
								],
							},
						],
					},
				},
			],
			answers: [],
		};
		mocks.generateAdditionalQuestionnaire.mockImplementation(async () => {
			await db
				.update(missionPilotSessions)
				.set({
					phase: "waiting_intervention",
					nextWakeAt: new Date(Date.now() + 20_000),
					updatedAt: new Date(),
				})
				.where(eq(missionPilotSessions.id, session.id));
			return {
				session: preFeaturePlanQuestionnaire,
				result: {
					sessionId: questionnaireId,
					createdQuestionSetId: crypto.randomUUID(),
					addedCount: 1,
					skippedDuplicateCount: 0,
					blockingCount: 1,
					nonBlockingCount: 0,
				},
			};
		});
		const completedPreFeaturePlanQuestionnaire = {
			...preFeaturePlanQuestionnaire,
			status: "review_ready",
			answers: [
				{
					id: crypto.randomUUID(),
					questionId: "additional-2-q1",
					answer: {
						questionId: "additional-2-q1",
						selectedOptionIds: ["focused"],
						rankedOptionIds: [],
						deferred: false,
					},
					answeredAt: new Date(),
				},
			],
		};
		mocks.generateFeaturePlan.mockImplementation(async () => {
			const [message] = await db
				.insert(taskMessages)
				.values({
					id: crypto.randomUUID(),
					taskId,
					role: "assistant",
					content: "# Feature Plan\n\n## Verification\n- Run tests",
					messageType: "markdown_document",
					metadataJson: { intent: "feature_plan", title: "Feature Plan" },
				})
				.returning();
			featurePlanMessageId = message.id;
			return { message, workspace: await mocks.getWorkspace() };
		});
		mocks.getVerificationDocument.mockImplementation(async () => ({
			id: verificationDocumentId,
			specMessageId: featurePlanMessageId,
			status: "active",
		}));
		let reviewCallCount = 0;
		mocks.callLlm.mockImplementation(async () => {
			reviewCallCount += 1;
			if (reviewCallCount === 1) {
				return JSON.stringify({
					verdict: "revise",
					summary: "Feature Plan correction is required.",
					coverage: {
						goal: "pass",
						scope: "fail",
						acceptanceCriteria: "pass",
						implementationSteps: "fail",
						verification: "pass",
						artifactConsistency: "fail",
						riskAndSafety: "pass",
					},
					findings: [
						{
							severity: "blocking",
							artifactKind: "feature_plan",
							sourceId: featurePlanMessageId,
							issue: "Verification is incomplete",
							recommendation: "Clarify verification",
						},
					],
					revisionTargets: [
						{
							target: "feature_plan",
							sourceMessageId: featurePlanMessageId,
							focus: { kind: "artifact" },
							instruction: "検証手順を具体化してください。",
							preserveUnfocusedContent: true,
						},
					],
				});
			}
			if (reviewCallCount === 2) {
				await db
					.update(tasks)
					.set({
						acceptanceCriteria:
							"The reviewed plan enters the queue with refreshed Context",
					})
					.where(eq(tasks.id, taskId));
			}
			return JSON.stringify({
				verdict: "pass",
				summary: "実装可能です。",
				coverage: {
					goal: "pass",
					scope: "pass",
					acceptanceCriteria: "pass",
					implementationSteps: "pass",
					verification: "pass",
					artifactConsistency: "pass",
					riskAndSafety: "pass",
				},
				findings: [],
				revisionTargets: [],
			});
		});
		mocks.createQueueEntry.mockImplementation(async () => {
			await db
				.update(missionPilotSessions)
				.set({ phase: "queued", updatedAt: new Date() })
				.where(eq(missionPilotSessions.id, session.id));
			return { taskId };
		});

		await runMissionPilotPlanPipeline(taskId);
		expect(mocks.generateFeaturePlan).not.toHaveBeenCalled();
		expect(mocks.saveQuestionnaireAnswers).not.toHaveBeenCalled();
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, session.id),
			}),
		).toMatchObject({ phase: "waiting_intervention", desiredState: "playing" });

		mocks.getQuestionnaire.mockResolvedValue(
			completedPreFeaturePlanQuestionnaire,
		);
		await db
			.update(missionPilotSessions)
			.set({ phase: "generating_artifacts", nextWakeAt: null })
			.where(eq(missionPilotSessions.id, session.id));
		await runMissionPilotPlanPipeline(taskId);

		expect(mocks.generateFeaturePlan).toHaveBeenNthCalledWith(1, taskId, {
			questionnaireSessionId: questionnaireId,
			role: "mission_pilot",
		});
		expect(mocks.generateFeaturePlan).toHaveBeenCalledTimes(2);
		expect(mocks.generateFeaturePlan).toHaveBeenNthCalledWith(
			2,
			taskId,
			expect.objectContaining({
				questionnaireSessionId: questionnaireId,
				role: "mission_pilot",
				prompt: expect.stringContaining("検証手順を具体化してください"),
			}),
		);
		expect(mocks.generateAdditionalQuestionnaire).toHaveBeenCalledTimes(1);
		expect(mocks.generateAdditionalQuestionnaire).toHaveBeenCalledWith(taskId, {
			source: "pre_feature_plan_gate",
			reason: expect.stringContaining("Feature Plan生成直前"),
			maxQuestions: 5,
			role: "mission_pilot",
		});
		expect(mocks.saveQuestionnaireAnswers).not.toHaveBeenCalled();
		expect(mocks.callLlm).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(String),
			expect.objectContaining({ role: "mission_pilot", taskId }),
		);
		expect(mocks.callLlm).toHaveBeenCalledTimes(3);
		expect(mocks.createQueueEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId,
				sessionId: session.id,
				featurePlanMessageId,
				verificationDocumentId,
				leaseOwner: expect.any(String),
			}),
		);
		expect(await planRepo.getLatestPlanReview(session.id)).toMatchObject({
			verdict: "pass",
			attempt: 3,
		});
		expect(await planRepo.listArtifactCorrectionRuns(session.id)).toEqual([
			expect.objectContaining({
				target: "feature_plan",
				status: "applied",
				resultMessageId: featurePlanMessageId,
			}),
		]);
		const planSteps = await planRepo.listPlanSteps(session.id);
		expect(planSteps).toEqual([
			expect.objectContaining({
				stepKey: "questionnaire",
				status: "completed",
			}),
			expect.objectContaining({ stepKey: "feature_plan", status: "completed" }),
		]);
		expect(planSteps[1]?.evidenceJson).toMatchObject({
			preFeaturePlanQuestionnaireStatus: "completed",
			preFeaturePlanQuestionnaireAddedCount: 1,
		});
		const snapshots = await db.query.missionPilotContextSnapshots.findMany({
			where: eq(missionPilotContextSnapshots.sessionId, session.id),
		});
		expect(JSON.stringify(snapshots)).not.toContain(
			"raw candidate must not enter canonical context",
		);
		expect(
			await db.query.missionPilotSessions.findFirst({
				where: eq(missionPilotSessions.id, session.id),
			}),
		).toMatchObject({ phase: "queued", desiredState: "playing" });
	});
});

function expectAllObjectPropertiesRequired(schema: unknown): void {
	if (!schema || typeof schema !== "object") return;
	if (Array.isArray(schema)) {
		for (const item of schema) expectAllObjectPropertiesRequired(item);
		return;
	}
	const record = schema as Record<string, unknown>;
	if (record.type === "object" && record.properties) {
		const propertyKeys = Object.keys(
			record.properties as Record<string, unknown>,
		);
		expect(record.required).toEqual(propertyKeys);
		expect(record.additionalProperties).toBe(false);
	}
	for (const value of Object.values(record)) {
		expectAllObjectPropertiesRequired(value);
	}
}
