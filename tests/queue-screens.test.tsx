import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { ProjectQueueScreen } from "../src/modules/queue/ProjectQueueScreen";
import type { ProjectQueueScreenProps } from "../src/modules/queue/projectQueueTypes";

function createDummyProps(): ProjectQueueScreenProps {
	const project = { id: "repo-1", name: "NightWorkers" };
	const session = {
		id: "session-1",
		repositoryId: "repo-1",
		title: "Dummy Session Title",
		status: "ready",
		updatedAt: "2026-07-08T00:00:00Z",
	};
	return {
		project,
		sessions: [session],
		sessionViews: [
			{
				task: session,
				group: "queue",
				emailState: "queued",
				phase: "Queued",
			},
		],
		implementationQueue: {
			settings: { processorCount: 1 },
			processors: [{ slot: 0, entry: null }],
			queued: [],
			completed: [],
			notQueued: [],
		},
		isLoading: false,
		viewMode: "board",
		onViewModeChange: () => undefined,
		onOpenSession: () => undefined,
		onRequeueEntry: async () => undefined,
		onQueueSession: async () => undefined,
		onUpdateQueueEntry: async () => undefined,
	};
}

describe("ProjectQueueScreen", () => {
	it("renders project queue board with lanes", () => {
		const props = createDummyProps();
		const markup = renderToStaticMarkup(<ProjectQueueScreen {...props} />);

		expect(markup).toContain("Dummy Session Title");
		expect(markup).toContain("Implementation Queue");
	});

	it("renders project queue table view", () => {
		const props = createDummyProps();
		props.viewMode = "table";
		const markup = renderToStaticMarkup(<ProjectQueueScreen {...props} />);

		expect(markup).toContain("Dummy Session Title");
		expect(markup).toContain("Status");
	});
});
