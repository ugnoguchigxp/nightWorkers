import type { MockBlueprint } from "../../shared/schemas/mock-blueprint.schema";

export const representativeMockBlueprint: MockBlueprint = {
	artifactKind: "mock_blueprint",
	id: "mock-bp-fixture",
	name: "Operations Mock Console",
	version: 1,
	summary:
		"A lightweight mock preview for reviewing operational work before implementation.",
	tone: "calm operational workspace",
	meta: {
		intent: "Review operational work before implementation.",
		selectedSections: [
			{
				sectionType: "SidebarMenuSection",
				selectionReason:
					"Keep work queues, reviews, and settings visible while scanning.",
			},
			{
				sectionType: "AnalyticsDashboardSection",
				selectionReason:
					"Show aggregate status before the user opens individual work items.",
			},
			{
				sectionType: "DataTableSection",
				selectionReason:
					"Represent the primary repeated workflow as a compact table.",
			},
		],
	},
	screens: [
		{
			id: "operations-command-center",
			name: "Operations Command Center",
			path: "/",
			purpose:
				"Review the current workload and decide the next operational action.",
			layout: { template: "sidebar_left" },
			sections: [
				{
					id: "primary-navigation",
					name: "Primary Navigation",
					componentName: "SidebarMenuSection",
					region: "sidebar",
					selectionReason:
						"Keep work queues, reviews, and settings visible while scanning.",
					copy: {
						title: "Workspace",
						description:
							"Fast access to the operational areas used during review.",
					},
					dataset: {
						kind: "navigation",
						items: [
							{ label: "Queue", href: "/queue", active: true },
							{ label: "Reviews", href: "/reviews" },
							{ label: "Settings", href: "/settings" },
						],
					},
				},
				{
					id: "priority-signals",
					name: "Priority Signals",
					componentName: "AnalyticsDashboardSection",
					region: "main",
					selectionReason:
						"Show aggregate status before the user opens individual work items.",
					copy: {
						title: "Priority Signals",
						description: "The strongest signals for today's review pass.",
					},
					dataset: {
						kind: "metrics",
						metrics: [
							{ label: "Ready to review", value: "12", trend: "+3 today" },
							{ label: "Needs attention", value: "4", trend: "2 blocked" },
							{ label: "Approved", value: "18", trend: "stable" },
						],
					},
				},
				{
					id: "decision-queue",
					name: "Decision Queue",
					componentName: "DataTableSection",
					region: "main",
					selectionReason:
						"Represent the primary repeated workflow as a compact table.",
					copy: {
						title: "Decision Queue",
						description:
							"Work items that need confirmation before implementation can proceed.",
						primaryActionLabel: "Open item",
					},
					dataset: {
						kind: "table",
						columns: [
							{ key: "title", label: "Decision" },
							{ key: "status", label: "State" },
							{ key: "owner", label: "Owner" },
						],
						rows: [
							{
								title: "Approve launch copy",
								status: "Ready",
								owner: "Design",
							},
							{
								title: "Resolve intake ambiguity",
								status: "Needs attention",
								owner: "PM",
							},
							{
								title: "Confirm billing labels",
								status: "Review",
								owner: "Finance",
							},
							{ title: "Check import preview", status: "Ready", owner: "Ops" },
							{
								title: "Triage blocked signup",
								status: "Blocked",
								owner: "Support",
							},
						],
					},
				},
			],
		},
	],
	generationNotes: ["Focused on renderable sections and mock data only."],
};
