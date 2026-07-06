import type { SectionSampleDefinition } from "./types";

export const emailInboxSectionSample: SectionSampleDefinition = {
	name: "EmailInboxSection",
	props: ({ base }) => ({
		...base,
		searchPlaceholder: "Search mail",
		messages: [
			{
				sender: "Design Review",
				subject: "Blueprint section updates",
				time: "09:42",
			},
			{ sender: "Billing", subject: "Payment receipt is ready", time: "08:15" },
			{
				sender: "Ops Team",
				subject: "Map locations imported",
				time: "Yesterday",
			},
			{
				sender: "Support",
				subject: "New comment on implementation plan",
				time: "Mon",
			},
		],
	}),
};
