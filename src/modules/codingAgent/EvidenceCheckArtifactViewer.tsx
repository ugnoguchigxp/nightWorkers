import {
	AlertTriangle,
	CheckCircle2,
	Circle,
	LoaderCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EvidenceCheckSnapshot } from "../../../shared/modules/codingAgent";
import {
	type EvidenceCheckPanelModel,
	useEvidenceCheckSnapshot,
} from "./EvidenceCheckArtifactModel";

const TODO_COMPLETE_STATUSES = new Set([
	"passed",
	"completed",
	"done",
	"covered",
	"manual",
	"not_applicable",
]);

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
		confirmed: conditions.filter(
			(condition) =>
				condition.assuranceStatus === "safe_pass" ||
				condition.assuranceStatus === "not_applicable",
		).length,
		failed: conditions.filter(
			(condition) => condition.assuranceStatus === "failed",
		).length,
		pending: conditions.filter(
			(condition) =>
				condition.assuranceStatus !== "safe_pass" &&
				condition.assuranceStatus !== "not_applicable" &&
				condition.assuranceStatus !== "failed",
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
									resolvedSnapshot.assuranceSummary.fullVerifyStatus ===
										"passed" &&
									(resolvedSnapshot.assuranceSummary.required !== undefined
										? resolvedSnapshot.assuranceSummary.required > 0 &&
											resolvedSnapshot.assuranceSummary.requiredSafePass ===
												resolvedSnapshot.assuranceSummary.required
										: resolvedSnapshot.assuranceSummary.automated > 0 &&
											resolvedSnapshot.assuranceSummary.safePass ===
												resolvedSnapshot.assuranceSummary.automated)
										? "safe_pass"
										: resolvedSnapshot.assuranceSummary.failed > 0 ||
												resolvedSnapshot.assuranceSummary.fullVerifyStatus ===
													"failed"
											? "failed"
											: "pending"
								}
							/>
						</div>
						<div className="nightworkers-structured-artifact-muted flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
							<span>
								{t("evidenceCheck.assurance.evaluatedAt")}:{" "}
								{formatTimestamp(resolvedSnapshot.evaluatedAt)}
							</span>
							<span>
								{t("evidenceCheck.assurance.source")}:{" "}
								{resolvedSnapshot.sourceStateHash?.slice(0, 12) ??
									t("evidenceCheck.assurance.unavailable")}
							</span>
							<span>
								{t("evidenceCheck.test.fullVerify")}:{" "}
								{t(
									`evidenceCheck.gateStatus.${resolvedSnapshot.assuranceSummary.fullVerifyStatus}`,
								)}
							</span>
							{resolvedSnapshot.assuranceSummary.required !== undefined ? (
								<span>
									{t("evidenceCheck.assurance.conditionMetrics", {
										required: resolvedSnapshot.assuranceSummary.required,
										safePass:
											resolvedSnapshot.assuranceSummary.requiredSafePass ?? 0,
										unmapped: resolvedSnapshot.assuranceSummary.unmapped ?? 0,
										detailsMissing:
											resolvedSnapshot.assuranceSummary.detailsMissing ?? 0,
										stale: resolvedSnapshot.assuranceSummary.stale ?? 0,
									})}
								</span>
							) : null}
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
										{t("evidenceCheck.conditionVerificationKind")}:{" "}
										{condition.verificationKind ?? "unknown"}
									</span>
									<span>
										{t("evidenceCheck.conditionExpectedEvidence")}:{" "}
										{condition.expectedEvidence.join(", ") || "none"}
									</span>
									<span>
										{t("evidenceCheck.conditionRecordedStatus")}:{" "}
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
								{condition.evidenceIds.length > 0 ? (
									<div className="nightworkers-structured-artifact-muted break-all font-mono text-[10px] leading-4">
										{t("evidenceCheck.evidenceReferences")}:{" "}
										{condition.evidenceIds.join(", ")}
									</div>
								) : null}
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
														{t("evidenceCheck.test.mappingSource")}:{" "}
														{test.mappingSource}
													</span>
													<span>
														{t("evidenceCheck.test.execution")}:{" "}
														{t(
															`evidenceCheck.testStatus.${test.execution.status}`,
														)}
													</span>
													{test.execution.evidenceKind ? (
														<span>
															{t("evidenceCheck.test.evidenceKind")}:{" "}
															{test.execution.evidenceKind}
														</span>
													) : null}
													{test.execution.durationMs !== null ? (
														<span>
															{formatDuration(test.execution.durationMs)}
														</span>
													) : null}
													<span>
														{t("evidenceCheck.test.currentSource")}:{" "}
														{yesNo(t, test.guards.currentSource)}
													</span>
													<span>
														{t("evidenceCheck.test.sourceStable")}:{" "}
														{nullableYesNo(
															t,
															test.guards.sourceStableDuringExecution,
														)}
													</span>
													<span>
														{t("evidenceCheck.test.executionObserved")}:{" "}
														{yesNo(t, test.guards.testExecutionObserved)}
													</span>
													<span>
														{t("evidenceCheck.test.fullVerify")}:{" "}
														{yesNo(t, test.guards.fullVerifyPassed)}
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

function yesNo(t: ReturnType<typeof useTranslation>["t"], value: boolean) {
	return t(
		value ? "evidenceCheck.assurance.yes" : "evidenceCheck.assurance.no",
	);
}

function nullableYesNo(
	t: ReturnType<typeof useTranslation>["t"],
	value: boolean | null,
) {
	return value === null
		? t("evidenceCheck.gateStatus.unknown")
		: yesNo(t, value);
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
	if (TODO_COMPLETE_STATUSES.has(status)) {
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
