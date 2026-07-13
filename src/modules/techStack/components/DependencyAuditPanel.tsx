import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
	ProjectDependencyAuditResult,
	ProjectDependencyAuditSeverity,
} from "../../../../shared/schemas/tech-stack.schema";

const panelStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-radius)",
	boxShadow: "var(--nw-shadow)",
	color: "var(--nw-text)",
};
const subtleStyle = { color: "var(--nw-subtle-text)" };

function severityColor(severity: ProjectDependencyAuditSeverity) {
	if (severity === "critical") return "var(--nw-danger)";
	if (severity === "high") return "#f97316";
	if (severity === "moderate") return "#d97706";
	return "var(--nw-subtle-text)";
}

export function DependencyAuditPanel({
	packageManager,
	result,
	busy,
	onRefresh,
}: {
	packageManager: string | null;
	result: ProjectDependencyAuditResult | null;
	busy: boolean;
	onRefresh?: () => void;
}) {
	const { t } = useTranslation();
	const supported = packageManager?.split("@")[0] === "bun";
	const hasFindings = Boolean(result && result.counts.total > 0);
	return (
		<section className="overflow-hidden border" style={panelStyle}>
			<div
				className="flex flex-wrap items-center justify-between gap-3 border-b p-3"
				style={{ borderColor: "var(--nw-border)" }}
			>
				<div>
					<h3 className="flex items-center gap-2 text-xs font-semibold">
						{hasFindings ? (
							<ShieldAlert className="h-4 w-4" />
						) : (
							<ShieldCheck className="h-4 w-4" />
						)}
						{t("techStack.audit.title")}
					</h3>
					<p className="mt-1 text-[11px]" style={subtleStyle}>
						{t("techStack.audit.description")}
					</p>
				</div>
				<button
					type="button"
					disabled={!supported || busy || !onRefresh}
					onClick={onRefresh}
					className="inline-flex h-8 items-center gap-2 border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
					style={{
						borderColor: "var(--nw-border)",
						borderRadius: "var(--nw-control-radius)",
					}}
				>
					<RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
					{busy
						? t("techStack.audit.running")
						: result
							? t("techStack.audit.refresh")
							: t("techStack.audit.fetch")}
				</button>
			</div>
			{!supported ? (
				<p className="p-3 text-xs" style={subtleStyle}>
					{t("techStack.audit.unsupported")}
				</p>
			) : !result ? (
				<p className="p-3 text-xs" style={subtleStyle}>
					{t("techStack.audit.empty")}
				</p>
			) : (
				<div className="space-y-3 p-3">
					<div className="flex flex-wrap items-center gap-3 text-xs">
						<strong>
							{result.counts.total === 0
								? t("techStack.audit.clean")
								: t("techStack.audit.findings", {
										count: result.counts.total,
									})}
						</strong>
						{(["critical", "high", "moderate", "low"] as const).map(
							(severity) =>
								result.counts[severity] > 0 ? (
									<span
										key={severity}
										style={{ color: severityColor(severity) }}
									>
										{t(`techStack.audit.severity.${severity}`)}{" "}
										{result.counts[severity]}
									</span>
								) : null,
						)}
						<span style={subtleStyle}>
							{t("techStack.audit.auditedAt")}:{" "}
							{new Date(result.auditedAt).toLocaleString()}
						</span>
					</div>
					{result.findings.length > 0 ? (
						<div className="nightworkers-scrollbar max-h-72 space-y-2 overflow-y-auto">
							{result.findings.map((finding) => (
								<div
									key={`${finding.packageName}:${finding.advisoryId}`}
									className="border p-2 text-xs"
									style={{ borderColor: "var(--nw-border)" }}
								>
									<div className="flex flex-wrap items-center gap-2">
										<strong>{finding.packageName}</strong>
										<span style={{ color: severityColor(finding.severity) }}>
											{t(`techStack.audit.severity.${finding.severity}`)}
										</span>
										{finding.vulnerableVersions ? (
											<code>{finding.vulnerableVersions}</code>
										) : null}
									</div>
									<div className="mt-1">
										{finding.url ? (
											<a
												href={finding.url}
												target="_blank"
												rel="noreferrer"
												className="underline"
											>
												{finding.title}
											</a>
										) : (
											finding.title
										)}
									</div>
								</div>
							))}
						</div>
					) : null}
				</div>
			)}
		</section>
	);
}
