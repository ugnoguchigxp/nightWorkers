import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { OverviewDashboard as OverviewDashboardData } from "../../../shared/schemas/overview.schema";
import type { ProjectDetailTab } from "../nightworkers/components/project-detail/types";
import type { OverviewRange } from "../nightworkers/routing/workbench-route-state";
import type { Repository } from "../nightworkers/types";
import {
	OverviewContextBar,
	ProjectSnapshotPanel,
} from "./components/OverviewContextSections";
import { OverviewHeader } from "./components/OverviewHeader";
import { OverviewMetrics } from "./components/OverviewMetrics";
import { EmptyState } from "./components/OverviewPrimitives";
import { OverviewTables } from "./components/OverviewTables";
import { OverviewUsageSections } from "./components/OverviewUsageSections";
import { overviewShellStyle } from "./overviewStyles";
import { buildOverviewViewModel } from "./overviewViewModel";
import {
	isOverviewDashboardForScope,
	useOverviewDashboard,
} from "./useOverviewDashboard";

type OverviewScreenProps = {
	projects: Repository[];
	range: OverviewRange;
	projectFilterId: string | null;
	onRangeChange: (range: OverviewRange) => void;
	onProjectFilterChange: (projectId: string | null) => void;
	onOpenProjectDetailTab: (
		projectId: string,
		tab: Exclude<ProjectDetailTab, "overview">,
	) => void;
	onOpenSession: (sessionId: string) => void;
	onOpenFxSettings: () => void;
};

export function OverviewDashboard({
	projects,
	range,
	projectFilterId,
	onRangeChange,
	onProjectFilterChange,
	onOpenProjectDetailTab,
	onOpenSession,
	onOpenFxSettings,
}: OverviewScreenProps) {
	const { t } = useTranslation();
	const { dashboard, isLoading, error, refresh, startupWarnings } =
		useOverviewDashboard({ range, projectFilterId });
	const scopedDashboard = isOverviewDashboardForScope(dashboard, {
		range,
		projectFilterId,
	})
		? dashboard
		: null;
	const selectedProject = projectFilterId
		? (projects.find((project) => project.id === projectFilterId) ?? null)
		: null;
	const projectName =
		scopedDashboard?.projectContext?.repository.name ??
		selectedProject?.name ??
		null;
	const viewModel = useMemo(
		() => (scopedDashboard ? buildOverviewViewModel(scopedDashboard) : null),
		[scopedDashboard],
	);

	return (
		<div
			className="nightworkers-scrollbar h-full min-h-0 overflow-y-auto p-4"
			style={overviewShellStyle}
			aria-busy={isLoading && !scopedDashboard}
		>
			<div className="mx-auto max-w-7xl space-y-4">
				<OverviewHeader
					projects={projects}
					range={range}
					projectFilterId={projectFilterId}
					projectName={projectName}
					isLoading={isLoading}
					onRangeChange={onRangeChange}
					onProjectFilterChange={onProjectFilterChange}
					onOpenProjectDetailTab={(tab) => {
						if (projectFilterId) onOpenProjectDetailTab(projectFilterId, tab);
					}}
					onRefresh={() => void refresh()}
				/>

				{error ? <OverviewError message={error} /> : null}
				{startupWarnings.map((warning) => (
					<StartupWarning key={warning.id} warning={warning} />
				))}

				{scopedDashboard && viewModel ? (
					<OverviewContent
						dashboard={scopedDashboard}
						viewModel={viewModel}
						range={range}
						onOpenSession={onOpenSession}
						onOpenFxSettings={onOpenFxSettings}
					/>
				) : error ? null : (
					<EmptyState
						text={isLoading ? t("overview.loading") : t("overview.empty")}
					/>
				)}
			</div>
		</div>
	);
}

export const OverviewScreen = OverviewDashboard;

function OverviewContent({
	dashboard,
	viewModel,
	range,
	onOpenSession,
	onOpenFxSettings,
}: {
	dashboard: OverviewDashboardData;
	viewModel: ReturnType<typeof buildOverviewViewModel>;
	range: OverviewRange;
	onOpenSession: (sessionId: string) => void;
	onOpenFxSettings: () => void;
}) {
	const language = dashboard.settings.language;
	const timezone = dashboard.scope.timezone;
	const currency = dashboard.scope.currency;
	return (
		<>
			<OverviewContextBar
				projectContext={dashboard.projectContext}
				range={range}
				activeProvider={dashboard.settings.activeProvider}
				activeModel={dashboard.settings.activeModel}
			/>
			<OverviewMetrics
				dashboard={dashboard}
				viewModel={viewModel}
				language={language}
				currency={currency}
			/>
			{dashboard.projectContext ? (
				<ProjectSnapshotPanel
					context={dashboard.projectContext}
					language={language}
					timezone={timezone}
				/>
			) : null}
			<OverviewUsageSections
				dashboard={dashboard}
				viewModel={viewModel}
				range={range}
				language={language}
				timezone={timezone}
				currency={currency}
				onOpenFxSettings={onOpenFxSettings}
			/>
			<OverviewTables
				dashboard={dashboard}
				language={language}
				timezone={timezone}
				currency={currency}
				onOpenSession={onOpenSession}
			/>
		</>
	);
}

function OverviewError({ message }: { message: string }) {
	return (
		<div
			className="border p-3 text-xs"
			style={{
				background: "color-mix(in srgb, var(--nw-danger) 10%, var(--nw-panel))",
				borderColor:
					"color-mix(in srgb, var(--nw-danger) 45%, var(--nw-border))",
				borderRadius: "var(--nw-radius)",
				color: "var(--nw-danger)",
			}}
		>
			{message}
		</div>
	);
}

function StartupWarning({
	warning,
}: {
	warning: { label: string; detail: string };
}) {
	return (
		<div
			role="alert"
			className="flex items-start gap-3 border p-3 text-xs"
			style={{
				background:
					"color-mix(in srgb, var(--nw-warning) 10%, var(--nw-panel))",
				borderColor:
					"color-mix(in srgb, var(--nw-warning) 45%, var(--nw-border))",
				borderRadius: "var(--nw-radius)",
				color: "var(--nw-warning)",
			}}
		>
			<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
			<div>
				<div className="font-semibold">{warning.label}</div>
				<div className="mt-1 opacity-90">{warning.detail}</div>
			</div>
		</div>
	);
}
