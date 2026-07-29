import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { DevErrorPanel } from "../components/DevErrorPanel";

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	errorComponent: DevErrorPanel,
	component: () => {
		return (
			<div className="min-h-screen bg-[#141416]">
				<main>
					<Outlet />
				</main>
			</div>
		);
	},
});
