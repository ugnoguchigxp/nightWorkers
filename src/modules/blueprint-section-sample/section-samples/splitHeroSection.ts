import type { SectionSampleDefinition } from "./types";

export const splitHeroSectionSample: SectionSampleDefinition = {
	name: "SplitHeroSection",
	props: ({ base, sampleImage }) => ({
		...base,
		headline: "Coordinate work across teams",
		description:
			"A focused hero layout with one primary message, clear actions, and a visual area for product context.",
		highlights: ["Primary message", "Supporting context", "Responsive media"],
		primaryCta: { label: "Get started" },
		secondaryCta: { label: "View details" },
		imageUrl: sampleImage,
	}),
};
