import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { readLastWorkbenchRoute } from "../modules/nightworkers/routing/last-workbench-route";
import { parseWorkbenchRouteUrl } from "../modules/nightworkers/routing/workbench-route-state";

export const Route = createFileRoute("/")({
	component: NightWorkersRootRedirect,
});

function NightWorkersRootRedirect() {
	const navigate = useNavigate();

	useEffect(() => {
		const target = readLastWorkbenchRoute() || "/overview";
		const nextUrl = parseWorkbenchRouteUrl(target);
		void navigate({
			to: nextUrl.pathname,
			search: nextUrl.search,
			replace: true,
		} as never);
	}, [navigate]);

	return null;
}
