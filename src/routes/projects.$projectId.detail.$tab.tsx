import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchRoutePage } from "../modules/nightworkers/routing/WorkbenchRoutePage";
import { normalizeProjectDetailTab } from "../modules/nightworkers/routing/workbench-route-state";

export const Route = createFileRoute("/projects/$projectId/detail/$tab")({
	component: ProjectDetailTabRoute,
});

function ProjectDetailTabRoute() {
	const { projectId, tab } = Route.useParams();
	return (
		<WorkbenchRoutePage
			routeState={{
				kind: "project_detail",
				projectId,
				tab: normalizeProjectDetailTab(tab),
			}}
		/>
	);
}
