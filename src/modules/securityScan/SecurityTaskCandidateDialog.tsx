import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useModalFocus } from "@/hooks/useModalFocus";
import type { GenerateSecurityScanTaskCandidatesResponse } from "../../../shared/schemas/security-task-generation.schema";

export function SecurityTaskCandidateDialog({
	result,
	busy,
	onClose,
	onCreateTasks,
}: {
	result: GenerateSecurityScanTaskCandidatesResponse;
	busy: boolean;
	onClose: () => void;
	onCreateTasks: (candidateIds: string[]) => void;
}) {
	const { t } = useTranslation();
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const dialogRef = useModalFocus<HTMLDivElement>({
		open: true,
		onClose: () => {
			if (!busy) onClose();
		},
	});
	useEffect(() => {
		setSelectedIds(result.candidates.map((candidate) => candidate.id));
	}, [result]);
	const toggle = (candidateId: string) => {
		setSelectedIds((current) =>
			current.includes(candidateId)
				? current.filter((id) => id !== candidateId)
				: [...current, candidateId],
		);
	};
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="security-task-candidate-dialog-title"
				tabIndex={-1}
				className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
			>
				<div className="flex items-start justify-between gap-3 border-b border-zinc-800 p-5">
					<div>
						<h3
							id="security-task-candidate-dialog-title"
							className="text-base font-semibold text-zinc-100"
						>
							{t("securityScan.taskCandidatesTitle")}
						</h3>
						<p className="mt-1 text-[11px] text-zinc-400">
							{t("securityScan.taskCandidatesHelp")}
						</p>
					</div>
					<button
						type="button"
						aria-label={t("securityScan.closeTaskCandidates")}
						disabled={busy}
						onClick={onClose}
						className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="nightworkers-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
					{result.coverageWarnings.length > 0 ? (
						<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-amber-200">
							<div className="flex items-center gap-2 font-semibold">
								<AlertTriangle className="h-4 w-4" />
								{t("securityScan.coverageWarning")}
							</div>
							<ul className="mt-2 list-disc space-y-1 pl-5">
								{result.coverageWarnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					) : null}
					{result.duplicates.length > 0 ? (
						<div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-3 text-[11px] text-blue-200">
							<div className="font-semibold">
								{t("securityScan.duplicateFindings", {
									count: result.duplicates.length,
								})}
							</div>
							<ul className="mt-2 space-y-1 font-mono text-[10px] text-blue-300/80">
								{result.duplicates.map((duplicate) => (
									<li key={duplicate.findingRef}>
										{duplicate.findingRef} →{" "}
										{duplicate.taskId ?? duplicate.candidateId}
									</li>
								))}
							</ul>
						</div>
					) : null}
					{result.candidates.map((candidate) => {
						const selected = selectedIds.includes(candidate.id);
						const findings =
							candidate.source.kind === "security_scan"
								? candidate.source.findings
								: [];
						return (
							<label
								key={candidate.id}
								className={`block cursor-pointer rounded-lg border p-4 ${
									selected
										? "border-orange-400 bg-orange-500/5"
										: "border-zinc-800 bg-zinc-900/30"
								}`}
							>
								<div className="flex items-start gap-3">
									<input
										type="checkbox"
										checked={selected}
										disabled={busy}
										onChange={() => toggle(candidate.id)}
										className="mt-1"
									/>
									<div className="min-w-0 flex-1">
										<div className="text-sm font-semibold text-zinc-100">
											{candidate.title}
										</div>
										<p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
											{candidate.summary}
										</p>
										<div className="mt-3 rounded border border-zinc-800 bg-black/20 p-3">
											<div className="text-[10px] font-semibold text-zinc-300">
												{t("securityScan.taskPrompt")}
											</div>
											<p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-400">
												{candidate.taskPrompt}
											</p>
										</div>
										<div className="mt-3 grid gap-3 md:grid-cols-2">
											<div>
												<div className="text-[10px] font-semibold text-zinc-300">
													{t("securityScan.rationale")}
												</div>
												<p className="mt-1 whitespace-pre-wrap text-[10px] text-zinc-500">
													{candidate.rationale}
												</p>
											</div>
											<div>
												<div className="text-[10px] font-semibold text-zinc-300">
													{t("securityScan.acceptanceCriteria")}
												</div>
												<p className="mt-1 whitespace-pre-wrap text-[10px] text-zinc-500">
													{candidate.acceptanceCriteria}
												</p>
											</div>
											<div>
												<div className="text-[10px] font-semibold text-zinc-300">
													{t("securityScan.verificationPlan")}
												</div>
												<p className="mt-1 whitespace-pre-wrap text-[10px] text-zinc-500">
													{candidate.verificationPlan}
												</p>
											</div>
										</div>
										{candidate.planModeOpenQuestions.length > 0 ? (
											<div className="mt-3">
												<div className="text-[10px] font-semibold text-zinc-300">
													{t("securityScan.planModeOpenQuestions")}
												</div>
												<ul className="mt-1 list-disc space-y-1 pl-4 text-[10px] text-zinc-500">
													{candidate.planModeOpenQuestions.map((question) => (
														<li key={question}>{question}</li>
													))}
												</ul>
											</div>
										) : null}
										<div className="mt-3 flex flex-wrap gap-1.5">
											{findings.map((finding) => (
												<span
													key={finding.ref}
													className="rounded bg-zinc-800 px-2 py-1 font-mono text-[9px] text-zinc-300"
												>
													{finding.severity} · {finding.ref} · {finding.title}
												</span>
											))}
										</div>
									</div>
								</div>
							</label>
						);
					})}
					{result.candidates.length === 0 ? (
						<p className="rounded-lg border border-zinc-800 p-4 text-xs text-zinc-400">
							{t("securityScan.noNewTaskCandidates")}
						</p>
					) : null}
					{result.needsHuman.length > 0 ? (
						<section className="rounded-lg border border-zinc-800 p-4">
							<h4 className="text-xs font-semibold text-zinc-200">
								{t("securityScan.needsHuman")}
							</h4>
							<ul className="mt-2 space-y-2 text-[11px] text-zinc-400">
								{result.needsHuman.map((item) => (
									<li key={item.findingRef}>
										<span className="font-mono text-zinc-300">
											{item.findingRef}
										</span>{" "}
										· {item.reason}
									</li>
								))}
							</ul>
						</section>
					) : null}
				</div>
				<div className="flex justify-end gap-2 border-t border-zinc-800 p-4">
					<Button variant="outline" disabled={busy} onClick={onClose}>
						{t("securityScan.cancelTaskCreation")}
					</Button>
					<Button
						loading={busy}
						disabled={busy || selectedIds.length === 0}
						onClick={() => onCreateTasks([...selectedIds])}
						maxLabelLength={40}
					>
						{t("securityScan.createDraftTasks", {
							count: selectedIds.length,
						})}
					</Button>
				</div>
			</div>
		</div>
	);
}
