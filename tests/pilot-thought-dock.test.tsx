import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PilotThoughtDock } from "../src/modules/missionPilot/components/PilotThoughtDock";

describe("PilotThoughtDock", () => {
	it("renders persisted Pilot decisions and tool events in a chat dock", () => {
		const markup = renderToStaticMarkup(
			<PilotThoughtDock
				session={{
					id: "task-1",
					repositoryId: "repo-1",
					title: "Mission Pilot task",
					status: "running",
					timeoutSeconds: 3600,
					priority: 0,
					createdAt: new Date(),
					updatedAt: new Date(),
				}}
				activityEvents={[
					{
						id: "activity-1",
						taskId: "task-1",
						seq: 1,
						kind: "runtime.decision",
						source: "mission_pilot",
						text: "20秒間、ユーザーの変更を待ちます。",
						payloadJson: { decision: "wait_for_user_or_auto_submit" },
						visibility: "visible",
						createdAt: new Date("2026-07-11T10:00:00Z"),
					},
				]}
				runEvents={[
					{
						id: "event-1",
						eventType: "tool.call",
						actor: "tool",
						message: "repositoryを確認しています",
						payloadJson: { toolName: "exec_command" },
						createdAt: new Date("2026-07-11T10:00:01Z"),
					},
				]}
				onClose={vi.fn()}
			/>,
		);

		expect(markup).toContain("nightworkers-chat-dock");
		expect(markup).not.toContain("nightworkers-message-bubble");
		expect(markup).toContain("w-full border-slate-700/80 border-b");
		expect(markup).toContain("nightworkers-debug-payload");
		expect(markup).toContain("<details");
		expect(markup).not.toContain("<details open");
		expect(markup).toContain("Pilot thought");
		expect(markup).toContain("20秒間、ユーザーの変更を待ちます。");
		expect(markup).toContain("repositoryを確認しています");
		expect(markup).toContain("exec_command");
	});
});
