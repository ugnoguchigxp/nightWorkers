import { describe, expect, it } from "vitest";
import { validateCorrectionResult } from "../api/modules/missionPilot/mission-pilot-artifact-correction.service";

const target = {
	target: "blueprint" as const,
	sourceMessageId: "00000000-0000-4000-8000-000000000001",
	focus: { kind: "screen" as const, screenIds: ["main"] },
	instruction: "Fix main",
	preserveUnfocusedContent: true,
};

const sourceMetadata = {
	mockBlueprint: {
		screens: [
			{ id: "main", sections: [{ id: "main-list", copy: "Old" }] },
			{ id: "settings", sections: [{ id: "settings-form", copy: "Keep" }] },
		],
	},
};

describe("Mission Pilot Artifact correction validation", () => {
	it("accepts a focused Blueprint result that preserves other screens", () => {
		expect(() =>
			validateCorrectionResult(target, sourceMetadata, {
				mockBlueprint: {
					screens: [
						{ id: "main", sections: [{ id: "main-list", copy: "New" }] },
						{
							id: "settings",
							sections: [{ id: "settings-form", copy: "Keep" }],
						},
					],
				},
			}),
		).not.toThrow();
	});

	it("allows copy changes outside the focused Blueprint screen", () => {
		expect(() =>
			validateCorrectionResult(target, sourceMetadata, {
				mockBlueprint: {
					screens: [
						{ id: "main", sections: [{ id: "main-list", copy: "New" }] },
						{
							id: "settings",
							sections: [{ id: "settings-form", copy: "Changed" }],
						},
					],
				},
			}),
		).not.toThrow();
	});

	it("rejects removal of an existing Blueprint section", () => {
		expect(() =>
			validateCorrectionResult(target, sourceMetadata, {
				mockBlueprint: {
					screens: [
						{ id: "main", sections: [{ id: "main-list", copy: "New" }] },
						{ id: "settings", sections: [] },
					],
				},
			}),
		).toThrow("removed section: settings-form");
	});
});
