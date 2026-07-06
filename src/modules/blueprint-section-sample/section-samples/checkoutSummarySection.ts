import type { SectionSampleDefinition } from "./types";

export const checkoutSummarySectionSample: SectionSampleDefinition = {
	name: "CheckoutSummarySection",
	props: ({ base }) => ({
		...base,
		entries: [
			{ title: "Blueprint setup", date: "Design service", amount: "$1,200" },
			{ title: "Implementation pass", date: "Agent run", amount: "$860" },
			{ title: "Validation", date: "Review gate", amount: "$420" },
		],
	}),
};
