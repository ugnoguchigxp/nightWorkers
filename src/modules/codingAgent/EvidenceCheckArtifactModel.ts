import { useQuery } from "@tanstack/react-query";
import { toDeepRecord } from "../../../shared/json-record";
import type {
	EvidenceCheckDescriptor,
	EvidenceCheckSnapshot,
} from "../../../shared/modules/codingAgent";
import { apiFetch } from "../../lib/api-base";
import type { TaskMessage, WorkbenchArtifactRef } from "../nightworkers/types";

export type EvidenceCheckPanelModel = {
	taskId: string;
	specArtifactId: string | null;
	specMessageId: string | null;
	verificationDocumentId: string;
	verificationSidecarMessageId: string | null;
	conditions: EvidenceCheckSnapshot["conditions"];
};
export function findLatestEvidenceCheckSource(taskMessages: TaskMessage[]): {
	specMessageId: string;
	verificationDocumentId: string;
	verificationSidecarMessageId: string;
	specArtifactId: string;
} | null {
	for (let index = taskMessages.length - 1; index >= 0; index -= 1) {
		const message = taskMessages[index];
		if (message?.messageType !== "markdown_document") continue;
		const metadata = toDeepRecord(message.metadataJson);
		const intent = readString(metadata.intent);
		if (intent !== "feature_plan" && intent !== "implementation_plan") continue;
		const verificationDocumentId = readString(metadata.verificationDocumentId);
		const verificationSidecarMessageId = readString(
			metadata.verificationSidecarMessageId,
		);
		if (!verificationDocumentId || !verificationSidecarMessageId) continue;
		return {
			specMessageId: message.id,
			verificationDocumentId,
			verificationSidecarMessageId,
			specArtifactId: `${intent === "implementation_plan" ? "implementation-plan" : "feature-plan"}-${message.id}`,
		};
	}
	return null;
}

export function buildEvidenceCheckArtifact(input: {
	taskId: string;
	updatedAt: string;
	taskMessages: TaskMessage[];
	title: string;
	summary: string;
}): WorkbenchArtifactRef | null {
	const source = findLatestEvidenceCheckSource(input.taskMessages);
	if (!source) return null;
	return {
		id: `evidence-check-${source.verificationDocumentId}`,
		taskId: input.taskId,
		kind: "evidence_check",
		title: input.title,
		summary: input.summary,
		source: {
			type: "verification_document",
			verificationDocumentId: source.verificationDocumentId,
		},
		createdAt: input.updatedAt,
		metadata: source,
	};
}

export function buildEvidenceCheckArtifactFromDescriptor(input: {
	descriptor: EvidenceCheckDescriptor;
	title: string;
	summary: string;
}): WorkbenchArtifactRef {
	return {
		id: `evidence-check-${input.descriptor.verificationDocumentId}`,
		taskId: input.descriptor.taskId,
		kind: "evidence_check",
		title: input.title,
		summary: input.summary,
		source: {
			type: "verification_document",
			verificationDocumentId: input.descriptor.verificationDocumentId,
		},
		createdAt: input.descriptor.generatedAt,
		metadata: {
			verificationDocumentId: input.descriptor.verificationDocumentId,
			specMessageId: input.descriptor.specMessageId,
			specArtifactId: input.descriptor.specArtifactId,
		},
	};
}

export function buildEvidenceCheckPanelModel(input: {
	artifact: WorkbenchArtifactRef | null;
	taskMessages: TaskMessage[];
}): EvidenceCheckPanelModel | null {
	const artifact = input.artifact;
	if (artifact?.kind !== "evidence_check") return null;
	const source = findEvidenceSourceForArtifact(artifact, input.taskMessages);
	if (!source) return null;
	const sidecarMessage = source.verificationSidecarMessageId
		? input.taskMessages.find(
				(message) => message.id === source.verificationSidecarMessageId,
			)
		: null;
	const sidecarMetadata = toDeepRecord(sidecarMessage?.metadataJson);
	const document = toDeepRecord(sidecarMetadata.verificationDocument);
	const conditions = Array.isArray(document.conditions)
		? document.conditions
				.map((condition) => toDeepRecord(condition))
				.map((condition) => ({
					id: readString(condition.id) || "",
					text: readString(condition.text) || "",
					status: readString(condition.status) || "pending",
					required: (condition.required as unknown) !== false,
					verificationKind: readString(condition.verificationKind),
					expectedEvidence: Array.isArray(condition.expectedEvidence)
						? condition.expectedEvidence
								.map(readString)
								.filter((value): value is string => value !== null)
						: [],
					evidenceIds: [] as string[],
					reason: null,
					lastCheckedAt: null,
					assuranceStatus: "pending" as const,
					assuranceReason: "assurance_not_evaluated",
					tests: [],
				}))
				.filter((condition) => condition.id && condition.text)
		: [];
	return {
		taskId: artifact.taskId,
		...source,
		conditions,
	};
}

