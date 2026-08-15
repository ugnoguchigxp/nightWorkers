import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../api/db/client";
import {
	securityAssessmentAttempts,
	securityContractHeads,
	securityContracts,
	securityFinalJudgments,
	taskCompletionConditionHeads,
	taskCompletionConditions,
} from "../api/db/security-intelligence-schema";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { evaluateSecurityFinalizationGate } from "../api/modules/securityIntelligence/security-finalization-gate.service";
import {
	claimPostAssessmentStart,
	saveAssessmentAttempt,
	saveCompletionConditionWithCas,
	saveSecurityContractWithCas,
} from "../api/modules/securityIntelligence/security-intelligence.repository";
import {
	deriveAdoptedCompletionCondition,
	deriveSecurityContractV1,
	deriveSecurityFinalJudgmentV1,
} from "../shared/schemas/security-intelligence-runtime.schema";

async function createRun() {
	const repository = await repo.createRepository({
		name: `TEST: security finalization ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await repo.createTask({
		repositoryId: repository.id,
		title: "TEST: security finalization",
	});
	if (!task.currentRevisionSnapshotId) throw new Error("snapshot missing");
	const snapshot = await repo.getTaskRevisionSnapshot(
		task.currentRevisionSnapshotId,
	);
	if (!snapshot) throw new Error("snapshot missing");
	const run = await repo.createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		taskRevisionSnapshotId: snapshot.id,
		taskRevision: snapshot.revision,
		taskDigest: snapshot.digest,
		status: "running",
	});
	return { repository, task, snapshot, run };
}

async function createGatedRun() {
	const created = await createRun();
	const bindingRef = `siasb:v1:${"1".repeat(64)}`;
	const contract = deriveSecurityContractV1({
		version: 1,
		contractRevision: 1,
		taskId: created.task.id,
		taskRevisionSnapshotId: created.snapshot.id,
		taskRevision: created.snapshot.revision,
		taskDigest: created.snapshot.digest,
		repositoryId: created.repository.id,
		projectRef: "project:11111111-1111-4111-8111-111111111111",
		sourceState: {
			phase: "pre_implementation",
			assessmentSubjectBindingRef: bindingRef,
			revisionRole: "assessed_revision",
			revision: "working-tree/test",
			targetDigest: `sha256:${"2".repeat(64)}`,
		},
		affectedAssets: [],
		declaredInvariantRefs: [],
		knowledgeRefs: [],
		assessmentSubjectBindingRefs: [bindingRef],
		requiredBaselineVerificationRefs: [],
		targetedVerificationCandidateRefs: [],
		nonGoals: [],
		approvedBounds: { policyRefs: [], budgetRefs: [] },
		unknowns: [],
		createdAt: new Date().toISOString(),
		authorPrincipalRef: "test-principal",
	});
	await db.insert(securityContracts).values({
		version: 1,
		contractRef: contract.contractRef,
		contractRevision: contract.contractRevision,
		taskId: contract.taskId,
		taskRevisionSnapshotId: contract.taskRevisionSnapshotId,
		taskRevision: contract.taskRevision,
		taskDigest: contract.taskDigest,
		repositoryId: contract.repositoryId,
		payloadJson: contract,
		contractDigest: contract.contractDigest,
		authorPrincipalRef: contract.authorPrincipalRef,
	});
	await db.insert(securityContractHeads).values({
		taskRevisionSnapshotId: created.snapshot.id,
		currentContractRef: contract.contractRef,
		headRevision: 1,
		updatedAt: new Date(),
	});
	const condition = deriveAdoptedCompletionCondition({
		taskId: created.task.id,
		taskRevisionSnapshotId: created.snapshot.id,
		taskRevision: created.snapshot.revision,
		taskDigest: created.snapshot.digest,
		conditionRevision: 1,
		conditionKey: "security-closeout",
		state: "adopted",
		source: {
			kind: "direct_user_instruction",
			messageRef: "message:test",
			artifactDigest: `sha256:${"3".repeat(64)}`,
		},
		subjectRef: contract.contractRef,
		recordedAt: new Date().toISOString(),
		authorPrincipalRef: "test-principal",
	});
	await db.insert(taskCompletionConditions).values({
		conditionRef: condition.conditionRef,
		taskId: condition.taskId,
		taskRevisionSnapshotId: condition.taskRevisionSnapshotId,
		taskRevision: condition.taskRevision,
		taskDigest: condition.taskDigest,
		conditionRevision: condition.conditionRevision,
		conditionKey: condition.conditionKey,
		state: condition.state,
		sourceJson: condition.source,
		subjectRef: condition.subjectRef,
		conditionDigest: condition.conditionDigest,
		recordedAt: new Date(condition.recordedAt),
		authorPrincipalRef: condition.authorPrincipalRef,
	});
	await db.insert(taskCompletionConditionHeads).values({
		taskRevisionSnapshotId: created.snapshot.id,
		conditionKey: condition.conditionKey,
		currentConditionRef: condition.conditionRef,
		headRevision: 1,
	});
	return { ...created, contract, condition };
}

describe("Security Final Judgment gate", () => {
	it("persists the latest retryability after a repeated unavailable assessment", async () => {
		const created = await createRun();
		const attempt = {
			attemptRef: `siat:v1:${"a".repeat(64)}`,
			requestDigest: `sha256:${"a".repeat(64)}`,
			phase: "post_implementation" as const,
			repositoryId: created.repository.id,
			taskId: created.task.id,
			taskRevisionSnapshotId: created.snapshot.id,
			implementationRunId: created.run.id,
			status: "unavailable" as const,
		};
		await saveAssessmentAttempt({
			...attempt,
			reasonCode: "transport_unavailable",
			retryable: true,
		});
		await saveAssessmentAttempt({
			...attempt,
			reasonCode: "contract_mismatch",
			retryable: false,
		});
		const [saved] = await db
			.select()
			.from(securityAssessmentAttempts)
			.where(eq(securityAssessmentAttempts.attemptRef, attempt.attemptRef));
		expect(saved).toMatchObject({
			status: "unavailable",
			reasonCode: "contract_mismatch",
			retryable: false,
		});
	});

	it("replays one assessment attempt under concurrent initial requests", async () => {
		const created = await createRun();
		const attempt = {
			attemptRef: `siat:v1:${"b".repeat(64)}`,
			requestDigest: `sha256:${"b".repeat(64)}`,
			phase: "post_implementation" as const,
			repositoryId: created.repository.id,
			taskId: created.task.id,
			taskRevisionSnapshotId: created.snapshot.id,
			implementationRunId: created.run.id,
			status: "unavailable" as const,
			reasonCode: "transport_unavailable",
			retryable: true,
		};
		const results = await Promise.all([
			saveAssessmentAttempt(attempt),
			saveAssessmentAttempt(attempt),
		]);
		expect(results[0]?.id).toBe(results[1]?.id);
		expect(
			await db
				.select()
				.from(securityAssessmentAttempts)
				.where(
					eq(securityAssessmentAttempts.requestDigest, attempt.requestDigest),
				),
		).toHaveLength(1);
	});

	it("claims one post assessment starter and preserves its restart checkpoint", async () => {
		const created = await createRun();
		const identity = {
			attemptRef: `siat:v1:${"c".repeat(64)}`,
			requestDigest: `sha256:${"c".repeat(64)}`,
			phase: "post_implementation" as const,
			repositoryId: created.repository.id,
			taskId: created.task.id,
			taskRevisionSnapshotId: created.snapshot.id,
			implementationRunId: created.run.id,
		};
		const claims = await Promise.all([
			claimPostAssessmentStart(identity),
			claimPostAssessmentStart(identity),
		]);
		expect(claims.filter((claim) => claim.acquired)).toHaveLength(1);

		const checkpoint = {
			version: 1,
			stage: "grant_created",
			grantRef: "grant:test",
		};
		await saveAssessmentAttempt({
			...identity,
			status: "unavailable",
			reasonCode: "SECURITY_POST_ASSESSMENT_GRANT_CREATED",
			retryable: true,
			executionContextJson: checkpoint,
		});
		const replay = await claimPostAssessmentStart(identity);
		expect(replay).toMatchObject({
			acquired: false,
			attempt: { executionContextJson: checkpoint },
		});
		const previewedCheckpoint = {
			...checkpoint,
			stage: "previewed",
			previewRef: "preview:test",
		};
		const startedCheckpoint = {
			...previewedCheckpoint,
			stage: "started",
			scanRunRef: "scan:test",
		};
		await saveAssessmentAttempt({
			...identity,
			status: "unavailable",
			reasonCode: "SECURITY_POST_ASSESSMENT_PREVIEWED",
			retryable: true,
			executionContextJson: previewedCheckpoint,
		});
		await saveAssessmentAttempt({
			...identity,
			status: "unavailable",
			reasonCode: "SECURITY_POST_ASSESSMENT_SCAN_STARTED",
			retryable: true,
			executionContextJson: startedCheckpoint,
		});
		await saveAssessmentAttempt({
			...identity,
			status: "unavailable",
			reasonCode: "SECURITY_POST_ASSESSMENT_GRANT_CREATED",
			retryable: true,
			executionContextJson: checkpoint,
		});
		const [afterStaleWrite] = await db
			.select()
			.from(securityAssessmentAttempts)
			.where(
				eq(securityAssessmentAttempts.requestDigest, identity.requestDigest),
			);
		expect(afterStaleWrite).toMatchObject({
			reasonCode: "SECURITY_POST_ASSESSMENT_SCAN_STARTED",
			executionContextJson: startedCheckpoint,
		});
		await expect(
			saveAssessmentAttempt({
				...identity,
				status: "unavailable",
				reasonCode: "SECURITY_POST_ASSESSMENT_SCAN_STARTED",
				retryable: true,
				executionContextJson: {
					...startedCheckpoint,
					scanRunRef: "scan:conflict",
				},
			}),
		).rejects.toThrow("assessment_attempt_checkpoint_conflict");

		await saveAssessmentAttempt({
			...identity,
			status: "completed",
			retryable: false,
			executionContextJson: startedCheckpoint,
		});
		const [completed] = await db
			.select()
			.from(securityAssessmentAttempts)
			.where(
				eq(securityAssessmentAttempts.requestDigest, identity.requestDigest),
			);
		expect(completed).toMatchObject({
			status: "completed",
			executionContextJson: startedCheckpoint,
		});
	});

	it("allows only one initial Contract head under concurrent CAS", async () => {
		const created = await createRun();
		const candidate = (marker: string) =>
			deriveSecurityContractV1({
				version: 1,
				contractRevision: 1,
				taskId: created.task.id,
				taskRevisionSnapshotId: created.snapshot.id,
				taskRevision: created.snapshot.revision,
				taskDigest: created.snapshot.digest,
				repositoryId: created.repository.id,
				projectRef: "project:11111111-1111-4111-8111-111111111111",
				sourceState: {
					phase: "pre_implementation",
					assessmentSubjectBindingRef: `siasb:v1:${"1".repeat(64)}`,
					revisionRole: "assessed_revision",
					revision: "working-tree/test",
					targetDigest: `sha256:${"2".repeat(64)}`,
				},
				affectedAssets: [],
				declaredInvariantRefs: [],
				knowledgeRefs: [],
				assessmentSubjectBindingRefs: [`siasb:v1:${"1".repeat(64)}`],
				requiredBaselineVerificationRefs: [],
				targetedVerificationCandidateRefs: [],
				nonGoals: [marker],
				approvedBounds: { policyRefs: [], budgetRefs: [] },
				unknowns: [],
				createdAt: new Date().toISOString(),
				authorPrincipalRef: "test-principal",
			});
		const results = await Promise.allSettled(
			["candidate-a", "candidate-b"].map((marker) =>
				saveSecurityContractWithCas({
					contract: candidate(marker),
					expectedCurrentContractRef: null,
					expectedHeadRevision: 0,
				}),
			),
		);
		const diagnostics = results.map((result) =>
			result.status === "fulfilled"
				? { status: result.status }
				: {
						status: result.status,
						message:
							result.reason instanceof Error
								? result.reason.message
								: String(result.reason),
						code:
							result.reason && typeof result.reason === "object"
								? (result.reason as { code?: unknown }).code
								: undefined,
					},
		);
		expect(
			results.filter((result) => result.status === "fulfilled"),
			JSON.stringify(diagnostics),
		).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected).toMatchObject({
			status: "rejected",
			reason: {
				code: "SECURITY_INTELLIGENCE_INTEGRITY_CONFLICT",
				reasonCode: "security_contract_head_conflict",
			},
		});
	});

	it("allows only one initial condition head under concurrent CAS", async () => {
		const created = await createRun();
		const candidate = (marker: string) =>
			deriveAdoptedCompletionCondition({
				taskId: created.task.id,
				taskRevisionSnapshotId: created.snapshot.id,
				taskRevision: created.snapshot.revision,
				taskDigest: created.snapshot.digest,
				conditionRevision: 1,
				conditionKey: "security-closeout",
				state: "adopted",
				source: {
					kind: "direct_user_instruction",
					messageRef: `message:${marker}`,
					artifactDigest: `sha256:${(marker === "a" ? "4" : "5").repeat(64)}`,
				},
				subjectRef: `sic:v1:${"6".repeat(64)}`,
				recordedAt: new Date().toISOString(),
				authorPrincipalRef: "test-principal",
			});
		const results = await Promise.allSettled(
			["a", "b"].map((marker) =>
				saveCompletionConditionWithCas({
					condition: candidate(marker),
					expectedCurrentConditionRef: null,
					expectedHeadRevision: 0,
				}),
			),
		);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected).toMatchObject({
			status: "rejected",
			reason: {
				code: "SECURITY_INTELLIGENCE_INTEGRITY_CONFLICT",
				reasonCode: "completion_condition_head_conflict",
			},
		});
	});

	it("does not add a Security gate when no adopted condition exists", async () => {
		const { run } = await createRun();
		await expect(
			evaluateSecurityFinalizationGate({ runId: run.id }),
		).resolves.toMatchObject({ required: false, valid: true });
	});

	it("keeps a gated Run nonterminal until a judgment is supplied", async () => {
		const { run, condition } = await createGatedRun();
		await expect(
			evaluateSecurityFinalizationGate({ runId: run.id }),
		).resolves.toMatchObject({
			required: true,
			valid: false,
			reasonCode: "SECURITY_FINAL_JUDGMENT_MISSING",
			conditionRefs: [condition.conditionRef],
		});
		expect((await repo.getTaskRun(run.id))?.status).toBe("running");
	});

	it("persists one exact judgment and rejects it after the Contract head changes", async () => {
		const { run, snapshot, contract, condition } = await createGatedRun();
		const judgment = deriveSecurityFinalJudgmentV1({
			version: 1,
			runId: run.id,
			taskRevisionSnapshotId: snapshot.id,
			securityContractRef: contract.contractRef,
			securityContractDigest: contract.contractDigest,
			assessmentAttemptRefs: [],
			assessmentSubjectBindingRefs: [],
			conditionEvaluations: [
				{
					conditionRef: condition.conditionRef,
					result: "unavailable",
					evidenceRefs: [],
					limitationCodes: ["assessment_unavailable"],
					rationale: "The required producer was unavailable.",
				},
			],
			residualRisk: { level: "unknown", rationale: "No current assessment." },
			createdAt: new Date().toISOString(),
		});
		await expect(
			evaluateSecurityFinalizationGate({
				runId: run.id,
				proposedJudgment: judgment,
			}),
		).resolves.toMatchObject({ required: true, valid: true, judgment });
		expect(
			(await db.select().from(securityFinalJudgments)).filter(
				(row) => row.runId === run.id,
			),
		).toHaveLength(1);

		const {
			contractRef: _contractRef,
			contractDigest: _contractDigest,
			...contractSemantic
		} = contract;
		const successor = deriveSecurityContractV1({
			...contractSemantic,
			contractRevision: 2,
			nonGoals: ["changed-head"],
			supersedesContractRef: contract.contractRef,
			createdAt: new Date().toISOString(),
		});
		await db.insert(securityContracts).values({
			version: 1,
			contractRef: successor.contractRef,
			contractRevision: 2,
			taskId: successor.taskId,
			taskRevisionSnapshotId: successor.taskRevisionSnapshotId,
			taskRevision: successor.taskRevision,
			taskDigest: successor.taskDigest,
			repositoryId: successor.repositoryId,
			payloadJson: successor,
			supersedesContractRef: contract.contractRef,
			contractDigest: successor.contractDigest,
			authorPrincipalRef: successor.authorPrincipalRef,
		});
		await db
			.update(securityContractHeads)
			.set({
				currentContractRef: successor.contractRef,
				headRevision: 2,
				updatedAt: new Date(),
			})
			.where(eq(securityContractHeads.taskRevisionSnapshotId, snapshot.id));
		await expect(
			evaluateSecurityFinalizationGate({ runId: run.id }),
		).resolves.toMatchObject({
			required: true,
			valid: false,
			reasonCode: "SECURITY_FINAL_JUDGMENT_CONTRACT_CONFLICT",
		});
		expect((await repo.getTaskRun(run.id))?.status).toBe("running");
	});
});
