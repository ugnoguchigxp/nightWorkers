import crypto from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
	deriveSecurityFinalJudgmentV1,
	securityFinalJudgmentV1Schema,
	submitSecurityFinalJudgmentCommandV1Schema,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { db } from "../../db/client";
import { evidenceSubjectSnapshots } from "../../db/evidence-ledger-schema";
import { taskEvents, taskRunTodos } from "../../db/schema-task-execution";
import { taskRuns } from "../../db/schema-task-runs";
import {
	securityAssessmentAttempts,
	securityAssessmentReceipts,
	securityAssessmentSubjectBindings,
	securityFinalJudgments,
} from "../../db/security-intelligence-schema";
import {
	verificationDocuments,
	verificationEvidenceRuns,
} from "../../db/verification-schema";
import { AppError } from "../../lib/errors";
import {
	getCurrentCompletionConditions,
	getCurrentSecurityContract,
} from "./security-intelligence.repository";

function exactUniqueSet(actual: string[], expected: string[]) {
	return (
		new Set(actual).size === actual.length &&
		new Set(expected).size === expected.length &&
		actual.length === expected.length &&
		actual.every((value) => expected.includes(value))
	);
}

function addAssessmentEvidenceRefs(allowed: Set<string>, payload: unknown) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
	const bundle = payload as {
		dependencyAssessment?: {
			assessmentRef?: unknown;
			evidenceRefs?: Array<{ ref?: unknown }>;
		};
		authorizationShadow?: {
			status?: unknown;
			assessment?: {
				assessmentRef?: unknown;
				evidenceRefs?: Array<{ ref?: unknown }>;
			};
		};
	};
	for (const assessment of [
		bundle.dependencyAssessment,
		bundle.authorizationShadow?.status === "available"
			? bundle.authorizationShadow.assessment
			: undefined,
	]) {
		if (typeof assessment?.assessmentRef === "string") {
			allowed.add(assessment.assessmentRef);
		}
		for (const evidence of assessment?.evidenceRefs ?? []) {
			if (typeof evidence.ref === "string") allowed.add(evidence.ref);
		}
	}
}

export async function findSecurityFinalJudgment(runId: string) {
	const [row] = await db
		.select()
		.from(securityFinalJudgments)
		.where(eq(securityFinalJudgments.runId, runId))
		.limit(1);
	return row ? securityFinalJudgmentV1Schema.parse(row.payloadJson) : null;
}

