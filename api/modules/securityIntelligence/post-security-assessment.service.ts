import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	deriveProviderScanBindingV2,
	deriveSecurityAssessmentSubjectBindingV1,
	parseProviderWorkspaceTargetGrantV1,
	requestPostSecurityAssessmentCommandV1Schema,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { canonicalStringifySecurityIntelligenceValue } from "../../../shared/security-intelligence-assessment-contract";
import { db } from "../../db/client";
import { taskRevisionSnapshots } from "../../db/schema-base";
import { taskRuns } from "../../db/schema-task-runs";
import { taskGitWorkspaces } from "../../db/schema-workspace-authority";
import {
	securityAssessmentAttempts,
	securityAssessmentSubjectBindings,
} from "../../db/security-intelligence-schema";
import { AppError } from "../../lib/errors";
import {
	captureWorkspaceSourceSnapshot,
	workspaceHasSourceChanges,
} from "../../services/workspace/workspace-source-snapshot";
import { bindEvidenceSubject } from "../evidenceLedger/evidence-ledger.service";
import {
	getCurrentSecurityContract,
	saveAssessmentAttempt,
	saveProviderScanBinding,
	saveSubjectBinding,
} from "./security-intelligence.repository";
import {
	assertSecurityIntelligenceConsumerAvailable,
	receiveSecurityIntelligenceAssessment,
} from "./security-intelligence-assessment.service";
import {
	createSecurityIntelligenceWorkspaceGrant,
	previewSecurityIntelligenceWorkspaceGrant,
	securityIntelligenceCapabilities,
	startSecurityIntelligenceWorkspaceGrantScan,
} from "./security-intelligence-provider.client";

function digest(value: unknown) {
	return `sha256:${createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(value))
		.digest("hex")}`;
}

