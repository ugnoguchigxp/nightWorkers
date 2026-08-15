import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { evidenceSubjectSnapshots } from "./evidence-ledger-schema";
import {
	commonColumns,
	repositories,
	taskRevisionSnapshots,
	tasks,
} from "./schema-base";
import { taskRuns } from "./schema-task-runs";
import { taskGitWorkspaces } from "./schema-workspace-authority";

export const securityScanBindings = sqliteTable(
	"security_scan_bindings",
	{
		...commonColumns,
		version: integer("version").default(2).notNull(),
		bindingRef: text("binding_ref").notNull(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		provider: text("provider").default("vulnworkbench").notNull(),
		identityMappingVersion: integer("identity_mapping_version")
			.default(1)
			.notNull(),
		providerProjectRef: text("provider_project_ref").notNull(),
		scanRunRef: text("scan_run_ref").notNull(),
		selectionJson: text("selection_json", { mode: "json" }).notNull(),
		requestedTargetJson: text("requested_target_json", {
			mode: "json",
		}).notNull(),
		resolvedTargetKind: text("resolved_target_kind").notNull(),
		sourceRevisionRole: text("source_revision_role").notNull(),
		sourceRevision: text("source_revision"),
		targetDigest: text("target_digest").notNull(),
		bindingDigest: text("binding_digest").notNull(),
	},
	(table) => ({
		bindingRefUidx: uniqueIndex("security_scan_bindings_ref_uidx").on(
			table.bindingRef,
		),
		scanRunRefUidx: uniqueIndex("security_scan_bindings_scan_run_ref_uidx").on(
			table.scanRunRef,
		),
		bindingDigestUidx: uniqueIndex("security_scan_bindings_digest_uidx").on(
			table.bindingDigest,
		),
		repositoryCreatedIdx: index(
			"security_scan_bindings_repository_created_idx",
		).on(table.repositoryId, table.createdAt),
	}),
);

export const securityAssessmentReceipts = sqliteTable(
	"security_assessment_receipts",
	{
		...commonColumns,
		version: integer("version").default(1).notNull(),
		receiptRef: text("receipt_ref").notNull(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		scanBindingId: text("scan_binding_id")
			.notNull()
			.references(() => securityScanBindings.id, { onDelete: "restrict" }),
		providerBindingProofRef: text("provider_binding_proof_ref").notNull(),
		providerBindingProofDigest: text("provider_binding_proof_digest").notNull(),
		providerProjectRef: text("provider_project_ref").notNull(),
		scanRunRef: text("scan_run_ref").notNull(),
		canonicalProjectRef: text("canonical_project_ref").notNull(),
		canonicalScanRunRef: text("canonical_scan_run_ref").notNull(),
		normalizedTargetJson: text("normalized_target_json", {
			mode: "json",
		}).notNull(),
		producerContractVersion: integer("producer_contract_version").notNull(),
		bundleRef: text("bundle_ref").notNull(),
		assessmentRefsJson: text("assessment_refs_json", { mode: "json" })
			.$type<string[]>()
			.notNull(),
		payloadDigest: text("payload_digest").notNull(),
		payloadJson: text("payload_json", { mode: "json" }).notNull(),
		receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		receiptRefUidx: uniqueIndex("security_assessment_receipts_ref_uidx").on(
			table.receiptRef,
		),
		bundleRefUidx: uniqueIndex(
			"security_assessment_receipts_bundle_ref_uidx",
		).on(table.bundleRef),
		payloadDigestUidx: uniqueIndex(
			"security_assessment_receipts_payload_digest_uidx",
		).on(table.payloadDigest),
		scanBindingIdx: index("security_assessment_receipts_scan_binding_idx").on(
			table.scanBindingId,
			table.receivedAt,
		),
	}),
);

export const securityAssessmentAttempts = sqliteTable(
	"security_assessment_attempts",
	{
		...commonColumns,
		attemptRef: text("attempt_ref").notNull(),
		requestDigest: text("request_digest").notNull(),
		phase: text("phase").notNull(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		implementationRunId: text("implementation_run_id").references(
			() => taskRuns.id,
			{ onDelete: "cascade" },
		),
		status: text("status").notNull(),
		reasonCode: text("reason_code"),
		retryable: integer("retryable", { mode: "boolean" })
			.default(false)
			.notNull(),
		executionContextJson: text("execution_context_json", { mode: "json" }),
		scanBindingId: text("scan_binding_id").references(
			() => securityScanBindings.id,
			{ onDelete: "set null" },
		),
		assessmentReceiptId: text("assessment_receipt_id").references(
			() => securityAssessmentReceipts.id,
			{ onDelete: "set null" },
		),
	},
	(table) => ({
		attemptRefUidx: uniqueIndex("security_assessment_attempts_ref_uidx").on(
			table.attemptRef,
		),
		requestDigestUidx: uniqueIndex(
			"security_assessment_attempts_request_digest_uidx",
		).on(table.requestDigest),
		runPhaseIdx: index("security_assessment_attempts_run_phase_idx").on(
			table.implementationRunId,
			table.phase,
		),
	}),
);

export const securityAssessmentSubjectBindings = sqliteTable(
	"security_assessment_subject_bindings",
	{
		...commonColumns,
		version: integer("version").default(1).notNull(),
		bindingRef: text("binding_ref").notNull(),
		bindingDigest: text("binding_digest").notNull(),
		phase: text("phase").notNull(),
		assessmentReceiptId: text("assessment_receipt_id")
			.notNull()
			.references(() => securityAssessmentReceipts.id, {
				onDelete: "restrict",
			}),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		taskRevision: integer("task_revision").notNull(),
		taskDigest: text("task_digest").notNull(),
		repositoryIdentityRevision: integer("repository_identity_revision"),
		repositoryBaseWorktreeId: text("repository_base_worktree_id"),
		expectedBaseHeadSha: text("expected_base_head_sha"),
		implementationRunId: text("implementation_run_id").references(
			() => taskRuns.id,
			{ onDelete: "cascade" },
		),
		evidenceSubjectSnapshotId: text("evidence_subject_snapshot_id").references(
			() => evidenceSubjectSnapshots.id,
			{ onDelete: "restrict" },
		),
		providerWorkspaceTargetGrantRef: text(
			"provider_workspace_target_grant_ref",
		),
		providerWorkspaceTargetGrantDigest: text(
			"provider_workspace_target_grant_digest",
		),
		providerWorkspaceStateDigest: text("provider_workspace_state_digest"),
		workspaceId: text("workspace_id").references(() => taskGitWorkspaces.id, {
			onDelete: "restrict",
		}),
		workspaceAllocationVersion: integer("workspace_allocation_version"),
		admittedHeadSha: text("admitted_head_sha"),
		sourceStateHash: text("source_state_hash"),
		diffDigest: text("diff_digest"),
	},
	(table) => ({
		bindingRefUidx: uniqueIndex(
			"security_assessment_subject_bindings_ref_uidx",
		).on(table.bindingRef),
		bindingDigestUidx: uniqueIndex(
			"security_assessment_subject_bindings_digest_uidx",
		).on(table.bindingDigest),
		receiptPhaseIdx: index(
			"security_assessment_subject_bindings_receipt_phase_idx",
		).on(table.assessmentReceiptId, table.phase),
		runPhaseIdx: index("security_assessment_subject_bindings_run_phase_idx").on(
			table.implementationRunId,
			table.phase,
		),
	}),
);

export const securityContracts = sqliteTable(
	"security_contracts",
	{
		...commonColumns,
		version: integer("version").default(1).notNull(),
		contractRef: text("contract_ref").notNull(),
		contractRevision: integer("contract_revision").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		taskRevision: integer("task_revision").notNull(),
		taskDigest: text("task_digest").notNull(),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		payloadJson: text("payload_json", { mode: "json" }).notNull(),
		supersedesContractRef: text("supersedes_contract_ref"),
		contractDigest: text("contract_digest").notNull(),
		authorPrincipalRef: text("author_principal_ref").notNull(),
	},
	(table) => ({
		contractRefUidx: uniqueIndex("security_contracts_ref_uidx").on(
			table.contractRef,
		),
		contractDigestUidx: uniqueIndex("security_contracts_digest_uidx").on(
			table.contractDigest,
		),
		supersedesUidx: uniqueIndex("security_contracts_supersedes_uidx").on(
			table.supersedesContractRef,
		),
		snapshotRevisionUidx: uniqueIndex(
			"security_contracts_snapshot_revision_uidx",
		).on(table.taskRevisionSnapshotId, table.contractRevision),
	}),
);

export const securityContractHeads = sqliteTable("security_contract_heads", {
	taskRevisionSnapshotId: text("task_revision_snapshot_id")
		.primaryKey()
		.references(() => taskRevisionSnapshots.id, { onDelete: "cascade" }),
	currentContractRef: text("current_contract_ref").notNull(),
	headRevision: integer("head_revision").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const taskCompletionConditions = sqliteTable(
	"task_completion_conditions",
	{
		...commonColumns,
		conditionRef: text("condition_ref").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		taskRevision: integer("task_revision").notNull(),
		taskDigest: text("task_digest").notNull(),
		conditionRevision: integer("condition_revision").notNull(),
		conditionKey: text("condition_key").notNull(),
		state: text("state").notNull(),
		sourceJson: text("source_json", { mode: "json" }).notNull(),
		subjectRef: text("subject_ref").notNull(),
		supersedesConditionRef: text("supersedes_condition_ref"),
		conditionDigest: text("condition_digest").notNull(),
		recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull(),
		authorPrincipalRef: text("author_principal_ref").notNull(),
	},
	(table) => ({
		conditionRefUidx: uniqueIndex("task_completion_conditions_ref_uidx").on(
			table.conditionRef,
		),
		conditionDigestUidx: uniqueIndex(
			"task_completion_conditions_digest_uidx",
		).on(table.conditionDigest),
		supersedesUidx: uniqueIndex(
			"task_completion_conditions_supersedes_uidx",
		).on(table.supersedesConditionRef),
		snapshotKeyRevisionUidx: uniqueIndex(
			"task_completion_conditions_snapshot_key_revision_uidx",
		).on(
			table.taskRevisionSnapshotId,
			table.conditionKey,
			table.conditionRevision,
		),
	}),
);

export const taskCompletionConditionHeads = sqliteTable(
	"task_completion_condition_heads",
	{
		...commonColumns,
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "cascade" }),
		conditionKey: text("condition_key").notNull(),
		currentConditionRef: text("current_condition_ref").notNull(),
		headRevision: integer("head_revision").notNull(),
	},
	(table) => ({
		snapshotKeyUidx: uniqueIndex(
			"task_completion_condition_heads_snapshot_key_uidx",
		).on(table.taskRevisionSnapshotId, table.conditionKey),
	}),
);

export const securityFinalJudgments = sqliteTable(
	"security_final_judgments",
	{
		...commonColumns,
		judgmentRef: text("judgment_ref").notNull(),
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		taskRevisionSnapshotId: text("task_revision_snapshot_id")
			.notNull()
			.references(() => taskRevisionSnapshots.id, { onDelete: "restrict" }),
		securityContractRef: text("security_contract_ref").notNull(),
		securityContractDigest: text("security_contract_digest").notNull(),
		judgmentDigest: text("judgment_digest").notNull(),
		payloadJson: text("payload_json", { mode: "json" }).notNull(),
	},
	(table) => ({
		judgmentRefUidx: uniqueIndex("security_final_judgments_ref_uidx").on(
			table.judgmentRef,
		),
		runUidx: uniqueIndex("security_final_judgments_run_uidx").on(table.runId),
		judgmentDigestUidx: uniqueIndex("security_final_judgments_digest_uidx").on(
			table.judgmentDigest,
		),
	}),
);

function securityOutboxColumns() {
	return {
		...commonColumns,
		producerPrincipalRef: text("producer_principal_ref").notNull(),
		endpoint: text("endpoint").notNull(),
		contractVersion: integer("contract_version").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		batchRef: text("batch_ref").notNull(),
		batchPayloadDigest: text("batch_payload_digest").notNull(),
		payloadJson: text("payload_json", { mode: "json" }).notNull(),
		status: text("status").default("pending").notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
		lastErrorCode: text("last_error_code"),
		lastErrorMessage: text("last_error_message"),
	};
}

export const securityKnowledgeCandidateOutbox = sqliteTable(
	"security_knowledge_candidate_outbox",
	securityOutboxColumns(),
	(table) => ({
		idempotencyUidx: uniqueIndex(
			"security_knowledge_candidate_outbox_idempotency_uidx",
		).on(
			table.producerPrincipalRef,
			table.endpoint,
			table.contractVersion,
			table.idempotencyKey,
		),
		statusAttemptIdx: index(
			"security_knowledge_candidate_outbox_status_attempt_idx",
		).on(table.status, table.nextAttemptAt),
	}),
);

export const securityKnowledgeCandidateReceipts = sqliteTable(
	"security_knowledge_candidate_receipts",
	{
		...commonColumns,
		outboxId: text("outbox_id")
			.notNull()
			.references(() => securityKnowledgeCandidateOutbox.id, {
				onDelete: "cascade",
			}),
		receiptRef: text("receipt_ref").notNull(),
		responseJson: text("response_json", { mode: "json" }).notNull(),
	},
	(table) => ({
		outboxUidx: uniqueIndex(
			"security_knowledge_candidate_receipts_outbox_uidx",
		).on(table.outboxId),
		receiptRefUidx: uniqueIndex(
			"security_knowledge_candidate_receipts_ref_uidx",
		).on(table.receiptRef),
	}),
);

export const securityKnowledgeFeedbackOutbox = sqliteTable(
	"security_knowledge_feedback_outbox",
	securityOutboxColumns(),
	(table) => ({
		idempotencyUidx: uniqueIndex(
			"security_knowledge_feedback_outbox_idempotency_uidx",
		).on(
			table.producerPrincipalRef,
			table.endpoint,
			table.contractVersion,
			table.idempotencyKey,
		),
		statusAttemptIdx: index(
			"security_knowledge_feedback_outbox_status_attempt_idx",
		).on(table.status, table.nextAttemptAt),
	}),
);

export const securityKnowledgeFeedbackReceipts = sqliteTable(
	"security_knowledge_feedback_receipts",
	{
		...commonColumns,
		outboxId: text("outbox_id")
			.notNull()
			.references(() => securityKnowledgeFeedbackOutbox.id, {
				onDelete: "cascade",
			}),
		receiptRef: text("receipt_ref").notNull(),
		responseJson: text("response_json", { mode: "json" }).notNull(),
	},
	(table) => ({
		outboxUidx: uniqueIndex(
			"security_knowledge_feedback_receipts_outbox_uidx",
		).on(table.outboxId),
		receiptRefUidx: uniqueIndex(
			"security_knowledge_feedback_receipts_ref_uidx",
		).on(table.receiptRef),
	}),
);
