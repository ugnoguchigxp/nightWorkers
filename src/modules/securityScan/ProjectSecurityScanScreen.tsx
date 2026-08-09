import {
	AlertTriangle,
	CheckCircle2,
	Download,
	Loader2,
	RefreshCw,
	ShieldAlert,
	Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { apiPath } from "../../lib/api-base";
import type { Task } from "../nightworkers/types";
import { SecurityScanFindingsSection } from "./SecurityScanFindingsSection";
import { SecurityScanProfileSelector } from "./SecurityScanProfileSelector";
import { SecurityTaskCandidateDialog } from "./SecurityTaskCandidateDialog";
import { securityScanReportContentPath } from "./securityScanCommands";
import { useSecurityScanController } from "./useSecurityScanController";
import { useSecurityTaskCandidateController } from "./useSecurityTaskCandidateController";

const severityColors: Record<string, string> = {
	critical: "#fb7185",
	high: "#f97316",
	medium: "#facc15",
	low: "#60a5fa",
	info: "#a1a1aa",
	unknown: "#71717a",
};

function formatDate(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ProjectSecurityScanScreen({
	repositoryId,
	onTasksCreated,
}: {
	repositoryId: string;
	onTasksCreated?: (tasks: Task[]) => Promise<void> | void;
}) {
	const { t } = useTranslation();
	const controller = useSecurityScanController(repositoryId);
	const taskCandidates = useSecurityTaskCandidateController({
		repositoryId,
		scanRunRef: controller.activeScan?.scanRunRef ?? null,
		onTasksCreated,
	});
	const configured =
		controller.providerSettings?.enabled &&
		(controller.providerSettings.transport === "local_cli"
			? controller.providerSettings.localCliConfigured
			: controller.providerSettings.tokenConfigured);
	const customProfileRef =
		controller.selection.mode === "custom"
			? controller.selection.profileRef
			: null;
	const currentProfile = customProfileRef
		? controller.capabilities?.selectableProfiles.find(
				(profile) => profile.ref === customProfileRef,
			)
		: null;
	const supportedTargets =
		controller.selectedPreset?.targets.map((item) => item.kind) ??
		currentProfile?.supportedTargets ??
		[];
	const progress = controller.activeScan?.progress;
	const progressPercent =
		progress && progress.totalSteps > 0
			? Math.round((progress.completedSteps / progress.totalSteps) * 100)
			: 0;
	const activeReport = controller.reports.some(
		(report) => report.status === "queued" || report.status === "running",
	);
	const createReport = async () => {
		const report = await controller.createReport();
		if (report?.status !== "completed") return;
		window.location.assign(
			apiPath(
				securityScanReportContentPath(
					repositoryId,
					report.scanRunRef,
					report.reportRef,
				),
			),
		);
	};
	return (
		<div className="space-y-4">
			{taskCandidates.result ? (
				<SecurityTaskCandidateDialog
					result={taskCandidates.result}
					busy={taskCandidates.action === "create"}
					onClose={taskCandidates.closeDialog}
					onCreateTasks={(candidateIds) =>
						void taskCandidates.createDraftTasks(candidateIds)
					}
				/>
			) : null}
			<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="flex items-center gap-2">
							<ShieldAlert className="h-5 w-5 text-orange-400" />
							<h2 className="text-base font-semibold text-zinc-100">
								{t("securityScan.title")}
							</h2>
						</div>
						<p className="mt-1 text-xs text-zinc-400">
							{t("securityScan.description")}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<span
							className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
								controller.capabilities
									? "bg-emerald-500/15 text-emerald-300"
									: "bg-zinc-800 text-zinc-400"
							}`}
						>
							{controller.capabilities
								? t("securityScan.connected")
								: t("securityScan.notConnected")}
						</span>
						<Button
							size="sm"
							variant="outline"
							icon={RefreshCw}
							loading={
								controller.action === "capabilities" ||
								controller.action === "initial"
							}
							disabled={!configured}
							onClick={() => void controller.loadCapabilities()}
							maxLabelLength={30}
						>
							{t("securityScan.reconnect")}
						</Button>
					</div>
				</div>

				{!configured ? (
					<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
						<div>
							<div className="text-xs font-semibold text-amber-200">
								{t("securityScan.configurationRequired")}
							</div>
							<p className="mt-1 text-[11px] text-zinc-400">
								{t("securityScan.configurationRequiredHelp")}
							</p>
						</div>
						<a
							href="/settings/security-intelligence"
							className="inline-flex h-8 items-center rounded-md bg-orange-500 px-3 text-xs font-semibold text-white hover:bg-orange-400"
						>
							{t("securityScan.openSettings")}
						</a>
					</div>
				) : null}

				{controller.error ? (
					<div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>{controller.error}</span>
					</div>
				) : null}
				{taskCandidates.error ? (
					<div className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
						<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
						<span>{taskCandidates.error}</span>
					</div>
				) : null}
			</section>

			{controller.capabilities ? (
				<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
					<h3 className="text-sm font-semibold text-zinc-100">
						{t("securityScan.newScan")}
					</h3>
					<p className="mt-1 text-[11px] text-zinc-500">
						{t("securityScan.providerVersion", {
							version: controller.capabilities.provider.version,
							project: controller.capabilities.project.displayName,
						})}
					</p>

					<div className="mt-4 grid gap-3 lg:grid-cols-3">
						{controller.capabilities.presets.map((preset) => {
							const selected =
								controller.selection.mode === "preset" &&
								controller.selection.presetId === preset.id;
							return (
								<button
									key={preset.id}
									type="button"
									onClick={() => {
										controller.updateSelection({
											mode: "preset",
											presetId: preset.id,
										});
										const nextTarget =
											preset.targets.find(
												(item) => item.kind === controller.target.kind,
											) ?? preset.targets[0];
										if (nextTarget) {
											controller.updateTarget(nextTarget.kind);
										}
									}}
									className={`rounded-lg border p-4 text-left transition ${
										selected
											? "border-orange-400 bg-orange-500/10"
											: "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
									}`}
								>
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs font-semibold text-zinc-100">
											{preset.displayName}
										</span>
										{preset.recommended ? (
											<span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[9px] text-orange-300">
												{t("securityScan.recommended")}
											</span>
										) : null}
									</div>
									<p className="mt-2 text-[10px] leading-relaxed text-zinc-400">
										{preset.description}
									</p>
								</button>
							);
						})}
					</div>

					{controller.capabilities.selectableProfiles.length > 0 ? (
						<SecurityScanProfileSelector
							profiles={controller.capabilities.selectableProfiles}
							selectedProfileRef={customProfileRef}
							onSelect={(profile) => {
								controller.updateSelection({
									mode: "custom",
									profileRef: profile.ref,
								});
								if (
									!profile.supportedTargets.includes(controller.target.kind)
								) {
									controller.updateTarget(profile.supportedTargets[0]);
								}
							}}
						/>
					) : null}

					<fieldset className="mt-4">
						<legend className="text-xs font-semibold text-zinc-300">
							{t("securityScan.target")}
						</legend>
						<div className="mt-2 flex flex-wrap gap-2">
							{(["working_tree", "full"] as const).map((kind) => (
								<label
									key={kind}
									className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
										controller.target.kind === kind
											? "border-orange-400 bg-orange-500/10 text-zinc-100"
											: "border-zinc-800 text-zinc-400"
									} ${
										supportedTargets.includes(kind)
											? "cursor-pointer"
											: "cursor-not-allowed opacity-40"
									}`}
								>
									<input
										type="radio"
										name="security-scan-target"
										checked={controller.target.kind === kind}
										disabled={!supportedTargets.includes(kind)}
										onChange={() => controller.updateTarget(kind)}
									/>
									{t(`securityScan.target.${kind}`)}
								</label>
							))}
						</div>
					</fieldset>

					<div className="mt-5 flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							variant="outline"
							loading={controller.action === "preview"}
							disabled={
								supportedTargets.length === 0 ||
								!supportedTargets.includes(controller.target.kind)
							}
							onClick={() => void controller.createPreview()}
							maxLabelLength={30}
						>
							{t("securityScan.preview")}
						</Button>
						<Button
							size="sm"
							loading={controller.action === "start"}
							disabled={!controller.preview}
							onClick={() => void controller.runScan()}
							maxLabelLength={30}
						>
							{t("securityScan.start")}
						</Button>
						<span className="text-[10px] text-zinc-500">
							{t("securityScan.previewRequired")}
						</span>
					</div>
				</section>
			) : null}

			{controller.preview ? (
				<section className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-5">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-blue-100">
								{t("securityScan.previewTitle")}
							</h3>
							<p className="mt-1 text-[11px] text-zinc-400">
								{t("securityScan.previewSummary", {
									min: controller.preview.estimatedDurationSeconds.min,
									max: controller.preview.estimatedDurationSeconds.max,
									files: controller.preview.target.fileCount ?? "—",
								})}
							</p>
						</div>
						<span className="font-mono text-[10px] text-zinc-500">
							{controller.preview.target.digest.slice(0, 12)}
						</span>
					</div>
					<div className="mt-3 grid gap-2 md:grid-cols-2">
						{controller.preview.toolSteps.map((step) => (
							<div
								key={step.id}
								className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-950/50 p-2 text-[10px]"
							>
								{step.availability === "available" ? (
									<CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-400" />
								) : (
									<AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-400" />
								)}
								<div>
									<div className="font-semibold text-zinc-200">{step.name}</div>
									<div className="text-zinc-500">
										{step.category}
										{step.reason ? ` · ${step.reason}` : ""}
									</div>
								</div>
							</div>
						))}
					</div>
					{controller.preview.warnings.length > 0 ? (
						<ul className="mt-3 list-disc space-y-1 pl-5 text-[10px] text-amber-300">
							{controller.preview.warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					) : null}
				</section>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
				<div className="space-y-4">
					{controller.activeScan ? (
						<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<h3 className="text-sm font-semibold text-zinc-100">
										{t("securityScan.result")}
									</h3>
									<div className="mt-1 font-mono text-[10px] text-zinc-500">
										{controller.activeScan.scanRunRef}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<span className="rounded-full bg-zinc-800 px-2.5 py-1 text-[10px] font-semibold text-zinc-200">
										{t(`securityScan.status.${controller.activeScan.status}`)}
									</span>
									{controller.activeScan.status === "queued" ||
									controller.activeScan.status === "running" ? (
										<Button
											size="sm"
											variant="outline-destructive"
											icon={Square}
											loading={controller.action === "cancel"}
											onClick={() => void controller.cancelScan()}
											maxLabelLength={30}
										>
											{t("securityScan.cancel")}
										</Button>
									) : null}
								</div>
							</div>

							{progress ? (
								<div className="mt-4">
									<div className="flex justify-between text-[10px] text-zinc-400">
										<span>
											{progress.currentStep ?? t("securityScan.waiting")}
										</span>
										<span>
											{progress.completedSteps}/{progress.totalSteps}
										</span>
									</div>
									<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
										<div
											className="h-full bg-orange-400 transition-all"
											style={{ width: `${progressPercent}%` }}
										/>
									</div>
								</div>
							) : null}

							{controller.activeScan.summary ? (
								<div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
									<div className="rounded-lg border border-zinc-800 p-3">
										<div className="text-[10px] text-zinc-500">
											{t("securityScan.findingCount")}
										</div>
										<div className="mt-1 text-xl font-semibold text-zinc-100">
											{controller.activeScan.summary.findingCount}
										</div>
									</div>
									{(["critical", "high", "medium"] as const).map((severity) => (
										<div
											key={severity}
											className="rounded-lg border border-zinc-800 p-3"
										>
											<div
												className="text-[10px] uppercase"
												style={{ color: severityColors[severity] }}
											>
												{severity}
											</div>
											<div className="mt-1 text-xl font-semibold text-zinc-100">
												{
													controller.activeScan?.summary?.severityCounts[
														severity
													]
												}
											</div>
										</div>
									))}
								</div>
							) : null}

							{controller.activeScan.error ? (
								<div className="mt-4 rounded border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
									{controller.activeScan.error.message}
								</div>
							) : null}
						</section>
					) : null}

					<SecurityScanFindingsSection
						findings={controller.findings}
						activeScan={controller.activeScan}
						selectedFindingRefs={taskCandidates.selectedFindingRefs}
						generating={taskCandidates.action === "generate"}
						onSelectAll={() =>
							taskCandidates.selectAll(
								controller.findings.map((finding) => finding.ref),
							)
						}
						onClearSelection={taskCandidates.clearSelection}
						onToggleFinding={taskCandidates.toggleFinding}
						onGenerate={() => void taskCandidates.requestCandidates()}
					/>

					{controller.activeScan?.status === "completed" ? (
						<section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-semibold text-zinc-100">
										{t("securityScan.llmReport")}
									</h3>
									<p className="mt-1 text-[10px] text-zinc-500">
										{t("securityScan.llmReportHelp")}
									</p>
								</div>
								<Button
									size="sm"
									loading={controller.action === "report" || activeReport}
									disabled={activeReport}
									onClick={() => void createReport()}
									maxLabelLength={30}
								>
									{t("securityScan.generateReport")}
								</Button>
							</div>
							<div className="mt-3 space-y-2">
								{controller.reports.map((report) => (
									<div
										key={report.reportRef}
										className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-800 p-3 text-xs"
									>
										<div>
											<div className="font-semibold text-zinc-200">
												{report.title ?? t("securityScan.reportPendingTitle")}
											</div>
											<div className="mt-0.5 text-[10px] text-zinc-500">
												{t(`securityScan.reportStatus.${report.status}`)} ·{" "}
												{formatDate(report.createdAt)}
											</div>
										</div>
										{report.status === "completed" ? (
											<a
												href={apiPath(
													securityScanReportContentPath(
														repositoryId,
														report.scanRunRef,
														report.reportRef,
													),
												)}
												className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-[10px] text-zinc-200 hover:bg-zinc-800"
											>
												<Download className="h-3.5 w-3.5" />
												{t("securityScan.downloadReport")}
											</a>
										) : report.status === "queued" ||
											report.status === "running" ? (
											<Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
										) : null}
									</div>
								))}
							</div>
						</section>
					) : null}
				</div>

				<aside className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
					<h3 className="text-xs font-semibold text-zinc-200">
						{t("securityScan.history")}
					</h3>
					{controller.history.length === 0 ? (
						<p className="mt-3 text-[10px] text-zinc-500">
							{t("securityScan.historyEmpty")}
						</p>
					) : (
						<div className="mt-3 space-y-2">
							{controller.history.map((item) => (
								<button
									key={item.scanRunRef}
									type="button"
									onClick={() => void controller.selectScan(item.scanRunRef)}
									className={`w-full rounded-lg border p-3 text-left ${
										controller.activeScan?.scanRunRef === item.scanRunRef
											? "border-orange-400 bg-orange-500/10"
											: "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700"
									}`}
								>
									<div className="text-[10px] font-semibold text-zinc-200">
										{item.selection.mode === "preset"
											? item.selection.presetId
											: item.selection.profileRef}
										{" · "}
										{t(`securityScan.target.${item.target.kind}`)}
									</div>
									<div className="mt-1 text-[9px] text-zinc-500">
										{formatDate(item.createdAt)}
									</div>
									<div className="mt-1 truncate font-mono text-[9px] text-zinc-600">
										{item.scanRunRef}
									</div>
								</button>
							))}
						</div>
					)}
				</aside>
			</div>
		</div>
	);
}
