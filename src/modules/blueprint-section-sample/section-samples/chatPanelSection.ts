import type { SectionSampleDefinition } from "./types";

export const chatPanelSectionSample: SectionSampleDefinition = {
	name: "ChatPanelSection",
	props: ({ base }) => ({
		...base,
		messages: [
			{
				author: "Reviewer",
				body: "Can this section keep decision context with the Blueprint?",
				side: "left",
			},
			{
				author: "Agent",
				body: "Yes. Messages can carry review notes and adoption status.",
				side: "right",
			},
			{ author: "System", body: "DB bindings were updated.", side: "left" },
		],
	}),
};
