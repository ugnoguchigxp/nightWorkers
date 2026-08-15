import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db } from "../api/db/client";
import { securityAssessmentSubjectBindings } from "../api/db/security-intelligence-schema";
import { AppError } from "../api/lib/errors";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { mergeSecurityContinuationResult } from "../api/modules/nightworkers/run-orchestration/security-runtime-finalization";
import {
	classifyPostAssessmentFailure,
	postSecurityAssessmentConfiguration,
	shouldPropagatePostAssessmentFailure,
} from "../api/modules/securityIntelligence/post-security-assessment.service";
import { writeSecurityContract } from "../api/modules/securityIntelligence/security-contract.service";
import {
	saveAssessmentReceipt,
	saveProviderScanBinding,
	saveSubjectBinding,
} from "../api/modules/securityIntelligence/security-intelligence.repository";
import { buildSecurityRuntimeContextSnapshot } from "../api/modules/securityIntelligence/security-runtime-context.service";
import { executeSecurityIntelligenceTaskOperatorAction } from "../api/modules/taskOperator/application/security-intelligence-task-operator.command";
import { humanTaskOperatorCommandContext } from "../api/modules/taskOperator/task-operator-http-context";
import {
	deriveNightworkersSecurityIntelligenceBundleRef,
	nightworkersSecurityIntelligenceBundleSchema,
} from "../shared/schemas/nightworkers-security-intelligence.schema";
import {
	deriveProviderScanBindingV2,
	deriveSecurityAssessmentReceiptV1,
	deriveSecurityAssessmentSubjectBindingV1,
	securityAssessmentReceiptV1Schema,
} from "../shared/schemas/security-intelligence-runtime.schema";

function assessmentBundle(marker: number) {
	const envelope = JSON.parse(
		readFileSync(
			new URL(
				"../shared/fixtures/nightworkers-security-intelligence-v1.json",
				import.meta.url,
			),
			"utf8",
		),
	) as { data: Record<string, unknown> };
	const raw = structuredClone(envelope.data) as {
		bundleRef: string;
		dependencyAssessment: { generatedAt: string };
	};
	raw.dependencyAssessment.generatedAt = new Date(
		Date.UTC(2026, 7, 15, 2, 0, marker),
	).toISOString();
	const { bundleRef: _bundleRef, ...semantic } = raw;
	raw.bundleRef = deriveNightworkersSecurityIntelligenceBundleRef(
		semantic as never,
	);
	return nightworkersSecurityIntelligenceBundleSchema.parse(raw);
}

function assessmentReceiptFixture(repositoryId: string, marker: number) {
	const payload = assessmentBundle(marker);
	const scanRunRef = crypto.randomUUID();
	const providerProjectRef = crypto.randomUUID();
	const binding = deriveProviderScanBindingV2({
		version: 2,
		repositoryId,
		provider: "vulnworkbench",
		identityMappingVersion: 1,
		providerProjectRef,
		scanRunRef,
		selection: { mode: "preset", presetId: "standard" },
		requestedTarget: { kind: "working_tree" },
		resolvedTarget: {
			kind: "working_tree",
			sourceRevisionRole: "base_revision",
			sourceRevision: payload.target.sourceRevision,
			targetDigest: payload.target.targetDigest.slice("sha256:".length),
		},
		createdAt: new Date().toISOString(),
	});
	const proofDigest = crypto
		.createHash("sha256")
		.update(`proof:${marker}:${scanRunRef}`)
		.digest("hex");
	const receipt = deriveSecurityAssessmentReceiptV1({
		repositoryId,
		scanBindingRef: binding.bindingRef,
		providerBindingProofRef: `sibp:v1:${proofDigest}`,
		providerBindingProofDigest: `sha256:${proofDigest}`,
		providerProjectRef,
		scanRunRef,
		canonicalProjectRef: payload.projectRef,
		canonicalScanRunRef: payload.scanRunRef,
		normalizedTarget: payload.target,
		payload,
		receivedAt: new Date().toISOString(),
	});
	return { binding, receipt };
}

async function createAssessmentReceipt(repositoryId: string, marker: number) {
	const fixture = assessmentReceiptFixture(repositoryId, marker);
	const savedBinding = await saveProviderScanBinding(fixture.binding);
	return {
		receipt: fixture.receipt,
		saved: await saveAssessmentReceipt({
			receipt: fixture.receipt,
			scanBindingId: savedBinding.id,
		}),
	};
}

