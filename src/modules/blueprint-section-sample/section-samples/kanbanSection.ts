import type { SectionSampleDefinition } from "./types";

export const kanbanSectionSample: SectionSampleDefinition = {
	name: "KanbanSection",
	props: ({ base }) => ({
		...base,
		boardLabel: "Implementation board",
		boardDescription: "Tasks are grouped by workflow status.",
		columns: [
			{
				title: "Draft",
				cards: [
					{ title: "Define section props", priority: "P1", assignee: "Design" },
					{ title: "Map sample data", priority: "P2", assignee: "Agent" },
					{ title: "Check copy", priority: "P3", assignee: "Review" },
				],
			},
			{
				title: "Preview",
				cards: [
					{
						title: "Check responsive layout",
						priority: "P2",
						assignee: "Frontend",
					},
					{ title: "Validate controls", priority: "P2", assignee: "QA" },
					{ title: "Confirm empty states", priority: "P3", assignee: "Review" },
				],
			},
			{
				title: "Ready",
				cards: [
					{ title: "Publish Blueprint", priority: "P3", assignee: "Owner" },
					{ title: "Queue implementation", priority: "P2", assignee: "Agent" },
					{ title: "Attach notes", priority: "P3", assignee: "PM" },
				],
			},
		],
	}),
};