function findEvidenceSourceForArtifact(
	artifact: WorkbenchArtifactRef,
	taskMessages: TaskMessage[],
) {
	const metadata = toDeepRecord(artifact.metadata);
	const specMessageId = readString(metadata.specMessageId);
	const verificationDocumentId =
		readString(metadata.verificationDocumentId) ||
		(artifact.source.type === "verification_document"
			? artifact.source.verificationDocumentId
			: null);
	const verificationSidecarMessageId = readString(
		metadata.verificationSidecarMessageId,
	);
	const specArtifactId = readString(metadata.specArtifactId);
	if (verificationDocumentId) {
		return {
			specMessageId: specMessageId ?? null,
			verificationDocumentId,
			verificationSidecarMessageId: verificationSidecarMessageId ?? null,
			specArtifactId: specArtifactId ?? null,
		};
	}
	return findLatestEvidenceCheckSource(taskMessages);
}

export function useLatestEvidenceCheckDescriptor(
	taskId: string | null,
	refreshWhileActive = false,
) {
	return useQuery({
		queryKey: ["evidenceCheck", "latest", taskId],
		queryFn: async () => {
			if (!taskId) return null;
			const response = await apiFetch(
				`/api/coding-agent/tasks/${encodeURIComponent(taskId)}/evidence-check/latest`,
			);
			if (response.status === 204) return null;
			if (!response.ok) {
				throw new Error("Failed to fetch the latest Evidence Check");
			}
			return (await response.json()) as EvidenceCheckDescriptor;
		},
		enabled: Boolean(taskId),
		refetchInterval: refreshWhileActive ? 1_500 : false,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});
}

export function useEvidenceCheckSnapshot(
	model: EvidenceCheckPanelModel | null,
	options?: { enabled?: boolean; refetchInterval?: number | false },
) {
	return useQuery({
		queryKey: ["evidenceCheck", model?.taskId, model?.verificationDocumentId],
		queryFn: async () => {
			if (!model) return null;
			const response = await apiFetch(
				`/api/coding-agent/tasks/${encodeURIComponent(model.taskId)}/evidence-check/${encodeURIComponent(model.verificationDocumentId)}`,
			);
			if (!response.ok) {
				throw new Error("Failed to fetch evidence checklist");
			}
			return (await response.json()) as EvidenceCheckSnapshot;
		},
		enabled: Boolean(model) && options?.enabled !== false,
		refetchInterval: options?.refetchInterval ?? false,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});
}

