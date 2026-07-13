import { describe, expect, it } from "vitest";
import { attachArtifactCorrectionRequests } from "../api/modules/missionPilot/mission-pilot-execution-query.service";

describe("Mission Pilot execution query", () => {
	it("backfills persisted correction instructions into existing activity events", () => {
		const [event] = attachArtifactCorrectionRequests(
			[
				{
					id: "activity-1",
					payloadJson: {
						correctionRunId: "correction-run-1",
						target: "feature_plan",
					},
				},
			],
			[
				{
					id: "correction-run-1",
					target: "feature_plan",
					focusJson: { kind: "artifact" },
					instruction:
						"HTTP APIの入力・出力・エラー検証はapi_io_contractを正本として扱ってください。",
					preserveUnfocusedContent: true,
				},
			],
		);

		expect(event?.payloadJson).toMatchObject({
			correctionRunId: "correction-run-1",
			correctionRequest: {
				target: "feature_plan",
				focus: { kind: "artifact" },
				instruction:
					"HTTP APIの入力・出力・エラー検証はapi_io_contractを正本として扱ってください。",
				preserveUnfocusedContent: true,
			},
		});
	});

	it("keeps an event payload unchanged when no correction run matches", () => {
		const original = {
			id: "activity-2",
			payloadJson: { correctionRunId: "missing-run" },
		};
		const [event] = attachArtifactCorrectionRequests([original], []);

		expect(event).toBe(original);
	});
});
