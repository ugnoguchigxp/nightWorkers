import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchRoutePage } from "../modules/nightworkers/routing/WorkbenchRoutePage";

export const Route = createFileRoute("/queue")({
	validateSearch: (search: Record<string, unknown>) => search,
	component: QueueRoute,
});

function QueueRoute() {
	const search = Route.useSearch();
	return (
		<WorkbenchRoutePage
			routeState={{
				kind: "global_queue",
				projectId:
					typeof search.projectId === "string" ? search.projectId : null,
			}}
		/>
	);
}
