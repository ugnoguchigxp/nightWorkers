import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	LoaderCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toDeepRecord } from "../../../shared/json-record";
import type { EvidenceCheckSnapshot } from "../../../shared/modules/codingAgent";
import { apiFetch } from "../../lib/api-base";
import type { TaskMessage, WorkbenchArtifactRef } from "../nightworkers/types";

export type EvidenceCheckPanelModel = {
	taskId: string;
	specArtifactId: string;
	specMessageId: string;
	verificationDocumentId: string;
	verificationSidecarMessageId: string;
	conditions: EvidenceCheckSnapshot["conditions"];
};

const COMPLETE_STATUSES = new Set([
	"passed",
	"completed",
	"done",
	"covered",
	"manual",
	"not_applicable",
]);

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

export function buildEvidenceCheckPanelModel(input: {
	artifact: WorkbenchArtifactRef | null;
	taskMessages: TaskMessage[];
}): EvidenceCheckPanelModel | null {
	const artifact = input.artifact;
	if (artifact?.kind !== "evidence_check") return null;
	const source = findEvidenceSourceForArtifact(artifact, input.taskMessages);
	if (!source) return null;
	const sidecarMessage = input.taskMessages.find(
		(message) => message.id === source.verificationSidecarMessageId,
	);
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
					evidenceIds: [] as string[],
					reason: null,
					lastCheckedAt: null,
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
	if (
		specMessageId &&
		verificationDocumentId &&
		verificationSidecarMessageId &&
		specArtifactId
	) {
		return {
			specMessageId,
			verificationDocumentId,
			verificationSidecarMessageId,
			specArtifactId,
		};
	}
	return findLatestEvidenceCheckSource(taskMessages);
}

export function useEvidenceCheckSnapshot(
	model: EvidenceCheckPanelModel | null,
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
		enabled: Boolean(model),
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});
}

export function buildEvidenceCheckExportMarkdown(input: {
	title: string;
	model: EvidenceCheckPanelModel | null;
	snapshot?: EvidenceCheckSnapshot | null;
}) {
	const conditions =
		input.snapshot?.conditions ?? input.model?.conditions ?? [];
	const rows = conditions.map((condition) => {
		const checked = COMPLETE_STATUSES.has(condition.status) ? "x" : " ";
		return `- [${checked}] \`${condition.id}\` ${condition.text} (${condition.status})`;
	});
	return [`# ${input.title}`, "## Completion Conditions", ...rows].join("\n\n");
}

export function EvidenceCheckArtifactViewer({
	model,
	snapshot,
}: {
	model: EvidenceCheckPanelModel | null;
	snapshot?: EvidenceCheckSnapshot | null;
}) {
	const { t } = useTranslation();
	const query = useEvidenceCheckSnapshot(model);
	const conditions =
		snapshot?.conditions ?? query.data?.conditions ?? model?.conditions ?? [];
	if (!model) {
		return (
			<div className="nightworkers-structured-artifact h-full p-5">
				<div className="nightworkers-structured-artifact-card nightworkers-structured-artifact-muted mx-auto max-w-5xl rounded-md border p-4 text-xs">
					{t("evidenceCheck.unavailable")}
				</div>
			</div>
		);
	}
	return (
		<div
			className="nightworkers-structured-artifact h-full overflow-auto p-5"
			data-artifact-export-expand
		>
			<div className="mx-auto grid max-w-5xl gap-1.5">
				{conditions.map((condition) => (
					<div
						key={condition.id}
						className="nightworkers-structured-artifact-row grid grid-cols-[4.5rem_1.25rem_7rem_minmax(0,1fr)] items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs"
					>
						<span className="nightworkers-structured-artifact-muted font-mono leading-5">
							{condition.id}
						</span>
						<span className="flex h-5 items-center">
							<EvidenceConditionStatusIcon status={condition.status} />
						</span>
						<span className="nightworkers-structured-artifact-muted whitespace-nowrap leading-5">
							{t(`evidenceCheck.conditionStatus.${condition.status}`, {
								defaultValue: condition.status,
							})}
						</span>
						<span className="nightworkers-structured-artifact-text min-w-0 whitespace-normal break-words leading-5">
							{condition.text}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function EvidenceConditionStatusIcon({ status }: { status: string }) {
	if (COMPLETE_STATUSES.has(status)) {
		return (
			<CheckCircle2 className="nightworkers-structured-artifact-success h-4 w-4" />
		);
	}
	if (status === "failed" || status === "missing" || status === "unknown") {
		return (
			<AlertTriangle className="nightworkers-structured-artifact-warning h-4 w-4" />
		);
	}
	if (status === "running") {
		return (
			<LoaderCircle className="nightworkers-structured-artifact-accent h-4 w-4 animate-spin" />
		);
	}
	return <Circle className="nightworkers-structured-artifact-muted h-4 w-4" />;
}

function readString(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