export async function submitSecurityFinalJudgment(rawInput: unknown) {
	const input = submitSecurityFinalJudgmentCommandV1Schema.parse(rawInput);
	const judgment = securityFinalJudgmentV1Schema.parse(input.judgment);
	const { judgmentDigest: _judgmentDigest, ...semanticJudgment } = judgment;
	const recomputed = deriveSecurityFinalJudgmentV1(semanticJudgment);
	if (recomputed.judgmentDigest !== judgment.judgmentDigest) {
		throw new AppError(
			400,
			"SECURITY_FINAL_JUDGMENT_DIGEST_MISMATCH",
			"Security Final Judgment digestが一致しません。",
		);
	}
	return db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(taskRuns)
			.where(eq(taskRuns.id, input.runId))
			.limit(1);
		if (!run) {
			throw new AppError(
				404,
				"SECURITY_FINAL_JUDGMENT_RUN_NOT_FOUND",
				"Run not found",
			);
		}
		if (
			run.status !== input.expectedRunStatus ||
			run.taskRevisionSnapshotId !== input.expectedTaskRevisionSnapshotId ||
			judgment.runId !== run.id ||
			judgment.taskRevisionSnapshotId !== run.taskRevisionSnapshotId
		) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_RUN_CONFLICT",
				"Run statusまたはTask Revision Snapshotが変化しました。",
			);
		}
		const currentContract = await getCurrentSecurityContract(
			run.taskRevisionSnapshotId,
			tx,
		);
		if (
			!currentContract ||
			currentContract.contract.contractRef !==
				input.expectedSecurityContractRef ||
			judgment.securityContractRef !== currentContract.contract.contractRef ||
			judgment.securityContractDigest !==
				currentContract.contract.contractDigest
		) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_CONTRACT_CONFLICT",
				"current Security Contractが提出時の参照と一致しません。",
			);
		}
		const currentConditions = (
			await getCurrentCompletionConditions(run.taskRevisionSnapshotId, tx)
		)
			.map((item) => item.condition)
			.filter((condition) => condition.state === "adopted");
		const currentConditionRefs = currentConditions.map(
			(condition) => condition.conditionRef,
		);
		const evaluationRefs = judgment.conditionEvaluations.map(
			(evaluation) => evaluation.conditionRef,
		);
		if (
			!exactUniqueSet(input.expectedConditionRefs, currentConditionRefs) ||
			!exactUniqueSet(evaluationRefs, currentConditionRefs)
		) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_CONDITION_SET_MISMATCH",
				"Final Judgmentのcondition集合がcurrent setと一致しません。",
			);
		}
		for (const condition of currentConditions) {
			if (condition.source.kind !== "coding_agent_todo") continue;
			const [todo] = await tx
				.select()
				.from(taskRunTodos)
				.where(
					and(
						eq(taskRunTodos.runId, condition.source.runId),
						eq(taskRunTodos.todoKey, condition.source.todoKey),
					),
				)
				.limit(1);
			if (
				condition.source.runId !== run.id ||
				!todo ||
				todo.revision !== condition.source.todoRevision ||
				run.todoPlanRevision !== condition.source.todoPlanRevision
			) {
				throw new AppError(
					409,
					"SECURITY_FINAL_JUDGMENT_TODO_STALE",
					"conditionが参照するTodo revisionはcurrentではありません。",
				);
			}
		}
		const attempts = judgment.assessmentAttemptRefs.length
			? await tx
					.select()
					.from(securityAssessmentAttempts)
					.where(
						inArray(
							securityAssessmentAttempts.attemptRef,
							judgment.assessmentAttemptRefs,
						),
					)
			: [];
		if (
			attempts.length !== judgment.assessmentAttemptRefs.length ||
			attempts.some(
				(attempt) =>
					attempt.taskRevisionSnapshotId !== run.taskRevisionSnapshotId ||
					(attempt.phase === "post_implementation" &&
						attempt.implementationRunId !== run.id),
			)
		) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_FOREIGN_ATTEMPT",
				"Final Judgmentがstaleまたはforeign assessment attemptを参照しています。",
			);
		}
		const bindings = judgment.assessmentSubjectBindingRefs.length
			? await tx
					.select()
					.from(securityAssessmentSubjectBindings)
					.where(
						inArray(
							securityAssessmentSubjectBindings.bindingRef,
							judgment.assessmentSubjectBindingRefs,
						),
					)
			: [];
		if (
			bindings.length !== judgment.assessmentSubjectBindingRefs.length ||
			bindings.some(
				(binding) =>
					binding.taskRevisionSnapshotId !== run.taskRevisionSnapshotId ||
					(binding.phase === "post_implementation" &&
						binding.implementationRunId !== run.id),
			)
		) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_FOREIGN_SUBJECT",
				"Final Judgmentがstaleまたはforeign subject bindingを参照しています。",
			);
		}
		const receiptIds = new Set([
			...attempts.flatMap((attempt) =>
				attempt.assessmentReceiptId ? [attempt.assessmentReceiptId] : [],
			),
			...bindings.map((binding) => binding.assessmentReceiptId),
		]);
		const receipts = receiptIds.size
			? await tx
					.select()
					.from(securityAssessmentReceipts)
					.where(inArray(securityAssessmentReceipts.id, [...receiptIds]))
			: [];
		const postSubjectIds = bindings.flatMap((binding) =>
			binding.evidenceSubjectSnapshotId
				? [binding.evidenceSubjectSnapshotId]
				: [],
		);
		const evidenceSubjects = postSubjectIds.length
			? await tx
					.select()
					.from(evidenceSubjectSnapshots)
					.where(inArray(evidenceSubjectSnapshots.id, postSubjectIds))
			: [];
		if (
			evidenceSubjects.some(
				(subject) =>
					subject.implementationRunId !== run.id ||
					subject.taskRevisionSnapshotId !== run.taskRevisionSnapshotId,
			)
		) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_FOREIGN_EVIDENCE_SUBJECT",
				"Evidence Subject Snapshotがcurrent Runに属していません。",
			);
		}
		const [evidenceRuns, documents] = await Promise.all([
			tx
				.select()
				.from(verificationEvidenceRuns)
				.where(eq(verificationEvidenceRuns.runId, run.id)),
			tx
				.select()
				.from(verificationDocuments)
				.where(eq(verificationDocuments.runId, run.id)),
		]);
		const allowedEvidenceRefs = new Set<string>([
			...judgment.assessmentAttemptRefs,
			...judgment.assessmentSubjectBindingRefs,
			...receipts.flatMap((receipt) => [
				receipt.receiptRef,
				receipt.bundleRef,
				...receipt.assessmentRefsJson,
			]),
			...evidenceSubjects.flatMap((subject) => [
				subject.id,
				`evidence-subject:${subject.id}`,
			]),
			...evidenceRuns.flatMap((evidenceRun) => [
				evidenceRun.id,
				`verification-evidence:${evidenceRun.id}`,
			]),
			...documents.flatMap((document) => [
				document.id,
				`verification-document:${document.id}`,
			]),
		]);
		for (const receipt of receipts) {
			addAssessmentEvidenceRefs(allowedEvidenceRefs, receipt.payloadJson);
		}
		const foreignEvidence = judgment.conditionEvaluations
			.flatMap((evaluation) => evaluation.evidenceRefs)
			.filter((ref) => !allowedEvidenceRefs.has(ref));
		if (foreignEvidence.length > 0) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_FOREIGN_EVIDENCE",
				"Final Judgmentがcurrent Runへbindingされていないevidenceを参照しています。",
				{ evidenceRefs: foreignEvidence },
			);
		}
		const [existing] = await tx
			.select()
			.from(securityFinalJudgments)
			.where(eq(securityFinalJudgments.runId, run.id))
			.limit(1);
		if (existing) {
			if (existing.judgmentDigest !== judgment.judgmentDigest) {
				throw new AppError(
					409,
					"SECURITY_FINAL_JUDGMENT_CONFLICT",
					"Runには異なるFinal Judgmentが保存済みです。",
				);
			}
			return judgment;
		}
		const [updatedRun] = await tx
			.update(taskRuns)
			.set({ finalJudgment: judgment, updatedAt: new Date() })
			.where(
				and(
					eq(taskRuns.id, run.id),
					eq(taskRuns.status, input.expectedRunStatus),
					isNull(taskRuns.finalJudgment),
				),
			)
			.returning();
		if (!updatedRun) {
			throw new AppError(
				409,
				"SECURITY_FINAL_JUDGMENT_RUN_CONFLICT",
				"Final Judgment保存前にRunが変化しました。",
			);
		}
		await tx.insert(securityFinalJudgments).values({
			judgmentRef: `sifj:v1:${judgment.judgmentDigest.slice("sha256:".length)}`,
			runId: run.id,
			taskRevisionSnapshotId: run.taskRevisionSnapshotId as string,
			securityContractRef: judgment.securityContractRef,
			securityContractDigest: judgment.securityContractDigest,
			judgmentDigest: judgment.judgmentDigest,
			payloadJson: judgment,
		});
		const [{ maxSeq }] = await tx
			.select({ maxSeq: sql<number>`coalesce(max(${taskEvents.seq}), 0)` })
			.from(taskEvents)
			.where(eq(taskEvents.taskRunId, run.id));
		await tx.insert(taskEvents).values({
			id: crypto.randomUUID(),
			taskRunId: run.id,
			seq: (maxSeq ?? 0) + 1,
			actor: "worker",
			eventType: "final_report",
			type: "run.final_judgment_created",
			message: "Structured Security Final Judgment was persisted.",
			payloadJson: {
				judgmentRef: `sifj:v1:${judgment.judgmentDigest.slice("sha256:".length)}`,
				judgmentDigest: judgment.judgmentDigest,
				conditionRefs: currentConditionRefs,
			},
			timestamp: new Date(),
		});
		return judgment;
	});
}
