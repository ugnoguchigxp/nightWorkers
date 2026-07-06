import type { SectionSampleDefinition } from "./types";

export const notificationCenterSectionSample: SectionSampleDefinition = {
	name: "NotificationCenterSection",
	props: ({ base }) => ({
		...base,
		notifications: [
			{
				title: "Blueprint adopted",
				body: "This section is ready for planning.",
			},
			{ title: "Review requested", body: "Confirm layout and source binding." },
			{
				title: "Token settings changed",
				body: "Preview style has been updated.",
			},
		],
	}),
};
