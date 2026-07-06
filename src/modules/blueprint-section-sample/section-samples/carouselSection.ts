import type { SectionSampleDefinition } from "./types";

export const carouselSectionSample: SectionSampleDefinition = {
	name: "CarouselSection",
	props: ({ base, sampleCards, sampleImage }) => ({
		...base,
		items: sampleCards().map((item) => ({ ...item, imageUrl: sampleImage })),
	}),
};
