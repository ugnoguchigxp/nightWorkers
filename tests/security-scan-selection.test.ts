import { describe, expect, it } from "vitest";
import type { SecurityScanCapabilities } from "../shared/schemas/security-scan.schema";
import { preferredSecurityScanSelection } from "../src/modules/securityScan/securityScanSelection";

function capabilitiesWithTargets(
	targets: Array<"working_tree" | "full">,
): SecurityScanCapabilities {
	return {
		provider: { id: "vulnworkbench", version: "cli-1" },
		project: { ref: "project", displayName: "Project" },
		presets: [
			{
				id: "standard",
				displayName: "Standard",
				description: "Standard scan",
				recommended: true,
				targets: targets.map((kind) => ({
					kind,
					profileRef: "agent-output",
					estimatedDurationSeconds: { min: 1, max: 2 },
					toolCategories: ["static"],
					warnings: [],
				})),
			},
		],
		selectableProfiles: [],
		limits: {
			maxConcurrentScansForClient: 1,
			maxFindingPageSize: 100,
			maxEventPageSize: 1,
			maxReportBytes: 5 * 1024 * 1024,
		},
	};
}

describe("preferred security scan selection", () => {
	it("selects full when the local CLI preset does not support working_tree", () => {
		expect(
			preferredSecurityScanSelection(capabilitiesWithTargets(["full"])),
		).toEqual({
			selection: { mode: "preset", presetId: "standard" },
			target: { kind: "full" },
		});
	});

	it("keeps working_tree preferred for HTTP providers that support it", () => {
		expect(
			preferredSecurityScanSelection(
				capabilitiesWithTargets(["full", "working_tree"]),
			)?.target,
		).toEqual({ kind: "working_tree" });
	});
});
