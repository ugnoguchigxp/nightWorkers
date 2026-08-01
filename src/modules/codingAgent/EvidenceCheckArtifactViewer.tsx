import { useQuery } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	LoaderCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
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
					expectedEvidence: [] as string[],
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
		const checked = condition.assuranceStatus === "safe_pass" ? "x" : " ";
		return [
			`- [${checked}] \`${condition.id}\` ${condition.text} (${condition.assuranceStatus})`,
			...(condition.assuranceReason
				? [`  - Reason: ${condition.assuranceReason}`]
				: []),
			...condition.tests.map(
				(test) =>
					`  - ${test.name} — ${test.execution.status}; ${test.runner}; ${test.filePath ?? "file unknown"}; currentSource=${test.guards.currentSource}; sourceStable=${test.guards.sourceStableDuringExecution ?? "unknown"}; fullVerify=${test.guards.fullVerifyPassed}`,
			),
		];
	});
	const safety = input.snapshot
		? [
				"## Test Assurance",
				`- Evaluated at: ${input.snapshot.evaluatedAt}`,
				`- Source state: ${input.snapshot.sourceStateHash ?? "unavailable"}`,
				`- Safe Pass: ${input.snapshot.assuranceSummary.safePass}/${input.snapshot.assuranceSummary.automated}`,
				`- Failed: ${input.snapshot.assuranceSummary.failed}`,
				`- Needs attention: ${input.snapshot.assuranceSummary.attention}`,
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

export function buildEvidenceCheckExportCsv(
	snapshot: EvidenceCheckSnapshot,
) {
	const headers = [
		"condition_id",
		"condition",
		"required",
		"verification_kind",
		"assurance_status",
		"assurance_reason",
		"test_name",
		"test_file",
		"runner",
		"mapping_source",
		"execution_status",
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
			condition.id,
			condition.text,
			condition.required,
			condition.verificationKind ?? "",
			condition.assuranceStatus,
			condition.assuranceReason ?? "",
			test?.name ?? "",
			test?.filePath ?? "",
			test?.runner ?? "",
			test?.mappingSource ?? "",
			test?.execution.status ?? "",
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
	if (/^[=+\-@]/.test(text)) text = `'${text}`;
	return `"${text.replaceAll('"', '""')}"`;
}

export function EvidenceCheckArtifactViewer({
	model,
	snapshot,
	isLoading,
	isError,
	fetchSnapshot = true,
}: {
	model: EvidenceCheckPanelModel | null;
	snapshot?: EvidenceCheckSnapshot | null;
	isLoading?: boolean;
	isError?: boolean;
	fetchSnapshot?: boolean;
}) {
	const { t } = useTranslation();
	const query = useEvidenceCheckSnapshot(model, { enabled: fetchSnapshot });
	const resolvedSnapshot = snapshot ?? query.data ?? null;
	const resolvedIsLoading = isLoading ?? query.isLoading;
	const resolvedIsError = isError ?? query.isError;
	const conditions = resolvedSnapshot?.conditions ?? model?.conditions ?? [];
	const traceability = resolvedSnapshot?.implementationPlanTraceability ?? null;
	const conditionSummary = resolvedSnapshot?.summary ?? {
		total: conditions.length,
		confirmed: conditions.filter((condition) =>
			COMPLETE_STATUSES.has(condition.status),
		).length,
		failed: conditions.filter((condition) => condition.status === "failed")
			.length,
		pending: conditions.filter(
			(condition) =>
				!COMPLETE_STATUSES.has(condition.status) &&
				condition.status !== "failed",
		).length,
	};
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
			<div className="mx-auto grid max-w-5xl gap-5">
				{resolvedIsLoading && !resolvedSnapshot ? (
					<div className="nightworkers-structured-artifact-muted rounded border px-3 py-2 text-xs">
						{t("evidenceCheck.loading")}
					</div>
				) : null}
				{resolvedIsError ? (
					<div className="rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
						{t("evidenceCheck.loadFailed")}
					</div>
				) : null}
				{resolvedSnapshot ? (
					<section
						className="nightworkers-structured-artifact-card grid gap-3 rounded-md border p-3"
						data-evidence-assurance-summary
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
									{t("evidenceCheck.assurance.title")}
								</h2>
								<p className="nightworkers-structured-artifact-muted mt-1 text-xs">
									{t("evidenceCheck.assurance.summary", {
										...resolvedSnapshot.assuranceSummary,
									})}
								</p>
							</div>
							<AssuranceStatusBadge
								status={
									resolvedSnapshot.assuranceSummary.automated > 0 &&
									resolvedSnapshot.assuranceSummary.safePass ===
										resolvedSnapshot.assuranceSummary.automated
										? "safe_pass"
										: resolvedSnapshot.assuranceSummary.failed > 0
											? "failed"
											: "pending"
								}
							/>
						</div>
						<div className="nightworkers-structured-artifact-muted flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
							<span>
								{t("evidenceCheck.assurance.evaluatedAt")}: {formatTimestamp(resolvedSnapshot.evaluatedAt)}
							</span>
							<span>
								{t("evidenceCheck.assurance.source")}: {resolvedSnapshot.sourceStateHash?.slice(0, 12) ?? t("evidenceCheck.assurance.unavailable")}
							</span>
							<span>
								Full Verify: {t(`evidenceCheck.gateStatus.${resolvedSnapshot.assuranceSummary.fullVerifyStatus}`)}
							</span>
						</div>
					</section>
				) : null}
				{traceability ? (
					<section className="grid gap-2" data-evidence-plan-traceability>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
									{t("evidenceCheck.plan.title")}
								</h2>
								<p className="nightworkers-structured-artifact-muted mt-1 text-xs">
									{planTraceabilityMessage(t, traceability)}
								</p>
							</div>
							<span className="nightworkers-structured-artifact-muted rounded border px-2 py-1 font-mono text-[10px]">
								{traceability.digest.slice(0, 20)}…
							</span>
						</div>
						<div className="nightworkers-structured-artifact-muted text-xs">
							{t("evidenceCheck.plan.summary", traceability.summary)}
						</div>
						<div className="grid gap-1.5">
							{traceability.steps.map((step) => (
								<div
									key={step.seq}
									className="nightworkers-structured-artifact-row grid grid-cols-[2.5rem_1.25rem_7rem_minmax(0,1fr)] items-start gap-2 rounded-md border px-2.5 py-2 text-xs"
									data-evidence-plan-step={step.seq}
									data-plan-aligned={step.aligned}
								>
									<span className="nightworkers-structured-artifact-muted font-mono leading-5">
										{step.seq}
									</span>
									<span className="flex h-5 items-center">
										<EvidenceConditionStatusIcon
											status={
												step.aligned ? (step.todoStatus ?? "missing") : "failed"
											}
										/>
									</span>
									<span className="nightworkers-structured-artifact-muted whitespace-nowrap leading-5">
										{t(
											`evidenceCheck.conditionStatus.${step.todoStatus ?? "missing"}`,
											{ defaultValue: step.todoStatus ?? "missing" },
										)}
									</span>
									<div className="min-w-0">
										<div className="nightworkers-structured-artifact-text break-words font-medium leading-5">
											{step.title}
										</div>
										<div className="nightworkers-structured-artifact-muted mt-1 whitespace-normal break-words leading-5">
											{step.systemContext}
										</div>
									</div>
								</div>
							))}
						</div>
					</section>
				) : null}
				<section className="grid gap-2" data-evidence-spec-conditions>
					<div>
						<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
							{t("evidenceCheck.conditions.title")}
						</h2>
						<p className="nightworkers-structured-artifact-muted mt-1 text-xs">
							{t("evidenceCheck.conditions.summary", conditionSummary)}
						</p>
					</div>
					<div className="grid gap-1.5">
						{conditions.map((condition) => (
							<div
								key={condition.id}
								className="nightworkers-structured-artifact-row grid gap-2 rounded-md border px-3 py-2.5 text-xs"
								data-evidence-assurance-status={condition.assuranceStatus}
							>
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div className="flex min-w-0 items-start gap-2">
										<span className="nightworkers-structured-artifact-muted shrink-0 font-mono leading-5">
											{condition.id}
										</span>
										<div className="nightworkers-structured-artifact-text min-w-0 whitespace-normal break-words leading-5">
											{condition.text}
										</div>
									</div>
									<AssuranceStatusBadge status={condition.assuranceStatus} />
								</div>
								<div className="nightworkers-structured-artifact-muted flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4">
									<span>
										{t(`evidenceCheck.conditionStatus.${condition.status}`, {
											defaultValue: condition.status,
										})}
									</span>
									{condition.evidenceIds.length > 0 ? (
										<span>
											{t("evidenceCheck.conditionEvidence", {
												count: condition.evidenceIds.length,
											})}
										</span>
									) : null}
									{condition.assuranceReason ? (
										<span>
											{t(
												`evidenceCheck.assuranceReason.${condition.assuranceReason}`,
												{ defaultValue: condition.assuranceReason },
											)}
										</span>
									) : condition.reason ? (
										<span>{condition.reason}</span>
									) : null}
								</div>
								{condition.tests.length > 0 ? (
									<div className="grid gap-1.5 border-t border-slate-700/60 pt-2">
										{condition.tests.map((test) => (
											<div
												key={test.caseKey}
												className="nightworkers-structured-artifact-card grid gap-1 rounded border px-2.5 py-2"
											>
												<div className="flex flex-wrap items-center justify-between gap-2">
													<span className="nightworkers-structured-artifact-text break-words font-medium">
														{test.name}
													</span>
													<span className="nightworkers-structured-artifact-muted font-mono text-[10px]">
														{test.runner}
													</span>
												</div>
												<div className="nightworkers-structured-artifact-muted flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
													{test.filePath ? <span>{test.filePath}</span> : null}
													<span>
														{t("evidenceCheck.test.execution")}: {t(`evidenceCheck.testStatus.${test.execution.status}`)}
													</span>
											{test.execution.durationMs !== null ? (
												<span>{formatDuration(test.execution.durationMs)}</span>
											) : null}
													<span>
														{t("evidenceCheck.test.currentSource")}: {yesNo(t, test.guards.currentSource)}
													</span>
													<span>
														Full Verify: {yesNo(t, test.guards.fullVerifyPassed)}
													</span>
												</div>
											</div>
										))}
									</div>
								) : null}
							</div>
						))}
					</div>
				</section>
			</div>
		</div>
	);
}

function AssuranceStatusBadge({
	status,
}: {
	status: EvidenceCheckSnapshot["conditions"][number]["assuranceStatus"];
}) {
	const { t } = useTranslation();
	const safe = status === "safe_pass";
	const failed = status === "failed";
	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold ${
				safe
					? "border-emerald-700/70 bg-emerald-950/40 text-emerald-200"
					: failed
						? "border-rose-700/70 bg-rose-950/40 text-rose-200"
						: "border-amber-700/70 bg-amber-950/30 text-amber-100"
			}`}
		>
			{safe ? (
				<CheckCircle2 className="h-3.5 w-3.5" />
			) : failed ? (
				<AlertTriangle className="h-3.5 w-3.5" />
			) : (
				<Circle className="h-3.5 w-3.5" />
			)}
			{t(`evidenceCheck.assuranceStatus.${status}`)}
		</span>
	);
}

function yesNo(
	t: ReturnType<typeof useTranslation>["t"],
	value: boolean,
) {
	return t(
		value ? "evidenceCheck.assurance.yes" : "evidenceCheck.assurance.no",
	);
}

function formatTimestamp(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(durationMs: number | null) {
	if (durationMs === null) return "";
	return durationMs >= 1_000
		? `${(durationMs / 1_000).toFixed(2)}s`
		: `${Math.round(durationMs)}ms`;
}

function planTraceabilityMessage(
	t: ReturnType<typeof useTranslation>["t"],
	traceability: NonNullable<
		EvidenceCheckSnapshot["implementationPlanTraceability"]
	>,
) {
	if (traceability.provenanceStatus === "matched") {
		return t("evidenceCheck.plan.exactMatch");
	}
	if (traceability.provenanceStatus === "legacy_inferred") {
		return t("evidenceCheck.plan.legacyInferred");
	}
	if (traceability.provenanceStatus === "provenance_mismatch") {
		return t("evidenceCheck.plan.provenanceMismatch");
	}
	if (traceability.provenanceStatus === "missing") {
		return t("evidenceCheck.plan.provenanceMissing");
	}
	return t("evidenceCheck.plan.mismatch");
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