async function createTaskFixture(title: string) {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: ${title} ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title,
	});
	if (!task.currentRevisionSnapshotId) throw new Error("snapshot missing");
	const snapshot = await nightworkersRepo.getTaskRevisionSnapshot(
		task.currentRevisionSnapshotId,
	);
	if (!snapshot) throw new Error("snapshot missing");
	return { repository, task, snapshot };
}

function bindingIdentity(marker: string) {
	const digest = crypto.createHash("sha256").update(marker).digest("hex");
	return {
		bindingRef: `siasb:v1:${digest}`,
		bindingDigest: `sha256:${digest}`,
	};
}

describe("Security Intelligence review regressions", () => {
	it("keeps the post-assessment command independently disabled by default", () => {
		expect(postSecurityAssessmentConfiguration({})).toEqual({ enabled: false });
		expect(
			postSecurityAssessmentConfiguration({
				NIGHTWORKERS_SECURITY_INTELLIGENCE_CONSUMER_ENABLED: "true",
			}),
		).toEqual({ enabled: false });
		expect(
			postSecurityAssessmentConfiguration({
				NIGHTWORKERS_SECURITY_INTELLIGENCE_POST_ASSESSMENT_ENABLED: "true",
			}),
		).toEqual({ enabled: true });
	});

	it("returns retryable provider conflicts as a durable unavailable result", () => {
		expect(
			shouldPropagatePostAssessmentFailure(
				new AppError(409, "REPORT_NOT_READY", "not ready", {
					retryable: true,
				}),
			),
		).toBe(false);
		expect(
			shouldPropagatePostAssessmentFailure(
				new AppError(409, "IDENTITY_CONFLICT", "conflict"),
			),
		).toBe(true);
		expect(
			shouldPropagatePostAssessmentFailure(
				new AppError(503, "UNAVAILABLE", "unavailable", { retryable: true }),
			),
		).toBe(false);
		expect(
			classifyPostAssessmentFailure(
				new AppError(
					409,
					"SECURITY_INTELLIGENCE_PROVIDER_PREVIEW_EXPIRED",
					"expired",
				),
				"previewed",
			),
		).toMatchObject({
			resetPreStartCheckpoint: true,
			retryable: true,
			propagate: false,
		});
		expect(
			classifyPostAssessmentFailure(
				new AppError(
					409,
					"SECURITY_INTELLIGENCE_PROVIDER_PREVIEW_EXPIRED",
					"expired",
				),
				"started",
			),
		).toMatchObject({
			resetPreStartCheckpoint: false,
			retryable: false,
			propagate: true,
		});
	});

	it("converges concurrent scan binding and assessment receipt inserts", async () => {
		const created = await createTaskFixture("assessment receipt concurrency");
		const fixture = assessmentReceiptFixture(created.repository.id, 9);
		const bindings = await Promise.all([
			saveProviderScanBinding(fixture.binding),
			saveProviderScanBinding(fixture.binding),
		]);
		expect(bindings[0].id).toBe(bindings[1].id);

		const receipts = await Promise.all([
			saveAssessmentReceipt({
				receipt: fixture.receipt,
				scanBindingId: bindings[0].id,
			}),
			saveAssessmentReceipt({
				receipt: fixture.receipt,
				scanBindingId: bindings[0].id,
			}),
		]);
		expect(receipts[0].id).toBe(receipts[1].id);
		expect(receipts.filter((receipt) => !receipt.replayed)).toHaveLength(1);
	});

	it("replays one subject binding under concurrent identical requests", async () => {
		const created = await createTaskFixture("subject binding idempotency");
		const receipt = await createAssessmentReceipt(created.repository.id, 8);
		if (
			created.repository.repositoryIdentityRevision === null ||
			!created.repository.baseWorktreeId ||
			!created.repository.baseWorktreeHeadSha
		) {
			throw new Error("repository identity missing");
		}
		const binding = deriveSecurityAssessmentSubjectBindingV1({
			version: 1,
			phase: "pre_implementation",
			assessmentReceiptRef: receipt.receipt.receiptRef,
			taskId: created.task.id,
			taskRevisionSnapshotId: created.snapshot.id,
			taskRevision: created.snapshot.revision,
			taskDigest: created.snapshot.digest,
			repositoryIdentityRevision: created.repository.repositoryIdentityRevision,
			repositoryBaseWorktreeId: created.repository.baseWorktreeId,
			expectedBaseHeadSha: created.repository.baseWorktreeHeadSha,
			createdAt: new Date().toISOString(),
		});
		const results = await Promise.all([
			saveSubjectBinding({
				binding,
				assessmentReceiptId: receipt.saved.id,
			}),
			saveSubjectBinding({
				binding,
				assessmentReceiptId: receipt.saved.id,
			}),
		]);
		expect(results[0]?.id).toBe(results[1]?.id);
		expect(
			(await db.select().from(securityAssessmentSubjectBindings)).filter(
				(row) => row.bindingRef === binding.bindingRef,
			),
		).toHaveLength(1);
	});

	it("rejects Task Operator mutations for a Run owned by another Task", async () => {
		const first = await createTaskFixture("first task");
		const secondTask = await nightworkersRepo.createTask({
			repositoryId: first.repository.id,
			title: "second task",
		});
		if (!secondTask.currentRevisionSnapshotId)
			throw new Error("snapshot missing");
		const secondSnapshot = await nightworkersRepo.getTaskRevisionSnapshot(
			secondTask.currentRevisionSnapshotId,
		);
		if (!secondSnapshot) throw new Error("snapshot missing");
		const foreignRun = await nightworkersRepo.createTaskRun({
			taskId: secondTask.id,
			repositoryId: first.repository.id,
			taskRevisionSnapshotId: secondSnapshot.id,
			taskRevision: secondSnapshot.revision,
			taskDigest: secondSnapshot.digest,
			status: "running",
		});
		for (const actionId of [
			"security.assessment.post.request",
			"security.knowledge.candidates.propose",
			"security.knowledge.feedback.propose",
		]) {
			await expect(
				executeSecurityIntelligenceTaskOperatorAction({
					actionId,
					taskId: first.task.id,
					arguments: { runId: foreignRun.id },
					context: humanTaskOperatorCommandContext({}),
				}),
			).rejects.toMatchObject({ code: "TASK_OPERATOR_RUN_NOT_FOUND" });
		}
	});

	it("keeps foreign post-assessment evidence out of a Run context", async () => {
		const created = await createTaskFixture("runtime evidence boundary");
		const currentRun = await nightworkersRepo.createTaskRun({
			taskId: created.task.id,
			repositoryId: created.repository.id,
			taskRevisionSnapshotId: created.snapshot.id,
			taskRevision: created.snapshot.revision,
			taskDigest: created.snapshot.digest,
			status: "running",
		});
		const foreignRun = await nightworkersRepo.createTaskRun({
			taskId: created.task.id,
			repositoryId: created.repository.id,
			taskRevisionSnapshotId: created.snapshot.id,
			taskRevision: created.snapshot.revision,
			taskDigest: created.snapshot.digest,
			status: "running",
		});
		const currentReceipt = await createAssessmentReceipt(
			created.repository.id,
			1,
		);
		const foreignReceipt = await createAssessmentReceipt(
			created.repository.id,
			2,
		);
		const pre = bindingIdentity(`pre:${created.task.id}`);
		const current = bindingIdentity(`current:${created.task.id}`);
		const foreign = bindingIdentity(`foreign:${created.task.id}`);
		await db.insert(securityAssessmentSubjectBindings).values([
			{
				...pre,
				phase: "pre_implementation",
				assessmentReceiptId: currentReceipt.saved.id,
				taskId: created.task.id,
				taskRevisionSnapshotId: created.snapshot.id,
				taskRevision: created.snapshot.revision,
				taskDigest: created.snapshot.digest,
			},
			{
				...current,
				phase: "post_implementation",
				assessmentReceiptId: currentReceipt.saved.id,
				taskId: created.task.id,
				taskRevisionSnapshotId: created.snapshot.id,
				taskRevision: created.snapshot.revision,
				taskDigest: created.snapshot.digest,
				implementationRunId: currentRun.id,
			},
			{
				...foreign,
				phase: "post_implementation",
				assessmentReceiptId: foreignReceipt.saved.id,
				taskId: created.task.id,
				taskRevisionSnapshotId: created.snapshot.id,
				taskRevision: created.snapshot.revision,
				taskDigest: created.snapshot.digest,
				implementationRunId: foreignRun.id,
			},
		]);

		const context = await buildSecurityRuntimeContextSnapshot({
			taskRevisionSnapshotId: created.snapshot.id,
			runId: currentRun.id,
		});
		expect(
			context?.assessmentSubjectBindings.map((binding) => binding.bindingRef),
		).toEqual([pre.bindingRef, current.bindingRef].sort());
		expect(
			context?.assessmentSummaries.map((summary) => summary.receiptRef),
		).toEqual([currentReceipt.receipt.receiptRef]);
		expect(JSON.stringify(context)).not.toContain(foreign.bindingRef);
		expect(JSON.stringify(context)).not.toContain(
			foreignReceipt.receipt.receiptRef,
		);

		const replay = await saveAssessmentReceipt({
			receipt: currentReceipt.receipt,
			scanBindingId: currentReceipt.saved.scanBindingId,
		});
		expect(replay.replayed).toBe(true);
		expect(replay.receipt.scanBindingRef).toBe(
			currentReceipt.receipt.scanBindingRef,
		);
		expect(() =>
			securityAssessmentReceiptV1Schema.parse(replay.receipt),
		).not.toThrow();
		await expect(
			saveAssessmentReceipt({
				receipt: {
					...currentReceipt.receipt,
					scanBindingRef: foreignReceipt.receipt.scanBindingRef,
				},
				scanBindingId: currentReceipt.saved.scanBindingId,
			}),
		).rejects.toMatchObject({
			code: "SECURITY_INTELLIGENCE_INTEGRITY_CONFLICT",
			reasonCode: "assessment_receipt_scan_binding_mismatch",
		});
	});

	it("rejects foreign assessment bindings in a Security Contract", async () => {
		const current = await createTaskFixture("contract binding boundary");
		const foreignTask = await nightworkersRepo.createTask({
			repositoryId: current.repository.id,
			title: "foreign contract task",
		});
		if (!foreignTask.currentRevisionSnapshotId)
			throw new Error("snapshot missing");
		const foreignSnapshot = await nightworkersRepo.getTaskRevisionSnapshot(
			foreignTask.currentRevisionSnapshotId,
		);
		if (!foreignSnapshot) throw new Error("snapshot missing");
		const receipt = await createAssessmentReceipt(current.repository.id, 3);
		const currentBinding = bindingIdentity(`contract:${current.task.id}`);
		const foreignBinding = bindingIdentity(`contract:${foreignTask.id}`);
		await db.insert(securityAssessmentSubjectBindings).values([
			{
				...currentBinding,
				phase: "pre_implementation",
				assessmentReceiptId: receipt.saved.id,
				taskId: current.task.id,
				taskRevisionSnapshotId: current.snapshot.id,
				taskRevision: current.snapshot.revision,
				taskDigest: current.snapshot.digest,
			},
			{
				...foreignBinding,
				phase: "pre_implementation",
				assessmentReceiptId: receipt.saved.id,
				taskId: foreignTask.id,
				taskRevisionSnapshotId: foreignSnapshot.id,
				taskRevision: foreignSnapshot.revision,
				taskDigest: foreignSnapshot.digest,
			},
		]);
		await expect(
			writeSecurityContract({
				taskId: current.task.id,
				taskRevisionSnapshotId: current.snapshot.id,
				expectedCurrentContractRef: null,
				expectedHeadRevision: 0,
				authorPrincipalRef: "test-reviewer",
				semantic: {
					projectRef: receipt.receipt.canonicalProjectRef,
					sourceState: {
						phase: "pre_implementation",
						assessmentSubjectBindingRef: currentBinding.bindingRef,
						revisionRole: "assessed_revision",
						revision: receipt.receipt.normalizedTarget.sourceRevision,
						targetDigest: receipt.receipt.normalizedTarget.targetDigest,
					},
					affectedAssets: [],
					declaredInvariantRefs: [],
					knowledgeRefs: [],
					assessmentSubjectBindingRefs: [
						currentBinding.bindingRef,
						foreignBinding.bindingRef,
					].sort(),
					requiredBaselineVerificationRefs: [],
					targetedVerificationCandidateRefs: [],
					nonGoals: [],
					approvedBounds: { policyRefs: [], budgetRefs: [] },
					unknowns: [],
				},
			}),
		).rejects.toMatchObject({
			code: "SECURITY_CONTRACT_FOREIGN_ASSESSMENT_BINDING",
		});
	});

	it("adopts the continuation result while preserving prior evidence", () => {
		const merged = mergeSecurityContinuationResult({
			previous: {
				terminalState: "completed",
				summary: "old summary",
				finalReport: "old final",
				stoppedBy: "decision",
				riskLevel: "low",
				logContent: "old log",
				diffPatch: "prior diff",
				testResults: { prior: true },
			},
			continuation: {
				terminalState: "needs_review",
				summary: "new summary",
				finalReport: "new final",
				stoppedBy: "hook",
				riskLevel: "medium",
				logContent: "new log",
			},
			securityFinalJudgment: undefined,
		});
		expect(merged).toMatchObject({
			terminalState: "needs_review",
			summary: "new summary",
			finalReport: "new final",
			stoppedBy: "hook",
			riskLevel: "medium",
			logContent: "old log\nnew log",
			diffPatch: "prior diff",
			testResults: { prior: true },
		});
	});
});
