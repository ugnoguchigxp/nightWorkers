import type { SectionSampleContext } from "./types";

export function navigationSample({ base }: SectionSampleContext) {
	return {
		...base,
		brand: "NightWorkers",
		searchPlaceholder: "Search sections",
		links: [
			{ label: "Overview", href: "/overview", badge: "Home" },
			{ label: "Runs", href: "/runs", badge: "12" },
			{ label: "Blueprints", href: "/blueprints", badge: "New" },
			{ label: "Settings", href: "/settings" },
		],
		tabs: ["Overview", "Activity", "Artifacts", "Blueprint"],
		groups: [
			{
				title: "Workspace",
				links: [
					{ label: "Dashboard", badge: "3" },
					{ label: "Projects" },
					{ label: "Runs", badge: "12" },
				],
			},
			{
				title: "Build",
				links: [
					{ label: "Blueprints" },
					{ label: "Artifacts" },
					{ label: "Reviews" },
				],
			},
		],
		tree: [
			{
				label: "app",
				children: [
					{ label: "routes" },
					{ label: "components" },
					{ label: "blueprint-showcase.tsx", type: "file" },
				],
			},
			{
				label: "api",
				children: [{ label: "services" }, { label: "schemas" }],
			},
		],
		footerColumns: [
			{ title: "Product", links: ["Overview", "Blueprints", "Runs"] },
			{ title: "Resources", links: ["Docs", "Examples", "Changelog"] },
			{ title: "Support", links: ["Settings", "Logs", "Status"] },
		],
	};
}