export function buildEvidenceCheckExportMarkdown(input: {
	title: string;
	model: EvidenceCheckPanelModel | null;
	snapshot?: EvidenceCheckSnapshot | null;
}) {
	const traceability = input.snapshot?.implementationPlanTraceability;
	const planRows = traceability
		? [
				"## Implementation Plan Traceability",
				`- Provenance: ${traceability.provenanceStatus}`,
				`- Exact Todo match: ${traceability.exactTodoMatch ? "yes" : "no"}`,
				...traceability.steps.map((step) => {
					const checked = ["passed", "skipped"].includes(step.todoStatus ?? "")
						? "x"
						: " ";
					return `- [${checked}] ${step.seq}. ${step.title} (${step.todoStatus ?? "missing"}; ${step.aligned ? "aligned" : "mismatched"})`;
				}),
			]
		: [];
	const conditions =
		input.snapshot?.conditions ?? input.model?.conditions ?? [];
	const rows = conditions.flatMap((condition) => {
		const checked = ["safe_pass", "not_applicable"].includes(
			condition.assuranceStatus,
		)
			? "x"
			: " ";
		return [
			`- [${checked}] \`${condition.id}\` ${condition.text} (${condition.assuranceStatus})`,
			`  - Required evidence: ${condition.expectedEvidence.join(", ") || "none"}`,
			`  - Evidence refs: ${condition.evidenceIds.join(", ") || "none"}`,
			...(condition.assuranceReason
				? [`  - Reason: ${condition.assuranceReason}`]
				: []),
			...condition.tests.map(
				(test) =>
					`  - ${test.name} — ${test.execution.status}; ${test.execution.evidenceKind ?? "evidence kind unknown"}; ${test.runner}; ${test.filePath ?? "file unknown"}; mapping=${test.mappingSource}; currentSource=${test.guards.currentSource}; sourceStable=${test.guards.sourceStableDuringExecution ?? "unknown"}; executionObserved=${test.guards.testExecutionObserved}; fullVerify=${test.guards.fullVerifyPassed}`,
			),
		];
	});
	const safety = input.snapshot
		? [
				"## Evidence Snapshot",
				`- Task: ${input.snapshot.taskId}`,
				`- Verification Document: ${input.snapshot.verificationDocumentId}`,
				`- Generated at: ${input.snapshot.generatedAt}`,
				"## Test Assurance",
				`- Evaluated at: ${input.snapshot.evaluatedAt}`,
				`- Source state: ${input.snapshot.sourceStateHash ?? "unavailable"}`,
				`- Safe Pass: ${input.snapshot.assuranceSummary.safePass}/${input.snapshot.assuranceSummary.automated}`,
				`- Failed: ${input.snapshot.assuranceSummary.failed}`,
				`- Needs attention: ${input.snapshot.assuranceSummary.attention}`,
				...(input.snapshot.assuranceSummary.required !== undefined
					? [
							`- Required Safe Pass: ${input.snapshot.assuranceSummary.requiredSafePass ?? 0}/${input.snapshot.assuranceSummary.required}`,
							`- Unmapped: ${input.snapshot.assuranceSummary.unmapped ?? 0}`,
							`- Details missing: ${input.snapshot.assuranceSummary.detailsMissing ?? 0}`,
							`- Stale: ${input.snapshot.assuranceSummary.stale ?? 0}`,
						]
					: []),
				`- Full Verify: ${input.snapshot.assuranceSummary.fullVerifyStatus}`,
			]
		: [];
	return [
		`# ${input.title}`,
		...safety,
		...planRows,
		"## Completion Conditions",
		...rows,
	].join("\n\n");
}

export function buildEvidenceCheckExportCsv(snapshot: EvidenceCheckSnapshot) {
	const headers = [
		"task_id",
		"verification_document_id",
		"generated_at",
		"condition_id",
		"condition",
		"required",
		"verification_kind",
		"assurance_status",
		"assurance_reason",
		"expected_evidence",
		"condition_evidence_ids",
		"test_name",
		"test_file",
		"runner",
		"mapping_source",
		"execution_status",
		"evidence_kind",
		"duration_ms",
		"finished_at",
		"current_source",
		"source_stable",
		"test_execution_observed",
		"full_verify_passed",
		"evidence_run_id",
		"source_state_hash",
		"evaluated_at",
	];
	const rows = snapshot.conditions.flatMap((condition) => {
		const tests = condition.tests.length ? condition.tests : [null];
		return tests.map((test) => [
			snapshot.taskId,
			snapshot.verificationDocumentId,
			snapshot.generatedAt,
			condition.id,
			condition.text,
			condition.required,
			condition.verificationKind ?? "",
			condition.assuranceStatus,
			condition.assuranceReason ?? "",
			condition.expectedEvidence.join("|"),
			condition.evidenceIds.join("|"),
			test?.name ?? "",
			test?.filePath ?? "",
			test?.runner ?? "",
			test?.mappingSource ?? "",
			test?.execution.status ?? "",
			test?.execution.evidenceKind ?? "",
			test?.execution.durationMs ?? "",
			test?.execution.finishedAt ?? "",
			test?.guards.currentSource ?? "",
			test?.guards.sourceStableDuringExecution ?? "",
			test?.guards.testExecutionObserved ?? "",
			test?.guards.fullVerifyPassed ?? "",
			test?.execution.evidenceRunId ?? "",
			snapshot.sourceStateHash ?? "",
			snapshot.evaluatedAt,
		]);
	});
	return `\uFEFF${[headers, ...rows]
		.map((row) => row.map(csvCell).join(","))
		.join("\r\n")}\r\n`;
}

function csvCell(value: unknown) {
	let text = String(value ?? "");
	if (/^\s*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
	return `"${text.replaceAll('"', '""')}"`;
}

function readString(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
