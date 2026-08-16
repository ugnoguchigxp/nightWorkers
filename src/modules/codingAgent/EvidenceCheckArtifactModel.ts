import { useQuery } from "@tanstack/react-query";
import { toDeepRecord } from "../../../shared/json-record";
import type {
	EvidenceCheckDescriptor,
	EvidenceCheckSnapshot,
} from "../../../shared/modules/codingAgent";
import { legacyEvidenceAssuranceSnapshot } from "../../../shared/modules/codingAgent";
import { apiFetch } from "../../lib/api-base";
import { readJsonResponse } from "../../lib/api-error";
import type { TaskMessage, WorkbenchArtifactRef } from "../nightworkers/types";

export type EvidenceCheckPanelModel = {
	taskId: string;
	specArtifactId: string | null;
	specMessageId: string | null;
	verificationDocumentId: string;
	verificationSidecarMessageId: string | null;
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
	return { taskId: artifact.taskId, ...source };
}

function findEvidenceSourceForArtifact(
	artifact: WorkbenchArtifactRef,
	taskMessages: TaskMessage[],
) {
	const metadata = toDeepRecord(artifact.metadata);
	const verificationDocumentId =
		readString(metadata.verificationDocumentId) ||
		(artifact.source.type === "verification_document"
			? artifact.source.verificationDocumentId
			: null);
	if (verificationDocumentId) {
		return {
			specMessageId: readString(metadata.specMessageId),
			verificationDocumentId,
			verificationSidecarMessageId: readString(
				metadata.verificationSidecarMessageId,
			),
			specArtifactId: readString(metadata.specArtifactId),
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
			return readJsonResponse<EvidenceCheckDescriptor>(response);
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
			return readJsonResponse<EvidenceCheckSnapshot>(response);
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
	const snapshot = input.snapshot;
	if (!snapshot)
		return `# ${input.title}\n\nEvidence readiness is unavailable.`;
	const assurance = snapshot.assurance ?? legacyEvidenceAssuranceSnapshot;
	return [
		`# ${input.title}`,
		"## Scope",
		`- Verification Document: ${snapshot.verificationDocumentId}`,
		`- Test scope: ${snapshot.scope.testScope}`,
		`- E2E allowed: ${snapshot.scope.e2eAllowed ? "yes" : "no"}`,
		"## Evidence Mapping",
		`- Status: ${snapshot.mapping.status}`,
		`- Matched: ${snapshot.mapping.matched}/${snapshot.mapping.total}`,
		...snapshot.mapping.items.flatMap((item) => [
			`- ${item.id} ${item.text} (${item.status})`,
			...item.matches.map(
				(match) =>
					`  - ${match.name}; ${match.runner}; ${match.filePath ?? "file unknown"}`,
			),
		]),
		"## Project Verify",
		`- Status: ${snapshot.verify.status}`,
		`- Command: ${snapshot.verify.command ?? "not selected"}`,
		`- Exit code: ${snapshot.verify.exitCode ?? "not run"}`,
		`- Source state: ${snapshot.sourceStateHash ?? "unavailable"}`,
		"## Acceptance-condition Assurance",
		`- Policy: ${assurance.policyVersion}`,
		`- Status: ${assurance.status}`,
		`- Verification Document digest: ${assurance.verificationDocumentDigest ?? "unavailable"}`,
		`- Receipt digest: ${assurance.receiptDigest ?? "not confirmed"}`,
		...assurance.conditions.map(
			(condition) =>
				`- ${condition.conditionId} ${condition.text} (${condition.assuranceStatus}${condition.reasonCode ? `; ${condition.reasonCode}` : ""})`,
		),
		"## Evidence Check Confirmation",
		`- Status: ${snapshot.confirmation.status}`,
		`- Confirmed at: ${snapshot.confirmation.confirmedAt ?? "not confirmed"}`,
		"## Next Action",
		`- ${snapshot.suggestedAction}`,
	].join("\n\n");
}

export function buildEvidenceCheckExportCsv(snapshot: EvidenceCheckSnapshot) {
	const assuranceSnapshot =
		snapshot.assurance ?? legacyEvidenceAssuranceSnapshot;
	const headers = [
		"task_id",
		"verification_document_id",
		"test_scope",
		"mapping_status",
		"assurance_policy",
		"assurance_status",
		"condition_assurance_status",
		"condition_assurance_reason",
		"evidence_item_id",
		"evidence_item",
		"item_status",
		"test_name",
		"test_file",
		"runner",
		"verify_status",
		"verify_command",
		"verify_exit_code",
		"confirmation_status",
		"confirmation_confirmed_at",
		"source_state_hash",
		"evaluated_at",
	];
	const rows = snapshot.mapping.items.flatMap((item) => {
		const assurance = assuranceSnapshot.conditions.find(
			(condition) => condition.conditionId === item.id,
		);
		const matches = item.matches.length ? item.matches : [null];
		return matches.map((match) => [
			snapshot.taskId,
			snapshot.verificationDocumentId,
			snapshot.scope.testScope,
			snapshot.mapping.status,
			assuranceSnapshot.policyVersion,
			assuranceSnapshot.status,
			assurance?.assuranceStatus ?? "",
			assurance?.reasonCode ?? "",
			item.id,
			item.text,
			item.status,
			match?.name ?? "",
			match?.filePath ?? "",
			match?.runner ?? "",
			snapshot.verify.status,
			snapshot.verify.command ?? "",
			snapshot.verify.exitCode ?? "",
			snapshot.confirmation.status,
			snapshot.confirmation.confirmedAt ?? "",
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
