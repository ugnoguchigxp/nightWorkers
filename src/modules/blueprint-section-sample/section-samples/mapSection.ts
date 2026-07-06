import type { SectionSampleDefinition } from "./types";

export const mapSectionSample: SectionSampleDefinition = {
	name: "MapSection",
	props: ({ base }) => ({
		...base,
		title: "Nearby locations",
		description: "Store, office, or route points shown on a map preview.",
		searchPlaceholder: "Search area or address",
		locations: [
			{ title: "Central station", category: "Transit", distance: "0.4 km" },
			{ title: "North office", category: "Workspace", distance: "1.2 km" },
			{ title: "Customer pickup", category: "Route stop", distance: "2.8 km" },
		],
	}),
};
