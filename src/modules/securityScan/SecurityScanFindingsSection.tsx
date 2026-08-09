import { ListTodo } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type {
	SecurityScanFindingPage,
	SecurityScanRunDetail,
} from "../../../shared/schemas/security-scan.schema";
import { SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS } from "../../../shared/schemas/security-scan.schema";

const severityColors: Record<string, string> = {
	critical: "#fb7185",
	high: "#f97316",
	medium: "#facc15",
	low: "#60a5fa",
	info: "#a1a1aa",
	unknown: "#71717a",
};

export function SecurityScanFindingsSection({
	findings,
	activeScan,
	selectedFindingRefs,
	generating,
	onSelectAll,
	onClearSelection,
	onToggleFinding,
	onGenerate,
}: {
	findings: SecurityScanFindingPage["items"];
	activeScan: SecurityScanRunDetail | null;
	selectedFindingRefs: string[];
	generating: boolean;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onToggleFinding: (findingRef: string) => void;
	onGenerate: () => void;
}) {
	const { t } = useTranslation();
	if (findings.length === 0) return null;
	return (
		<section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
				<div>
					<h3 className="text-sm font-semibold text-zinc-100">
						{t("securityScan.findings")}
					</h3>
					<div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-500">
						<button
							type="button"
							className="hover:text-zinc-200"
							disabled={generating}
							onClick={onSelectAll}
						>
							{t("securityScan.selectAllFindings")}
						</button>
						<button
							type="button"
							className="hover:text-zinc-200"
							disabled={generating}
							onClick={onClearSelection}
						>
							{t("securityScan.clearFindingSelection")}
						</button>
						<span>
							{t("securityScan.selectedFindingCount", {
								count: selectedFindingRefs.length,
							})}
						</span>
					</div>
				</div>
				<Button
					size="sm"
					icon={ListTodo}
					loading={generating}
					disabled={
						activeScan?.status !== "completed" ||
						selectedFindingRefs.length === 0
					}
					onClick={onGenerate}
					maxLabelLength={40}
				>
					{t("securityScan.generateTasksFromFindings", {
						count: selectedFindingRefs.length,
					})}
				</Button>
			</div>
			<div className="border-b border-zinc-800 px-5 py-2 text-[10px] text-zinc-500">
				{t("securityScan.findingSelectionLimit", {
					count: SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS,
				})}
			</div>
			{activeScan?.summary &&
			activeScan.summary.findingCount > findings.length ? (
				<div className="border-b border-amber-500/20 bg-amber-500/5 px-5 py-2 text-[10px] text-amber-300">
					{t("securityScan.findingsPartiallyLoaded", {
						loaded: findings.length,
						total: activeScan.summary.findingCount,
					})}
				</div>
			) : null}
			<div className="divide-y divide-zinc-800">
				{findings.map((finding) => (
					<article key={finding.ref} className="flex gap-3 p-5">
						<input
							type="checkbox"
							aria-label={t("securityScan.selectFinding", {
								title: finding.title,
							})}
							checked={selectedFindingRefs.includes(finding.ref)}
							disabled={generating}
							onChange={() => onToggleFinding(finding.ref)}
							className="mt-1"
						/>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div>
									<div className="flex items-center gap-2">
										<span
											className="text-[10px] font-bold uppercase"
											style={{ color: severityColors[finding.severity] }}
										>
											{finding.severity}
										</span>
										<h4 className="text-xs font-semibold text-zinc-100">
											{finding.title}
										</h4>
									</div>
									<p className="mt-1 font-mono text-[10px] text-zinc-500">
										{finding.location.path ?? "—"}
										{finding.location.startLine
											? `:${finding.location.startLine}`
											: ""}{" "}
										· {finding.tool}
									</p>
								</div>
							</div>
							{finding.description ? (
								<p className="mt-3 whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
									{finding.description}
								</p>
							) : null}
							{finding.recommendation ? (
								<div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-[11px] text-emerald-200">
									<span className="font-semibold">
										{t("securityScan.recommendation")}:{" "}
									</span>
									{finding.recommendation}
								</div>
							) : null}
						</div>
					</article>
				))}
			</div>
		</section>
	);
}
