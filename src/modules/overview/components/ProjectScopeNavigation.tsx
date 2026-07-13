import { useTranslation } from "react-i18next";
import {
	type ProjectDetailTab,
	projectDetailTabs,
} from "../../nightworkers/components/project-detail/types";
import { handleWorkbenchAnchorClick } from "../../nightworkers/routing/workbench-link-click";
import {
	type OverviewRange,
	serializeWorkbenchRoute,
} from "../../nightworkers/routing/workbench-route-state";

export function ProjectScopeNavigation({
	projectId,
	activeTab,
	range = "30d",
	onTabChange,
}: {
	projectId: string;
	activeTab: ProjectDetailTab;
	range?: OverviewRange;
	onTabChange: (tab: ProjectDetailTab) => void;
}) {
	const { t } = useTranslation();
	return (
		<nav
			className="flex flex-wrap gap-1 text-xs"
			aria-label={t("overview.projectNavigation")}
		>
			{projectDetailTabs.map((tab) => {
				const href =
					tab.id === "overview"
						? serializeWorkbenchRoute({
								kind: "overview",
								projectId,
								range,
							})
						: serializeWorkbenchRoute({
								kind: "project_detail",
								projectId,
								tab: tab.id,
							});
				const active = tab.id === activeTab;
				return (
					<a
						key={tab.id}
						href={href}
						onClick={(event) =>
							handleWorkbenchAnchorClick(event, () => onTabChange(tab.id))
						}
						className="inline-flex h-8 items-center border px-3 font-medium"
						aria-current={active ? "page" : undefined}
						style={
							active
								? {
										background:
											"color-mix(in srgb, var(--nw-primary) 14%, var(--nw-panel))",
										borderColor: "var(--nw-primary)",
										borderRadius: "var(--nw-control-radius)",
										color: "var(--nw-primary)",
									}
								: {
										background: "var(--nw-panel)",
										borderColor: "var(--nw-border)",
										borderRadius: "var(--nw-control-radius)",
										color: "var(--nw-text)",
									}
						}
					>
						{t(tab.labelKey)}
					</a>
				);
			})}
		</nav>
	);
}
