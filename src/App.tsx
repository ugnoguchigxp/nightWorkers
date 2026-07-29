import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { DesktopNavigationBar } from "./components/DesktopNavigationBar";
import { AppI18nProvider } from "./i18n/I18nProvider";
// Let tanstack router generate it dynamically if not exist
import { routeTree } from "./routeTree.gen";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
			refetchOnReconnect: false,
		},
	},
});

// Set up a Router instance
const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	context: {
		queryClient,
	},
});

// Register things for typesafety
declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

function isDesktopApp() {
	return (
		typeof window !== "undefined" &&
		Boolean(window.__NIGHTWORKERS_DESKTOP_CONFIG__?.apiOrigin?.trim())
	);
}

export default function App() {
	const desktopApp = isDesktopApp();
	return (
		<QueryClientProvider client={queryClient}>
			<AppI18nProvider>
				{desktopApp ? (
					<div className="nightworkers-desktop-shell">
						<DesktopNavigationBar />
						<div className="nightworkers-desktop-content">
							<RouterProvider router={router} />
						</div>
					</div>
				) : (
					<RouterProvider router={router} />
				)}
			</AppI18nProvider>
		</QueryClientProvider>
	);
}
