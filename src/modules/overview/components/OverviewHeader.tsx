import { BarChart3, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { handleWorkbenchAnchorClick } from "../../nightworkers/routing/workbench-link-click";
import {
	type OverviewRange,
	serializeWorkbenchRoute,
} from "../../nightworkers/routing/workbench-route-state";
import type { Repository } from "../../nightworkers/types";
import {
	controlStyle,
	mutedTextStyle,
	primaryTextStyle,
} from "../overviewStyles";
import { ProjectScopeNavigation } from "./ProjectScopeNavigation";

export function OverviewHeader({
	projects,
	range,
	projectFilterId,
	projectName,
	isLoading,
	onRangeChange,
	onProjectFilterChange,
	onOpenProjectDetailTab,
	onRefresh,
}: {
	projects: Repository[];
	range: OverviewRange;
	projectFilterId: string | null;
	projectName: string | null;
	isLoading: boolean;
	onRangeChange: (range: OverviewRange) => void;
	onProjectFilterChange: (projectId: string | null) => void;
	onOpenProjectDetailTab: (
		tab: "mission" | "evaluation" | "quality" | "stack" | "worktrees",
	) => void;
	onRefresh: () => void;
}) {
	const { t } = useTranslation();
	const selectedProjectIsListed = projectFilterId
		? projects.some((project) => project.id === projectFilterId)
		: true;
	return (
		<header className="flex flex-wrap items-center justify-between gap-4">
			{projectFilterId ? (
				<ProjectScopeNavigation
					projectId={projectFilterId}
					activeTab="overview"
					range={range}
					showDivider={false}
					onTabChange={(tab) => {
						if (tab !== "overview") onOpenProjectDetailTab(tab);
					}}
				/>
			) : (
				<div>
					<h1 className="flex items-center gap-2 text-xl font-bold">
						<BarChart3 className="h-5 w-5" style={primaryTextStyle} />
						{t("overview.title")}
					</h1>
					<p className="mt-1 text-xs" style={mutedTextStyle}>
						{t("overview.subtitle")}
					</p>
				</div>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<select
					aria-label={t("overview.filter.allProjects")}
					value={projectFilterId || "all"}
					onChange={(event) =>
						onProjectFilterChange(
							event.target.value === "all" ? null : event.target.value,
						)
					}
					className="h-9 border px-3 text-xs"
					style={controlStyle}
				>
					<option value="all">{t("overview.filter.allProjects")}</option>
					{projectFilterId && !selectedProjectIsListed ? (
						<option value={projectFilterId}>
							{projectName || projectFilterId}
						</option>
					) : null}
					{projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.name}
						</option>
					))}
				</select>
				{(["24h", "7d", "30d", "all"] as const).map((value) => (
					<a
						key={value}
						href={serializeWorkbenchRoute({
							kind: "overview",
							range: value,
							projectId: projectFilterId,
						})}
						onClick={(event) =>
							handleWorkbenchAnchorClick(event, () => onRangeChange(value))
						}
						className="inline-flex h-9 items-center border px-3 text-xs"
						aria-current={range === value ? "page" : undefined}
						style={
							range === value
								? {
										background:
											"color-mix(in srgb, var(--nw-primary) 14%, var(--nw-panel))",
										borderColor: "var(--nw-primary)",
										borderRadius: "var(--nw-control-radius)",
										color: "var(--nw-primary)",
									}
								: controlStyle
						}
					>
						{t(`overview.range.${value}`)}
					</a>
				))}
				<Button
					type="button"
					variant="ghost"
					className="h-9 px-3 text-xs"
					style={{ color: "var(--nw-text)" }}
					onClick={onRefresh}
				>
					<RefreshCw
						className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
					/>
					{t("overview.action.refresh")}
				</Button>
			</div>
		</header>
	);
}
