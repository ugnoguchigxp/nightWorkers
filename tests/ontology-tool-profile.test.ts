import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
	resolveOntologyToolProfile,
} from "../api/modules/ontology";
import { projectSecurityIntelligenceSettingsSchema } from "../shared/schemas/ontology.schema";

describe("ontology tool profile eligibility", () => {
	it.each([
		[49_999, "standard", false, "below_threshold"],
		[50_000, "ontology_extended", true, "enabled"],
		[50_001, "ontology_extended", true, "enabled"],
	] as const)("uses measured source LOC %s for profile selection", (sourceLoc, profile, eligible, reason) => {
		const result = resolveOntologyToolProfile({
			settings: DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
			measuredSourceLoc: sourceLoc,
		});
		expect(result).toMatchObject({
			measuredSourceLoc: sourceLoc,
			toolProfile: profile,
			eligible,
			reason,
		});
	});

	it("keeps standard tools when an eligible project disables ontology tools", () => {
		expect(
			resolveOntologyToolProfile({
				settings: {
					...DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
					ontologyToolsEnabled: false,
				},
				measuredSourceLoc: 50_000,
			}),
		).toMatchObject({
			eligible: true,
			effectiveEnabled: false,
			toolProfile: "standard",
			reason: "user_disabled",
		});
	});

	it("fails closed to standard when measurement is unavailable", () => {
		expect(
			resolveOntologyToolProfile({
				settings: DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
				measuredSourceLoc: Number.NaN,
			}),
		).toMatchObject({
			measuredSourceLoc: null,
			eligible: false,
			toolProfile: "standard",
			reason: "measurement_unavailable",
		});
	});

	it("rejects unknown and invalid project settings", () => {
		expect(
			projectSecurityIntelligenceSettingsSchema.safeParse({
				ontologyToolsEnabled: true,
				securityMaxIterations: 0,
			}).success,
		).toBe(false);
		expect(
			projectSecurityIntelligenceSettingsSchema.safeParse({
				ontologyToolsEnabled: true,
				securityMaxIterations: 3,
				apiKey: "must-not-be-accepted",
			}).success,
		).toBe(false);
	});
});