function uuidFromDigest(value: string) {
	const hex = value
		.replace(/^sha256:/, "")
		.slice(0, 32)
		.split("");
	hex[12] = "4";
	hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
	const raw = hex.join("");
	return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export function postSecurityAssessmentConfiguration(
	env: NodeJS.ProcessEnv = process.env,
) {
	return {
		enabled:
			env.NIGHTWORKERS_SECURITY_INTELLIGENCE_POST_ASSESSMENT_ENABLED ===
				"true" ||
			env.NIGHTWORKERS_SECURITY_INTELLIGENCE_POST_ASSESSMENT_ENABLED === "1",
	};
}

export async function requestPostSecurityAssessment(rawInput: unknown) {
	const input = requestPostSecurityAssessmentCommandV1Schema.parse(rawInput);
	const [subject] = await db
		.select({
			run: taskRuns,
			snapshot: taskRevisionSnapshots,
			workspace: taskGitWorkspaces,
		})
		.from(taskRuns)
		.innerJoin(
			taskRevisionSnapshots,
			eq(taskRevisionSnapshots.id, taskRuns.taskRevisionSnapshotId),
		)
		.innerJoin(
			taskGitWorkspaces,
			eq(taskGitWorkspaces.id, taskRuns.workspaceId),
		)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	if (!subject) {
		throw new AppError(
			404,
			"SECURITY_POST_ASSESSMENT_RUN_NOT_FOUND",
			"Runまたはauthoritative workspaceが見つかりません。",
		);
	}
	const { run, workspace, snapshot } = subject;
	if (
		run.taskRevisionSnapshotId !== input.expectedTaskRevisionSnapshotId ||
		snapshot.id !== input.expectedTaskRevisionSnapshotId ||
		run.workspaceId !== input.expectedWorkspaceId ||
		run.workspaceAllocationVersion !==
			input.expectedWorkspaceAllocationVersion ||
		workspace.id !== input.expectedWorkspaceId ||
		workspace.allocationVersion !== input.expectedWorkspaceAllocationVersion ||
		workspace.taskId !== run.taskId ||
		workspace.repositoryId !== run.repositoryId ||
		!workspace.taskWorktreePathCanonical ||
		!workspace.gitCommonDirDigest ||
		!run.admittedHeadSha
	) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_WORKSPACE_CONFLICT",
			"Runのworkspace allocationまたはTask revisionがcurrentではありません。",
		);
	}
	const before = await captureWorkspaceSourceSnapshot(
		workspace.taskWorktreePathCanonical,
	);
	if (before.gitHead !== run.admittedHeadSha) {
		throw new AppError(
			409,
			"SECURITY_POST_ASSESSMENT_HEAD_DRIFT",
			"workspace HEADがRun admissionから変化しています。",
		);
	}
	const currentContract = await getCurrentSecurityContract(snapshot.id);
	const requestDigest = digest({
		version: 1,
		runId: run.id,
		taskRevisionSnapshotId: snapshot.id,
		workspaceId: workspace.id,
		workspaceAllocationVersion: workspace.allocationVersion,
		sourceStateHash: before.sourceStateHash,
		securityContractRef: currentContract?.contract.contractRef ?? null,
		securityContractDigest: currentContract?.contract.contractDigest ?? null,
		selection: input.selection,
	});
	const attemptRef = `siat:v1:${requestDigest.slice("sha256:".length)}`;
	const [existingAttempt] = await db
		.select()
		.from(securityAssessmentAttempts)
		.where(eq(securityAssessmentAttempts.requestDigest, requestDigest))
		.limit(1);
	if (existingAttempt?.status === "completed") {
		const [existingBinding] = await db
			.select()
			.from(securityAssessmentSubjectBindings)
			.where(
				and(
					eq(securityAssessmentSubjectBindings.implementationRunId, run.id),
					eq(
						securityAssessmentSubjectBindings.assessmentReceiptId,
						existingAttempt.assessmentReceiptId ?? "",
					),
					eq(securityAssessmentSubjectBindings.phase, "post_implementation"),
				),
			)
			.limit(1);
		if (!existingBinding) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_REPLAY_INTEGRITY_CONFLICT",
				"completed assessment attemptのsubject bindingが見つかりません。",
			);
		}
		return {
			status: "completed" as const,
			assessmentAttemptRef: existingAttempt.attemptRef,
			assessmentSubjectBindingRef: existingBinding.bindingRef,
		};
	}
	if (existingAttempt?.status === "not_applicable") {
		return {
			status: "not_applicable" as const,
			assessmentAttemptRef: existingAttempt.attemptRef,
			reasonCode: existingAttempt.reasonCode ?? "workspace_source_unchanged",
		};
	}
	if (!postSecurityAssessmentConfiguration().enabled) {
		const reasonCode = "SECURITY_POST_ASSESSMENT_DISABLED";
		await saveAssessmentAttempt({
			attemptRef,
			requestDigest,
			phase: "post_implementation",
			repositoryId: run.repositoryId as string,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			implementationRunId: run.id,
			status: "unavailable",
			reasonCode,
			retryable: false,
		});
		return {
			status: "unavailable" as const,
			assessmentAttemptRef: attemptRef,
			reasonCode,
			retryable: false,
		};
	}
	let hasSourceChanges: boolean;
	try {
		hasSourceChanges = await workspaceHasSourceChanges(
			workspace.taskWorktreePathCanonical,
		);
	} catch {
		const reasonCode = "SECURITY_POST_ASSESSMENT_WORKSPACE_STATE_UNAVAILABLE";
		await saveAssessmentAttempt({
			attemptRef,
			requestDigest,
			phase: "post_implementation",
			repositoryId: run.repositoryId as string,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			implementationRunId: run.id,
			status: "unavailable",
			reasonCode,
			retryable: true,
		});
		return {
			status: "unavailable" as const,
			assessmentAttemptRef: attemptRef,
			reasonCode,
			retryable: true,
		};
	}
	if (!hasSourceChanges) {
		const reasonCode = "workspace_source_unchanged";
		await saveAssessmentAttempt({
			attemptRef,
			requestDigest,
			phase: "post_implementation",
			repositoryId: run.repositoryId as string,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			implementationRunId: run.id,
			status: "not_applicable",
			reasonCode,
			retryable: false,
		});
		return {
			status: "not_applicable" as const,
			assessmentAttemptRef: attemptRef,
			reasonCode,
		};
	}
	let scanBindingId: string | undefined;
	try {
		if (!currentContract) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_CONTRACT_REQUIRED",
				"post assessmentにはcurrent Security Contractが必要です。",
			);
		}
		const [preBinding] = await db
			.select()
			.from(securityAssessmentSubjectBindings)
			.where(
				and(
					eq(
						securityAssessmentSubjectBindings.bindingRef,
						currentContract.contract.sourceState.assessmentSubjectBindingRef,
					),
					eq(
						securityAssessmentSubjectBindings.taskRevisionSnapshotId,
						snapshot.id,
					),
					eq(securityAssessmentSubjectBindings.taskId, run.taskId),
					eq(securityAssessmentSubjectBindings.phase, "pre_implementation"),
				),
			)
			.limit(1);
		if (!preBinding) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_CONTRACT_BINDING_MISSING",
				"current Security Contractのpre assessment bindingが見つかりません。",
			);
		}
		const preReceipt = await db.query.securityAssessmentReceipts.findFirst({
			where: (table, operators) =>
				operators.eq(table.id, preBinding.assessmentReceiptId),
		});
		if (!preReceipt) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_PRE_RECEIPT_MISSING",
				"pre assessment receiptが見つかりません。",
			);
		}
		assertSecurityIntelligenceConsumerAvailable(run.repositoryId as string);
		const evidenceSubject = await bindEvidenceSubject({
			taskId: run.taskId,
			runId: run.id,
			sourceStateHash: before.sourceStateHash,
		});
		if (!evidenceSubject) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_EVIDENCE_SUBJECT_UNAVAILABLE",
				"canonical Evidence Subject Snapshotを作成できません。",
			);
		}
		const capabilities = await securityIntelligenceCapabilities();
		if (!capabilities.workspaceTargetGrant.available) {
			throw new AppError(
				503,
				"SECURITY_POST_ASSESSMENT_GRANT_UNAVAILABLE",
				"producer workspace target grantが利用できません。",
			);
		}
		const grant = parseProviderWorkspaceTargetGrantV1(
			await createSecurityIntelligenceWorkspaceGrant({
				version: 1,
				providerProjectRef: preReceipt.providerProjectRef,
				workspaceSubjectRef: `evidence-subject:${evidenceSubject.id}`,
				workspacePath: workspace.taskWorktreePathCanonical,
				expectedGitCommonDirDigest: workspace.gitCommonDirDigest,
				expectedHeadSha: run.admittedHeadSha,
			}),
		);
		const preview = await previewSecurityIntelligenceWorkspaceGrant(
			grant.grantRef,
			input.selection,
		);
		if (
			preview.target.providerWorkspaceStateDigest !==
				grant.providerWorkspaceStateDigest ||
			preview.target.baseRevision !== run.admittedHeadSha
		) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_PREVIEW_CONFLICT",
				"grantとpreviewのworkspace identityが一致しません。",
			);
		}
		const started = await startSecurityIntelligenceWorkspaceGrantScan({
			grantRef: grant.grantRef,
			previewRef: preview.previewRef,
			selection: input.selection,
			expectedTargetDigest: preview.target.digest,
			idempotencyKey: uuidFromDigest(requestDigest),
		});
		if (
			started.grantRef !== grant.grantRef ||
			started.target.digest !== preview.target.digest ||
			started.target.sourceRevision !== run.admittedHeadSha ||
			started.target.providerWorkspaceStateDigest !==
				grant.providerWorkspaceStateDigest
		) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_START_CONFLICT",
				"grant、preview、scan startのidentityが一致しません。",
			);
		}
		const savedBinding = await saveProviderScanBinding(
			deriveProviderScanBindingV2({
				version: 2,
				repositoryId: run.repositoryId as string,
				provider: "vulnworkbench",
				identityMappingVersion: capabilities.identityMappingVersion,
				providerProjectRef: grant.providerProjectRef,
				scanRunRef: started.scanRunRef,
				selection: input.selection,
				requestedTarget: { kind: "working_tree" },
				resolvedTarget: {
					kind: "working_tree",
					sourceRevisionRole: "base_revision",
					sourceRevision: started.target.sourceRevision,
					targetDigest: started.target.digest,
				},
				createdAt: started.createdAt,
			}),
		);
		scanBindingId = savedBinding.id;
		const received = await receiveSecurityIntelligenceAssessment({
			repositoryId: run.repositoryId as string,
			scanRunRef: started.scanRunRef,
		});
		const after = await captureWorkspaceSourceSnapshot(
			workspace.taskWorktreePathCanonical,
		);
		const [currentRows, contractAfterAssessment] = await Promise.all([
			db
				.select({ run: taskRuns, workspace: taskGitWorkspaces })
				.from(taskRuns)
				.innerJoin(
					taskGitWorkspaces,
					eq(taskGitWorkspaces.id, taskRuns.workspaceId),
				)
				.where(eq(taskRuns.id, run.id))
				.limit(1),
			getCurrentSecurityContract(snapshot.id),
		]);
		const [current] = currentRows;
		if (
			!current ||
			current.run.workspaceId !== workspace.id ||
			current.run.workspaceAllocationVersion !== workspace.allocationVersion ||
			current.workspace.allocationVersion !== workspace.allocationVersion ||
			after.gitHead !== before.gitHead ||
			after.sourceStateHash !== before.sourceStateHash
		) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_WORKSPACE_DRIFT",
				"assessment実行中にworkspace stateが変化しました。",
			);
		}
		if (
			contractAfterAssessment?.contract.contractRef !==
			currentContract.contract.contractRef
		) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_CONTRACT_DRIFT",
				"assessment実行中にSecurity Contract headが変化しました。",
			);
		}
		const subjectBinding = deriveSecurityAssessmentSubjectBindingV1({
			version: 1,
			phase: "post_implementation",
			assessmentReceiptRef: received.receipt.receiptRef,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			taskRevision: snapshot.revision,
			taskDigest: snapshot.digest,
			implementationRunId: run.id,
			evidenceSubjectSnapshotId: evidenceSubject.id,
			providerWorkspaceTargetGrantRef: grant.grantRef,
			providerWorkspaceTargetGrantDigest: grant.grantDigest,
			providerWorkspaceStateDigest: grant.providerWorkspaceStateDigest,
			workspaceId: workspace.id,
			workspaceAllocationVersion: workspace.allocationVersion,
			admittedHeadSha: run.admittedHeadSha,
			sourceStateHash: before.sourceStateHash,
			diffDigest: evidenceSubject.diffDigest,
			createdAt: new Date().toISOString(),
		});
		await saveSubjectBinding({
			binding: subjectBinding,
			assessmentReceiptId: received.id,
		});
		await saveAssessmentAttempt({
			attemptRef,
			requestDigest,
			phase: "post_implementation",
			repositoryId: run.repositoryId as string,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			implementationRunId: run.id,
			status: "completed",
			retryable: false,
			scanBindingId,
			assessmentReceiptId: received.id,
		});
		return {
			status: "completed" as const,
			assessmentAttemptRef: attemptRef,
			assessmentSubjectBindingRef: subjectBinding.bindingRef,
		};
	} catch (error) {
		const appError = error instanceof AppError ? error : null;
		const retryable = appError?.details?.retryable === true;
		const reasonCode = appError?.code ?? "SECURITY_POST_ASSESSMENT_UNAVAILABLE";
		await saveAssessmentAttempt({
			attemptRef,
			requestDigest,
			phase: "post_implementation",
			repositoryId: run.repositoryId as string,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			implementationRunId: run.id,
			status: "unavailable",
			reasonCode,
			retryable,
			scanBindingId,
		});
		if (
			appError &&
			(appError.statusCode === 409 || appError.statusCode === 422)
		) {
			throw appError;
		}
		return {
			status: "unavailable" as const,
			assessmentAttemptRef: attemptRef,
			reasonCode,
			retryable,
		};
	}
}
