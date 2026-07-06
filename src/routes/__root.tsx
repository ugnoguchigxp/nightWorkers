import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { DevErrorPanel } from "../components/DevErrorPanel";
import type { useAuth } from "../lib/auth";

interface RouterContext {
	queryClient: QueryClient;
	auth: ReturnType<typeof useAuth>;
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
