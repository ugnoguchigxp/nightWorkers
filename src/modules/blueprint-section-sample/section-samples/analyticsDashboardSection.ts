import type { SectionSampleDefinition } from "./types";

export const analyticsDashboardSectionSample: SectionSampleDefinition = {
	name: "AnalyticsDashboardSection",
	props: ({ base }) => ({
		...base,
		metrics: [
			{ label: "Save Products", value: "178+" },
			{ label: "Stock Products", value: "20+" },
			{ label: "Sales Products", value: "190+" },
			{ label: "Job Application", value: "12+" },
		],
	}),
};
