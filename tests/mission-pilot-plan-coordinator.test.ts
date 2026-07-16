import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
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
	missionPilotSteps,
} from "../api/db/mission-pilot-schema";
import {
	activityEvents,
	repositories,
	taskMessages,
	tasks,
} from "../api/db/schema";
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
vi.mock("../api/services/structured-llm", async (importOriginal) => ({
	...(await importOriginal<typeof import("../api/services/structured-llm")>()),
	callStructuredLlmResult: mocks.callLlm,
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
const { selectCurrentPlanReviews } = await import(
	"../api/modules/missionPilot/mission-pilot-plan-review-selection"
);
const { selectMissionPilotPipelineQuestionnaire } = await import(
	"../api/modules/missionPilot/mission-pilot-plan-support"
);
const { missionPilotRequiredArtifactDependencyKeys } = await import(
	"../api/modules/missionPilot/mission-pilot-plan-artifact-source-resolver"
);

const repositoryIds: string[] = [];

function structuredSuccess<T>(value: T, attempt = 1) {
	const rawText = JSON.stringify(value);
	return {
		ok: true as const,
		value,
		attempt: {
			attempt,
			rawText,
			extractedText: rawText,
			repairedText: null,
			repairKind: "none" as const,
		},
		issues: [] as const,
	};
}

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
	it("uses only reviews from the current Context and routing revision", () => {
		const reviews = [
			{
				id: "stale-context",
				contextRevision: 2,
				contextDigest: "digest-2",
				routingRevision: 4,
			},
			{
				id: "stale-routing",
				contextRevision: 3,
				contextDigest: "digest-3",
				routingRevision: 4,
			},
			{
				id: "current",
				contextRevision: 3,
				contextDigest: "digest-3",
				routingRevision: 5,
			},
		];

		expect(
			selectCurrentPlanReviews(reviews, {
				contextRevision: 3,
				contextDigest: "digest-3",
				planRoutingRevision: 5,
			}),
		).toEqual([reviews[2]]);
	});

	it("requires every scheduled artifact before Feature Plan generation", () => {
		expect(
			missionPilotRequiredArtifactDependencyKeys({
				target: "feature_plan",
				stepOrdinal: 5,
				steps: [
					{ ordinal: 1, stepKey: "questionnaire", evidenceJson: {} },
					{
						ordinal: 2,
						stepKey: "blueprint",
						evidenceJson: { kind: "blueprint" },
					},
					{
						ordinal: 3,
						stepKey: "data_model",
						evidenceJson: { kind: "data_model" },
					},
					{
						ordinal: 4,
						stepKey: "view:api_io_contract",
						evidenceJson: {
							kind: "dedicated_view",
							view: "api_io_contract",
						},
					},
				],
			}),
		).toEqual(["blueprint", "data_model", "view:api_io_contract"]);
	});

	it("resumes an answering pre-Feature Plan Questionnaire from durable step evidence", () => {
		expect(
			selectMissionPilotPipelineQuestionnaire(
				[{ id: "questionnaire-1", status: "answering" }],
				[
					{
						stepKey: "feature_plan",
						evidenceJson: {
							preFeaturePlanQuestionnaireStatus: "running",
						},
					},
				],
			),
		).toEqual({ id: "questionnaire-1", status: "answering" });
		expect(
			selectMissionPilotPipelineQuestionnaire(
				[{ id: "questionnaire-1", status: "answering" }],
				[],
			),
		).toBeUndefined();
	});

	it("builds a Codex-compatible plan review response schema", () => {
		const schema = buildMissionPilotPlanReviewResponseJsonSchema();
		const serialized = JSON.stringify(schema);

		expect(serialized).not.toContain('"$schema"');
		expect(serialized).not.toContain('"default"');
		expect(serialized).not.toContain('"oneOf"');
		expect(serialized).toContain('"anyOf"');
		expect(serialized).not.toContain('"reroute"');
		expect(serialized).not.toContain("edit_plan_artifact_routing");
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

	it("retries one transient generation failure and re-reviews a changed Task Context", async () => {
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
		let questionnaireStatus = "review_ready";
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
					status: questionnaireStatus,
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
					sequence: 1,
					validationStatus: "valid",
					createdAt: new Date(),
					rawOutput: "initial questionnaire",
					questionnaire: {
						questionSets: [
							{
								metadata: { source: "initial" },
								questions: [
									{
										id: "initial-q1",
										topic: "scope",
										question: "初期スコープはどれですか？",
										answerType: "single_choice",
										options: [
											{
												id: "user-selected",
												label: "User selected scope",
												tradeoff: "Preserve user choice",
											},
										],
									},
								],
							},
						],
					},
				},
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
			answers: [
				{
					id: crypto.randomUUID(),
					questionId: "initial-q1",
					answer: {
						questionId: "initial-q1",
						selectedOptionIds: ["user-selected"],
						rankedOptionIds: [],
						deferred: false,
					},
					answeredAt: new Date(),
				},
			],
		};
		mocks.generateAdditionalQuestionnaire.mockImplementation(async () => {
			questionnaireStatus = "answering";
			mocks.getQuestionnaire.mockResolvedValue(preFeaturePlanQuestionnaire);
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
				...preFeaturePlanQuestionnaire.answers,
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
		mocks.saveQuestionnaireAnswers
			.mockRejectedValueOnce(new Error("simulated process interruption"))
			.mockImplementation(async () => {
				questionnaireStatus = "review_ready";
				mocks.getQuestionnaire.mockResolvedValue(
					completedPreFeaturePlanQuestionnaire,
				);
				return completedPreFeaturePlanQuestionnaire;
			});
		let featurePlanGenerationCount = 0;
		let featurePlanInvocationCount = 0;
		mocks.generateFeaturePlan.mockImplementation(async () => {
			featurePlanInvocationCount += 1;
			if (featurePlanInvocationCount === 1) {
				throw new Error("simulated transient Feature Plan generation failure");
			}
			featurePlanGenerationCount += 1;
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
			if (featurePlanGenerationCount === 1) {
				// routing 拡張後の依存再生成は、Artifact correction の消費回数ではない。
				await db
					.update(missionPilotSteps)
					.set({ attempt: 2 })
					.where(
						and(
							eq(missionPilotSteps.sessionId, session.id),
							eq(missionPilotSteps.stepKey, "feature_plan"),
						),
					);
			}
			featurePlanMessageId = message.id;
			return { message, workspace: await mocks.getWorkspace() };
		});
		mocks.getVerificationDocument.mockImplementation(async () => ({
			id: verificationDocumentId,
			specMessageId: featurePlanMessageId,
			status: "active",
		}));
		let reviewCallCount = 0;
		const transcribedFeaturePlanMessageId =
			"00000000-0000-4000-8000-000000000071";
		mocks.callLlm.mockImplementation(async (...args: unknown[]) => {
			reviewCallCount += 1;
			if (reviewCallCount === 1) {
				return structuredSuccess({
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
					artifactScores: [
						{
							artifactKind: "feature_plan",
							sourceMessageId: featurePlanMessageId,
							score: 79,
							rationale: "Verification is incomplete.",
						},
					],
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
			return structuredSuccess(
				{
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
					artifactScores: [
						{
							artifactKind: "feature_plan",
							sourceMessageId:
								reviewCallCount === 3
									? transcribedFeaturePlanMessageId
									: featurePlanMessageId,
							score: 80,
							rationale: "実装に必要な詳細を満たしています。",
						},
					],
					findings: [],
					revisionTargets: [],
				},
				(args[2] as { attempt?: number } | undefined)?.attempt ?? 1,
			);
		});
		mocks.createQueueEntry.mockImplementation(async () => {
			await db
				.update(missionPilotSessions)
				.set({ phase: "queued", updatedAt: new Date() })
				.where(eq(missionPilotSessions.id, session.id));
			return { taskId };
		});

		await expect(runMissionPilotPlanPipeline(taskId)).rejects.toThrow(
			"simulated process interruption",
		);
		const failureEvents = await db
			.select()
			.from(activityEvents)
			.where(
				and(
					eq(activityEvents.taskId, taskId),
					eq(activityEvents.kind, "system.error"),
				),
			);
		expect(failureEvents).toEqual([
			expect.objectContaining({
				source: "mission_pilot",
				status: "failed",
				traceOwner: "mission_pilot",
				traceChannel: "pilot_thought",
				text: expect.stringContaining("simulated process interruption"),
				payloadJson: expect.objectContaining({
					errorCode: "MISSION_PILOT_PLAN_PIPELINE_FAILED",
					error: "simulated process interruption",
				}),
			}),
		]);
		await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "generating_artifacts",
				lastErrorCode: null,
				lastErrorMessage: null,
			})
			.where(eq(missionPilotSessions.id, session.id));
		await runMissionPilotPlanPipeline(taskId);

		expect(mocks.generateFeaturePlan).toHaveBeenNthCalledWith(
			1,
			taskId,
			expect.objectContaining({
				questionnaireSessionId: questionnaireId,
				role: "mission_pilot",
				trace: expect.objectContaining({
					owner: "coding_agent",
					channel: "chat",
					orchestrationRef: expect.objectContaining({
						sessionId: session.id,
					}),
				}),
				llmUsageTrace: expect.objectContaining({
					owner: "coding_agent",
					channel: "chat",
				}),
			}),
		);
		expect(mocks.generateFeaturePlan).toHaveBeenCalledTimes(3);
		expect(mocks.generateFeaturePlan).toHaveBeenNthCalledWith(
			3,
			taskId,
			expect.objectContaining({
				questionnaireSessionId: questionnaireId,
				role: "mission_pilot",
				prompt: expect.stringContaining("検証手順を具体化してください"),
				sourceSelection: expect.objectContaining({
					previousTargetMessageId: expect.any(String),
				}),
			}),
		);
		expect(mocks.generateAdditionalQuestionnaire).toHaveBeenCalledTimes(1);
		expect(mocks.generateAdditionalQuestionnaire).toHaveBeenCalledWith(
			taskId,
			expect.objectContaining({
				source: "pre_feature_plan_gate",
				reason: expect.stringContaining("Feature Plan生成直前"),
				maxQuestions: 5,
				role: "mission_pilot",
			}),
		);
		expect(mocks.saveQuestionnaireAnswers).toHaveBeenCalledTimes(2);
		expect(mocks.saveQuestionnaireAnswers).toHaveBeenLastCalledWith(
			taskId,
			questionnaireId,
			[
				expect.objectContaining({
					questionId: "additional-2-q1",
					selectedOptionIds: ["focused"],
				}),
			],
			expect.objectContaining({
				completionPolicy: "finalize_current_questions",
				role: "mission_pilot",
				executionPolicy: expect.objectContaining({
					allowProviderTools: false,
					enableMcp: false,
					enableMemory: false,
					isolatedHome: true,
				}),
			}),
		);
		expect(mocks.callLlm).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(String),
			expect.objectContaining({
				role: "mission_pilot",
				taskId,
				usageTrace: expect.objectContaining({
					owner: "mission_pilot",
					channel: "pilot_thought",
					orchestrationRef: expect.objectContaining({
						sessionId: session.id,
					}),
				}),
			}),
		);
		expect(mocks.callLlm).toHaveBeenCalledTimes(4);
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
			reviewJson: {
				artifactScores: [
					expect.objectContaining({
						artifactKind: "feature_plan",
						sourceMessageId: featurePlanMessageId,
					}),
				],
			},
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
			retryState: "recovered",
			autoRetryCount: 1,
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
