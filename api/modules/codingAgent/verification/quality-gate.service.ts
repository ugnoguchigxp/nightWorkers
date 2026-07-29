import { and, desc, eq } from "drizzle-orm";
import { workspaceSourceSnapshotSchema } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import { bindEvidenceSubject } from "../../evidenceLedger";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

export type QualityGateResult = {
	passed: boolean;
	sourceStateHash?: string;
	inventory: {
		status: "passed" | "failed" | "unknown";
		reason?: string;
		activeCaseCount: number;
	};
	testExecution: { status: "passed" | "failed" | "unknown"; reason?: string };
	fullVerify: { status: "passed" | "failed" | "unknown"; reason?: string };
	conditions: Array<{
		conditionId: string;
		required: boolean;
		status: "passed" | "failed" | "not_required";
		reason?: string;
	}>;
};

export async function evaluateQualityGate(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	repoRoot?: string;
}): Promise<QualityGateResult> {
	if (!input.repoRoot) return unknownGate("missing_repository_context");
	const current = await captureWorkspaceSourceSnapshot(input.repoRoot);
	const currentSubject = await bindEvidenceSubject({
		taskId: input.taskId,
		runId: input.runId,
		sourceStateHash: current.sourceStateHash,
		verificationDocumentId: input.verificationDocumentId,
	});
	if (!currentSubject) return unknownGate("evidence_subject_unavailable");
	const [document, inventories, evidence, checklist] = await Promise.all([
		db
			.select()
			.from(verificationDocuments)
			.where(eq(verificationDocuments.id, input.verificationDocumentId))
			.then((rows) => rows[0]),
		db
			.select()
			.from(codingAgentTestInventoryRuns)
			.where(
				and(
					eq(codingAgentTestInventoryRuns.taskId, input.taskId),
					eq(codingAgentTestInventoryRuns.runId, input.runId),
				),
			)
			.orderBy(desc(codingAgentTestInventoryRuns.createdAt)),
		db
			.select()
			.from(verificationEvidenceRuns)
			.where(
				and(
					eq(verificationEvidenceRuns.taskId, input.taskId),
					eq(verificationEvidenceRuns.runId, input.runId),
					eq(
						verificationEvidenceRuns.verificationDocumentId,
						input.verificationDocumentId,
					),
				),
			),
		db
			.select()
			.from(verificationChecklistItems)
			.where(
				eq(
					verificationChecklistItems.verificationDocumentId,
					input.verificationDocumentId,
				),
			),
	]);
	if (!document || document.taskId !== input.taskId)
		return unknownGate("missing_verification_document");
	const sameSnapshotInventories = inventories.filter(
		(inventory) =>
			snapshotHash(inventory.sourceSnapshotJson) === current.sourceStateHash,
	);
	const inventoryId = sameSnapshotInventories[0]?.id;
	const inventoryCases = inventoryId
		? await db
				.select()
				.from(codingAgentTestInventoryCases)
				.where(eq(codingAgentTestInventoryCases.inventoryId, inventoryId))
		: [];
	const activeCases = inventoryCases.filter(
		(testCase) => testCase.discoveryLevel === "active",
	);
	const matchingEvidence = evidence.filter(
		(item) =>
			item.subjectId === currentSubject.id &&
			snapshotHash(item.sourceSnapshotJson) === current.sourceStateHash &&
			!item.sourceMutatedDuringCheck,
	);
	const testExecution = matchingEvidence.some(
		(item) => item.testExecutionObserved && item.exitCode === 0,
	);
	const fullVerify = matchingEvidence.some(
		(item) => item.checkKind === "verify" && item.exitCode === 0,
	);
	const mappings = inventoryId
		? await db
				.select()
				.from(codingAgentTestConditionMappings)
				.where(
					and(
						eq(
							codingAgentTestConditionMappings.verificationDocumentId,
							input.verificationDocumentId,
						),
						eq(codingAgentTestConditionMappings.inventoryId, inventoryId),
					),
				)
		: [];
	const activeCaseKeys = new Set(
		activeCases.map((testCase) => testCase.caseKey),
	);
	const declaredByCondition = new Set(
		activeCases.flatMap((testCase) => testCase.declaredConditionIdsJson),
	);
	const mappedByCondition = new Set(
		mappings
			.filter((mapping) => activeCaseKeys.has(mapping.caseKey))
			.map((mapping) => mapping.conditionId),
	);
	const conditions = checklist.map((item) => {
		if (!item.required || item.verificationKind !== "automated_test") {
			return {
				conditionId: item.conditionId,
				required: item.required,
				status: "not_required" as const,
			};
		}
		if (
			!declaredByCondition.has(item.conditionId) &&
			!mappedByCondition.has(item.conditionId)
		) {
			return {
				conditionId: item.conditionId,
				required: true,
				status: "failed" as const,
				reason: "missing_test_definition_mapping",
			};
		}
		if (!testExecution) {
			return {
				conditionId: item.conditionId,
				required: true,
				status: "failed" as const,
				reason: "missing_successful_test_execution",
			};
		}
		return {
			conditionId: item.conditionId,
			required: true,
			status: "passed" as const,
		};
	});
	const inventoryStatus = activeCases.length ? "passed" : "failed";
	const conditionsPassed = conditions.every(
		(condition) => condition.status !== "failed",
	);
	return {
		passed:
			inventoryStatus === "passed" &&
			testExecution &&
			fullVerify &&
			conditionsPassed,
		sourceStateHash: current.sourceStateHash,
		inventory: {
			status: inventoryStatus,
			activeCaseCount: activeCases.length,
			reason: activeCases.length ? undefined : "missing_active_test_discovery",
		},
		testExecution: {
			status: testExecution ? "passed" : "failed",
			reason: testExecution ? undefined : "missing_successful_test_execution",
		},
		fullVerify: {
			status: fullVerify ? "passed" : "failed",
			reason: fullVerify ? undefined : "missing_successful_full_verify",
		},
		conditions,
	};
}

function unknownGate(reason: string): QualityGateResult {
	return {
		passed: false,
		inventory: { status: "unknown", activeCaseCount: 0, reason },
		testExecution: { status: "unknown", reason },
		fullVerify: { status: "unknown", reason },
		conditions: [],
	};
}

function snapshotHash(value: unknown): string | undefined {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : undefined;
}
