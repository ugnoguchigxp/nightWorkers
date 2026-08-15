import { and, eq } from "drizzle-orm";
import {
	deriveSecurityAssessmentReceiptV1,
	deriveSecurityAssessmentSubjectBindingV1,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { verifySecurityIntelligenceDurableBinding } from "../../../shared/security-intelligence-binding-verifier";
import { db } from "../../db/client";
import {
	repositories,
	taskRevisionSnapshots,
	tasks,
} from "../../db/schema-base";
import {
	securityAssessmentReceipts,
	securityAssessmentSubjectBindings,
} from "../../db/security-intelligence-schema";
import { AppError } from "../../lib/errors";
import {
	findProviderScanBinding,
	saveAssessmentReceipt,
	saveSubjectBinding,
} from "./security-intelligence.repository";
import {
	securityIntelligenceAssessment,
	securityIntelligenceBindingProof,
	securityIntelligenceCapabilities,
} from "./security-intelligence-provider.client";

export function securityIntelligenceConsumerConfiguration(
	env: NodeJS.ProcessEnv = process.env,
) {
	return {
		enabled:
			env.NIGHTWORKERS_SECURITY_INTELLIGENCE_CONSUMER_ENABLED === "true" ||
			env.NIGHTWORKERS_SECURITY_INTELLIGENCE_CONSUMER_ENABLED === "1",
		projectAllowlist: new Set(
			(env.NIGHTWORKERS_SECURITY_INTELLIGENCE_PROJECT_ALLOWLIST ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		),
	};
}

export async function bindPreImplementationAssessment(input: {
	repositoryId: string;
	taskId: string;
	taskRevisionSnapshotId: string;
	assessmentReceiptRef: string;
	expectedRepositoryIdentityRevision: number;
	expectedBaseWorktreeId: string;
	expectedBaseHeadSha: string;
}) {
	assertSecurityIntelligenceConsumerAvailable(input.repositoryId);
	const [row] = await db
		.select({
			receipt: securityAssessmentReceipts,
			task: tasks,
			snapshot: taskRevisionSnapshots,
			repository: repositories,
		})
		.from(securityAssessmentReceipts)
		.innerJoin(
			tasks,
			and(
				eq(tasks.id, input.taskId),
				eq(tasks.repositoryId, input.repositoryId),
			),
		)
		.innerJoin(
			taskRevisionSnapshots,
			and(
				eq(taskRevisionSnapshots.id, input.taskRevisionSnapshotId),
				eq(taskRevisionSnapshots.taskId, tasks.id),
			),
		)
		.innerJoin(repositories, eq(repositories.id, input.repositoryId))
		.where(
			and(
				eq(securityAssessmentReceipts.receiptRef, input.assessmentReceiptRef),
				eq(securityAssessmentReceipts.repositoryId, input.repositoryId),
			),
		)
		.limit(1);
	if (!row) {
		throw new AppError(
			404,
			"SECURITY_ASSESSMENT_RECEIPT_NOT_FOUND",
			"assessment receiptまたはTask Revision Snapshotが見つかりません。",
		);
	}
	const normalizedTarget = row.receipt.normalizedTargetJson as {
		baseRevision?: string;
	};
	if (
		row.task.currentRevisionSnapshotId !== input.taskRevisionSnapshotId ||
		row.repository.repositoryIdentityRevision !==
			input.expectedRepositoryIdentityRevision ||
		row.repository.baseWorktreeId !== input.expectedBaseWorktreeId ||
		row.repository.baseWorktreeHeadSha !== input.expectedBaseHeadSha ||
		normalizedTarget.baseRevision !== input.expectedBaseHeadSha
	) {
		throw new AppError(
			409,
			"SECURITY_PRE_ASSESSMENT_SUBJECT_STALE",
			"pre assessmentのTaskまたはrepository identityがcurrentではありません。",
		);
	}
	const binding = deriveSecurityAssessmentSubjectBindingV1({
		version: 1,
		phase: "pre_implementation",
		assessmentReceiptRef: row.receipt.receiptRef,
		taskId: row.task.id,
		taskRevisionSnapshotId: row.snapshot.id,
		taskRevision: row.snapshot.revision,
		taskDigest: row.snapshot.digest,
		repositoryIdentityRevision: input.expectedRepositoryIdentityRevision,
		repositoryBaseWorktreeId: input.expectedBaseWorktreeId,
		expectedBaseHeadSha: input.expectedBaseHeadSha,
		createdAt: new Date().toISOString(),
	});
	const existing = await db
		.select()
		.from(securityAssessmentSubjectBindings)
		.where(
			and(
				eq(
					securityAssessmentSubjectBindings.taskRevisionSnapshotId,
					input.taskRevisionSnapshotId,
				),
				eq(securityAssessmentSubjectBindings.phase, "pre_implementation"),
				eq(
					securityAssessmentSubjectBindings.assessmentReceiptId,
					row.receipt.id,
				),
			),
		)
		.limit(1);
	if (existing[0]) {
		if (existing[0].bindingDigest !== binding.bindingDigest) {
			throw new AppError(
				409,
				"SECURITY_PRE_ASSESSMENT_BINDING_CONFLICT",
				"既存pre assessment bindingとidentityが一致しません。",
			);
		}
		return binding;
	}
	await saveSubjectBinding({ binding, assessmentReceiptId: row.receipt.id });
	return binding;
}

export function assertSecurityIntelligenceConsumerAvailable(
	repositoryId: string,
) {
	const configuration = securityIntelligenceConsumerConfiguration();
	if (!configuration.enabled) {
		throw new AppError(
			503,
			"SECURITY_INTELLIGENCE_CONSUMER_DISABLED",
			"Security Intelligence consumer は無効です。",
		);
	}
	if (!configuration.projectAllowlist.has(repositoryId)) {
		throw new AppError(
			403,
			"SECURITY_INTELLIGENCE_PROJECT_NOT_ALLOWED",
			"このProjectはSecurity Intelligence consumerのallowlistに含まれていません。",
		);
	}
}

export async function receiveSecurityIntelligenceAssessment(input: {
	repositoryId: string;
	scanRunRef: string;
}) {
	assertSecurityIntelligenceConsumerAvailable(input.repositoryId);
	const durable = await findProviderScanBinding(input.scanRunRef);
	if (!durable || durable.binding.repositoryId !== input.repositoryId) {
		throw new AppError(
			409,
			"SECURITY_INTELLIGENCE_DURABLE_BINDING_REQUIRED",
			"legacy scan bindingはSecurity Intelligence assessmentに使用できません。",
		);
	}
	if (durable.binding.resolvedTarget.kind !== "working_tree") {
		throw new AppError(
			422,
			"SECURITY_INTELLIGENCE_TARGET_UNSUPPORTED",
			"このscan targetはSecurity Intelligence assessmentの対象外です。",
		);
	}
	const capabilities = await securityIntelligenceCapabilities();
	if (
		capabilities.identityMappingVersion !==
			durable.binding.identityMappingVersion ||
		!capabilities.supportedTargetKinds.includes("working_tree") ||
		!capabilities.supportedTransports.includes("http_service")
	) {
		throw new AppError(
			409,
			"SECURITY_INTELLIGENCE_CAPABILITY_MISMATCH",
			"producer capabilityが保存済みscan bindingと一致しません。",
		);
	}
	const [proof, assessment] = await Promise.all([
		securityIntelligenceBindingProof(input.scanRunRef),
		securityIntelligenceAssessment(
			input.scanRunRef,
			Math.min(capabilities.maxResponseBytes, 2 * 1024 * 1024),
		),
	]);
	let verified: ReturnType<typeof verifySecurityIntelligenceDurableBinding>;
	try {
		verified = verifySecurityIntelligenceDurableBinding({
			binding: durable.binding,
			bindingProof: proof,
			assessmentBundle: assessment,
		});
	} catch (error) {
		throw new AppError(
			409,
			"SECURITY_INTELLIGENCE_IDENTITY_MISMATCH",
			"scan binding、binding proof、assessmentのidentityが一致しません。",
			{
				reason:
					error instanceof Error
						? error.message
						: "security_intelligence:unknown_identity_failure",
			},
		);
	}
	const receipt = deriveSecurityAssessmentReceiptV1({
		repositoryId: input.repositoryId,
		scanBindingRef: durable.binding.bindingRef,
		providerBindingProofRef: verified.bindingProof.proofRef,
		providerBindingProofDigest: verified.bindingProof.proofDigest,
		providerProjectRef: durable.binding.providerProjectRef,
		scanRunRef: durable.binding.scanRunRef,
		canonicalProjectRef: verified.bindingProof.canonicalProjectRef,
		canonicalScanRunRef: verified.bindingProof.canonicalScanRunRef,
		normalizedTarget: verified.normalizedTarget,
		payload: verified.assessmentBundle,
		receivedAt: new Date().toISOString(),
	});
	return saveAssessmentReceipt({
		receipt,
		scanBindingId: durable.id,
	});
}
