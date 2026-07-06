import type { SectionSampleDefinition } from "./types";

export const calendarSectionSample: SectionSampleDefinition = {
	name: "CalendarSection",
	props: ({ base }) => ({
		...base,
		monthLabel: "June 2026",
		events: [
			{ title: "Blueprint review", day: 15 },
			{ title: "Implementation", day: 16 },
			{ title: "Validation", day: 17 },
			{ title: "Adoption", day: 24 },
		],
	}),
};
