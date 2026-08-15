import { and, eq } from "drizzle-orm";
import {
	deriveProviderScanBindingV2,
	deriveSecurityAssessmentSubjectBindingV1,
	parseProviderWorkspaceTargetGrantV1,
	requestPostSecurityAssessmentCommandV1Schema,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { db } from "../../db/client";
import { taskRevisionSnapshots } from "../../db/schema-base";
import { taskRuns } from "../../db/schema-task-runs";
import { taskGitWorkspaces } from "../../db/schema-workspace-authority";
import {
	securityAssessmentAttempts,
	securityAssessmentSubjectBindings,
	securityScanBindings,
} from "../../db/security-intelligence-schema";
import { AppError } from "../../lib/errors";
import {
	captureWorkspaceSourceSnapshot,
	workspaceHasSourceChanges,
} from "../../services/workspace/workspace-source-snapshot";
import { bindEvidenceSubject } from "../evidenceLedger/evidence-ledger.service";
import {
	assertPostAssessmentCheckpointIdentity,
	assertPostAssessmentGrantProject,
	classifyPostAssessmentFailure,
	createPostAssessmentExecutionContext,
	derivePostAssessmentIdempotencyUuid,
	derivePostAssessmentRequestDigest,
	type PostAssessmentExecutionContext,
	parsePostAssessmentExecutionContext,
	postSecurityAssessmentConfiguration,
	shouldPropagatePostAssessmentFailure,
} from "./post-security-assessment-checkpoint";
import { resolveTerminalPostAssessmentAttempt } from "./post-security-assessment-replay";
import {
	claimPostAssessmentStart,
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

export {
	classifyPostAssessmentFailure,
	postSecurityAssessmentConfiguration,
	shouldPropagatePostAssessmentFailure,
};

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
	const requestDigest = derivePostAssessmentRequestDigest({
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
	if (existingAttempt) {
		const terminal = await resolveTerminalPostAssessmentAttempt(
			existingAttempt,
			run.id,
		);
		if (terminal) return terminal;
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
	const attemptIdentity = {
		attemptRef,
		requestDigest,
		phase: "post_implementation" as const,
		repositoryId: run.repositoryId as string,
		taskId: run.taskId,
		taskRevisionSnapshotId: snapshot.id,
		implementationRunId: run.id,
	};
	let scanBindingId = existingAttempt?.scanBindingId ?? undefined;
	let executionContext: PostAssessmentExecutionContext | undefined;
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
		executionContext = parsePostAssessmentExecutionContext(
			existingAttempt?.executionContextJson,
		);
		if (!executionContext) {
			const claim = await claimPostAssessmentStart(attemptIdentity);
			const terminal = await resolveTerminalPostAssessmentAttempt(
				claim.attempt,
				run.id,
			);
			if (terminal) return terminal;
			executionContext = parsePostAssessmentExecutionContext(
				claim.attempt.executionContextJson,
			);
			if (!claim.acquired && !executionContext) {
				return {
					status: "unavailable" as const,
					assessmentAttemptRef: attemptRef,
					reasonCode: "SECURITY_POST_ASSESSMENT_IN_PROGRESS",
					retryable: true,
				};
			}
		}
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
		assertPostAssessmentCheckpointIdentity({
			context: executionContext,
			evidenceSubjectSnapshotId: evidenceSubject.id,
			providerProjectRef: preReceipt.providerProjectRef,
		});
		if (!executionContext) {
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
			assertPostAssessmentGrantProject(
				grant.providerProjectRef,
				preReceipt.providerProjectRef,
			);
			executionContext = createPostAssessmentExecutionContext({
				version: 1,
				stage: "grant_created",
				evidenceSubjectSnapshotId: evidenceSubject.id,
				identityMappingVersion: capabilities.identityMappingVersion,
				providerProjectRef: grant.providerProjectRef,
				providerWorkspaceTargetGrantRef: grant.grantRef,
				providerWorkspaceTargetGrantDigest: grant.grantDigest,
				providerWorkspaceStateDigest: grant.providerWorkspaceStateDigest,
			});
			await saveAssessmentAttempt({
				...attemptIdentity,
				status: "unavailable",
				reasonCode: "SECURITY_POST_ASSESSMENT_GRANT_CREATED",
				retryable: true,
				executionContextJson: executionContext,
			});
		}
		if (executionContext.stage === "grant_created") {
			const preview = await previewSecurityIntelligenceWorkspaceGrant(
				executionContext.providerWorkspaceTargetGrantRef,
				input.selection,
			);
			if (
				preview.target.providerWorkspaceStateDigest !==
					executionContext.providerWorkspaceStateDigest ||
				preview.target.baseRevision !== run.admittedHeadSha
			) {
				throw new AppError(
					409,
					"SECURITY_POST_ASSESSMENT_PREVIEW_CONFLICT",
					"grantとpreviewのworkspace identityが一致しません。",
				);
			}
			executionContext = createPostAssessmentExecutionContext({
				...executionContext,
				stage: "previewed",
				previewRef: preview.previewRef,
				targetDigest: preview.target.digest,
				sourceRevision: preview.target.baseRevision,
			});
			await saveAssessmentAttempt({
				...attemptIdentity,
				status: "unavailable",
				reasonCode: "SECURITY_POST_ASSESSMENT_PREVIEWED",
				retryable: true,
				executionContextJson: executionContext,
			});
		}
		if (executionContext.stage === "previewed") {
			const started = await startSecurityIntelligenceWorkspaceGrantScan({
				grantRef: executionContext.providerWorkspaceTargetGrantRef,
				previewRef: executionContext.previewRef,
				selection: input.selection,
				expectedTargetDigest: executionContext.targetDigest,
				idempotencyKey: derivePostAssessmentIdempotencyUuid(requestDigest),
			});
			if (
				started.grantRef !== executionContext.providerWorkspaceTargetGrantRef ||
				started.target.digest !== executionContext.targetDigest ||
				started.target.sourceRevision !== executionContext.sourceRevision ||
				started.target.providerWorkspaceStateDigest !==
					executionContext.providerWorkspaceStateDigest
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
					identityMappingVersion: executionContext.identityMappingVersion,
					providerProjectRef: executionContext.providerProjectRef,
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
			executionContext = createPostAssessmentExecutionContext({
				...executionContext,
				stage: "started",
				scanRunRef: started.scanRunRef,
				scanBindingId,
			});
			await saveAssessmentAttempt({
				...attemptIdentity,
				status: "unavailable",
				reasonCode: "SECURITY_POST_ASSESSMENT_SCAN_STARTED",
				retryable: true,
				executionContextJson: executionContext,
				scanBindingId,
			});
		}
		if (executionContext.stage !== "started") {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_CHECKPOINT_INCOMPLETE",
				"post assessment checkpointがscan開始まで進んでいません。",
			);
		}
		const startedContext = executionContext;
		const [persistedScanBinding] = await db
			.select()
			.from(securityScanBindings)
			.where(eq(securityScanBindings.id, startedContext.scanBindingId))
			.limit(1);
		if (
			!persistedScanBinding ||
			persistedScanBinding.repositoryId !== run.repositoryId ||
			persistedScanBinding.provider !== "vulnworkbench" ||
			persistedScanBinding.identityMappingVersion !==
				startedContext.identityMappingVersion ||
			persistedScanBinding.providerProjectRef !==
				startedContext.providerProjectRef ||
			persistedScanBinding.scanRunRef !== startedContext.scanRunRef ||
			persistedScanBinding.resolvedTargetKind !== "working_tree" ||
			persistedScanBinding.sourceRevisionRole !== "base_revision" ||
			persistedScanBinding.targetDigest !== startedContext.targetDigest ||
			persistedScanBinding.sourceRevision !== startedContext.sourceRevision
		) {
			throw new AppError(
				409,
				"SECURITY_POST_ASSESSMENT_SCAN_CHECKPOINT_CONFLICT",
				"保存済みscan checkpointとscan bindingが一致しません。",
			);
		}
		scanBindingId = startedContext.scanBindingId;
		const received = await receiveSecurityIntelligenceAssessment({
			repositoryId: run.repositoryId as string,
			scanRunRef: startedContext.scanRunRef,
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
			providerWorkspaceTargetGrantRef:
				executionContext.providerWorkspaceTargetGrantRef,
			providerWorkspaceTargetGrantDigest:
				executionContext.providerWorkspaceTargetGrantDigest,
			providerWorkspaceStateDigest:
				executionContext.providerWorkspaceStateDigest,
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
			executionContextJson: executionContext,
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
		const disposition = classifyPostAssessmentFailure(
			error,
			executionContext?.stage,
		);
		if (disposition.resetPreStartCheckpoint) {
			executionContext = undefined;
			scanBindingId = undefined;
		}
		await saveAssessmentAttempt({
			attemptRef,
			requestDigest,
			phase: "post_implementation",
			repositoryId: run.repositoryId as string,
			taskId: run.taskId,
			taskRevisionSnapshotId: snapshot.id,
			implementationRunId: run.id,
			status: "unavailable",
			reasonCode: disposition.reasonCode,
			retryable: disposition.retryable,
			executionContextJson: disposition.resetPreStartCheckpoint
				? null
				: executionContext,
			scanBindingId,
		});
		if (disposition.propagate) {
			throw appError;
		}
		return {
			status: "unavailable" as const,
			assessmentAttemptRef: attemptRef,
			reasonCode: disposition.reasonCode,
			retryable: disposition.retryable,
		};
	}
}
