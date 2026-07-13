import { Code2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
	ProjectCodeSizeSnapshot,
	ProjectDependencyAuditResult,
	ProjectStackProfile,
} from "../../../../shared/schemas/tech-stack.schema";
import { DependencyAuditPanel } from "./DependencyAuditPanel";
import { ProjectCodeSizePanel } from "./ProjectCodeSizePanel";
import { StackSummaryBadge } from "./StackSummaryBadge";

const panelStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-radius)",
	boxShadow: "var(--nw-shadow)",
	color: "var(--nw-text)",
};
const subtleStyle = { color: "var(--nw-subtle-text)" };

function Kpi({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub: string;
}) {
	return (
		<div className="border p-3" style={panelStyle}>
			<div className="text-[10px] font-semibold uppercase" style={subtleStyle}>
				{label}
			</div>
			<div className="mt-2 truncate text-xl font-bold" title={value}>
				{value}
			</div>
			<div className="mt-1 truncate text-[11px]" style={subtleStyle}>
				{sub}
			</div>
		</div>
	);
}

export function TechStackPanel({
	stackProfile,
	projectPath,
	codeSizeSnapshot,
	currentGitHead,
	measurementBusy,
	onMeasureCodeSize,
	dependencyAuditResult = null,
	dependencyAuditBusy = false,
	onRefreshDependencyAudit,
}: {
	stackProfile: ProjectStackProfile;
	projectPath: string;
	codeSizeSnapshot: ProjectCodeSizeSnapshot | null;
	currentGitHead: string | null;
	measurementBusy: boolean;
	onMeasureCodeSize: () => void;
	dependencyAuditResult?: ProjectDependencyAuditResult | null;
	dependencyAuditBusy?: boolean;
	onRefreshDependencyAudit?: () => void;
}) {
	const { t } = useTranslation();
	const summary = stackProfile.summary || t("techStack.profile.unknown");
	return (
		<section className="space-y-3">
			<div className="flex justify-end">
				<StackSummaryBadge stackProfile={stackProfile} />
			</div>
			<div className="grid gap-3 md:grid-cols-3">
				<Kpi
					label={t("techStack.profile.summary")}
					value={summary}
					sub={t("techStack.profile.summarySub")}
				/>
				<Kpi
					label={t("techStack.profile.packageManager")}
					value={stackProfile.packageManager || "—"}
					sub={t("techStack.profile.packageManagerSub")}
				/>
				<Kpi
					label={t("techStack.profile.manifest")}
					value={t(
						`techStack.profile.manifestStatus.${stackProfile.manifestStatus}`,
					)}
					sub={projectPath}
				/>
			</div>
			<DependencyAuditPanel
				packageManager={stackProfile.packageManager}
				result={dependencyAuditResult}
				busy={dependencyAuditBusy}
				onRefresh={onRefreshDependencyAudit}
			/>
			<ProjectCodeSizePanel
				snapshot={codeSizeSnapshot}
				currentGitHead={currentGitHead}
				busy={measurementBusy}
				onMeasure={onMeasureCodeSize}
			/>
			<div className="overflow-hidden border" style={panelStyle}>
				<div
					className="flex items-center gap-2 border-b p-3 text-xs font-semibold"
					style={{ borderColor: "var(--nw-border)" }}
				>
					<Code2 className="h-4 w-4" />
					{t("techStack.profile.detectedTechnologies")}
				</div>
				<div className="nightworkers-scrollbar overflow-auto">
					<table className="w-full min-w-[760px] text-xs">
						<thead style={subtleStyle}>
							<tr>
								<th className="py-2 pl-4 text-left">
									{t("techStack.profile.field.technology")}
								</th>
								<th className="py-2 text-left">
									{t("techStack.profile.field.category")}
								</th>
								<th className="py-2 text-left">
									{t("techStack.profile.field.source")}
								</th>
								<th className="py-2 text-left">
									{t("techStack.profile.field.version")}
								</th>
								<th className="py-2 pr-4 text-right">
									{t("techStack.profile.field.confidence")}
								</th>
							</tr>
						</thead>
						<tbody>
							{stackProfile.technologies.length > 0 ? (
								stackProfile.technologies.map((technology) => (
									<tr
										key={`${technology.name}:${technology.packageName ?? technology.source}`}
										className="border-t"
										style={{ borderColor: "var(--nw-border)" }}
									>
										<td className="py-3 pl-4">
											<div className="font-semibold">{technology.name}</div>
											<div className="text-[10px]" style={subtleStyle}>
												{technology.packageName || "—"}
											</div>
										</td>
										<td className="py-3">
											{t(`techStack.profile.category.${technology.category}`)}
										</td>
										<td className="py-3">
											{t(`techStack.profile.source.${technology.source}`)}
										</td>
										<td className="py-3 font-mono">
											{technology.version || "—"}
										</td>
										<td className="py-3 pr-4 text-right">
											{t(
												`techStack.profile.confidence.${technology.confidence}`,
											)}
										</td>
									</tr>
								))
							) : (
								<tr
									className="border-t"
									style={{ borderColor: "var(--nw-border)" }}
								>
									<td
										colSpan={5}
										className="px-4 py-6 text-center"
										style={subtleStyle}
									>
										{t("techStack.profile.empty")}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}
