import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EvidenceCheckSnapshot } from "../../../shared/modules/codingAgent";
import {
	type EvidenceCheckPanelModel,
	useEvidenceCheckSnapshot,
} from "./EvidenceCheckArtifactModel";

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
					<>
						<section
							className="nightworkers-structured-artifact-card grid gap-3 rounded-md border p-3"
							data-evidence-readiness
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
										{t("evidenceCheck.readiness.title")}
									</h2>
									<p className="nightworkers-structured-artifact-muted mt-1 text-xs">
										{t("evidenceCheck.readiness.summary", {
											matched: resolvedSnapshot.mapping.matched,
											total: resolvedSnapshot.mapping.total,
											verify: t(
												`evidenceCheck.verifyStatus.${resolvedSnapshot.verify.status}`,
											),
										})}
									</p>
								</div>
								<StatusBadge
									status={resolvedSnapshot.ready ? "ready" : "action_required"}
								/>
							</div>
							<div className="nightworkers-structured-artifact-muted flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
								<span>
									{t("evidenceCheck.readiness.evaluatedAt")}:{" "}
									{formatTimestamp(resolvedSnapshot.evaluatedAt)}
								</span>
								<span>
									{t("evidenceCheck.readiness.source")}:{" "}
									{resolvedSnapshot.sourceStateHash?.slice(0, 12) ??
										t("evidenceCheck.unavailable")}
								</span>
							</div>
						</section>

						<section className="grid gap-2" data-evidence-scope>
							<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
								{t("evidenceCheck.scope.title")}
							</h2>
							<div className="flex flex-wrap gap-2 text-xs">
								<span className="nightworkers-structured-artifact-card rounded border px-2.5 py-1.5">
									{t(`evidenceCheck.scope.${resolvedSnapshot.scope.testScope}`)}
								</span>
								<span
									className="nightworkers-structured-artifact-card rounded border px-2.5 py-1.5"
									data-e2e-allowed={resolvedSnapshot.scope.e2eAllowed}
								>
									{resolvedSnapshot.scope.e2eAllowed
										? t("evidenceCheck.scope.e2eIncluded")
										: t("evidenceCheck.scope.e2eExcluded")}
								</span>
							</div>
						</section>

						<section className="grid gap-2" data-evidence-mapping>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
										{t("evidenceCheck.mapping.title")}
									</h2>
									<p className="nightworkers-structured-artifact-muted mt-1 text-xs">
										{t(
											"evidenceCheck.mapping.summary",
											resolvedSnapshot.mapping,
										)}
									</p>
								</div>
								<StatusBadge status={resolvedSnapshot.mapping.status} />
							</div>
							<div className="grid gap-1.5">
								{resolvedSnapshot.mapping.items.map((item) => (
									<div
										key={item.id}
										className="nightworkers-structured-artifact-row grid gap-2 rounded-md border px-3 py-2.5 text-xs"
										data-evidence-mapping-status={item.status}
									>
										<div className="flex min-w-0 items-start gap-2">
											<span className="nightworkers-structured-artifact-muted shrink-0 font-mono leading-5">
												{item.id}
											</span>
											<span className="nightworkers-structured-artifact-text break-words leading-5">
												{item.text}
											</span>
										</div>
										{item.matches.map((match) => (
											<div
												key={match.caseKey}
												className="nightworkers-structured-artifact-muted flex flex-wrap gap-x-3 text-[10px]"
											>
												<span className="nightworkers-structured-artifact-text font-medium">
													{match.name}
												</span>
												<span>{match.filePath}</span>
												<span>{match.runner}</span>
											</div>
										))}
									</div>
								))}
							</div>
						</section>

						<section
							className="nightworkers-structured-artifact-card grid gap-2 rounded-md border p-3"
							data-evidence-confirmation={
								resolvedSnapshot.confirmation?.status ??
								(resolvedSnapshot.ready ? "settled" : "awaiting_initial_verify")
							}
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
									{t("evidenceCheck.confirmation.title")}
								</h2>
								<StatusBadge
									status={
										resolvedSnapshot.confirmation?.status ??
										(resolvedSnapshot.ready
											? "settled"
											: "awaiting_initial_verify")
									}
								/>
							</div>
							<div className="nightworkers-structured-artifact-muted font-mono text-[10px]">
								{t("evidenceCheck.confirmation.confirmedAt")}:{" "}
								{resolvedSnapshot.confirmation?.confirmedAt
									? formatTimestamp(resolvedSnapshot.confirmation.confirmedAt)
									: "-"}
							</div>
						</section>

						<section
							className="nightworkers-structured-artifact-card grid gap-2 rounded-md border p-3"
							data-evidence-verify
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<h2 className="nightworkers-structured-artifact-text text-sm font-semibold">
									{t("evidenceCheck.verify.title")}
								</h2>
								<StatusBadge status={resolvedSnapshot.verify.status} />
							</div>
							<div className="nightworkers-structured-artifact-muted grid gap-1 font-mono text-[10px]">
								<span>
									{t("evidenceCheck.verify.command")}:{" "}
									{resolvedSnapshot.verify.command ??
										resolvedSnapshot.scope.authorizedVerifyCommand?.command ??
										t("evidenceCheck.verify.notSelected")}
								</span>
								<span>
									{t("evidenceCheck.verify.exitCode")}:{" "}
									{resolvedSnapshot.verify.exitCode ?? "-"}
								</span>
								<span>
									{t("evidenceCheck.verify.finishedAt")}:{" "}
									{resolvedSnapshot.verify.finishedAt
										? formatTimestamp(resolvedSnapshot.verify.finishedAt)
										: "-"}
								</span>
							</div>
						</section>

						<section
							className="rounded-md border border-sky-800/70 bg-sky-950/20 px-3 py-2.5 text-xs"
							data-evidence-next-action={resolvedSnapshot.suggestedAction}
						>
							<span className="nightworkers-structured-artifact-text font-semibold">
								{t("evidenceCheck.nextAction.title")}:{" "}
								{t(
									`evidenceCheck.nextAction.${resolvedSnapshot.suggestedAction}`,
								)}
							</span>
						</section>
					</>
				) : null}
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const { t } = useTranslation();
	const passed = [
		"ready",
		"matched",
		"passed",
		"not_required",
		"confirmed",
		"settled",
	].includes(status);
	const failed = status === "failed" || status === "ambiguous";
	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold ${
				passed
					? "border-emerald-700/70 bg-emerald-950/40 text-emerald-200"
					: failed
						? "border-rose-700/70 bg-rose-950/40 text-rose-200"
						: "border-amber-700/70 bg-amber-950/30 text-amber-100"
			}`}
		>
			{passed ? (
				<CheckCircle2 className="h-3.5 w-3.5" />
			) : failed ? (
				<AlertTriangle className="h-3.5 w-3.5" />
			) : (
				<Circle className="h-3.5 w-3.5" />
			)}
			{t(`evidenceCheck.status.${status}`, { defaultValue: status })}
		</span>
	);
}

function formatTimestamp(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
