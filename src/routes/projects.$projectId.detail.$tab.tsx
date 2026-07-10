import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchRoutePage } from "../modules/nightworkers/routing/WorkbenchRoutePage";
import { normalizeProjectDetailTab } from "../modules/nightworkers/routing/workbench-route-state";

export const Route = createFileRoute("/projects/$projectId/detail/$tab")({
	component: ProjectDetailTabRoute,
});

function ProjectDetailTabRoute() {
	const { projectId, tab } = Route.useParams();
	const normalizedTab = normalizeProjectDetailTab(tab);
	return (
		<WorkbenchRoutePage
			routeState={
				normalizedTab === "overview"
					? { kind: "overview", range: "30d", projectId }
					: { kind: "project_detail", projectId, tab: normalizedTab }
			}
		/>
	);
}
