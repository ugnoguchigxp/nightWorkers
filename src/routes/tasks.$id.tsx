import { createFileRoute } from "@tanstack/react-router";
import { TaskConsolePage } from "@/modules/nightworkers/components/TaskConsolePage";

function TaskRouteComponent() {
	const { id } = Route.useParams();
	return <TaskConsolePage id={id} />;
}

export const Route = createFileRoute("/tasks/$id")({
	component: TaskRouteComponent,
});
