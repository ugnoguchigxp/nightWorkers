import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
	readProjectSecurityIntelligenceSettings,
	resolveSecurityIntelligenceProfile,
} from "../api/modules/ontology";
import { projectSecurityIntelligenceSettingsSchema } from "../shared/schemas/ontology.schema";

describe("security intelligence eligibility", () => {
	it.each([
		[49_999, false, "standard", "below_threshold"],
		[50_000, true, "ontology_extended", "enabled"],
		[50_001, true, "ontology_extended", "enabled"],
	] as const)("uses measured source LOC %s for both Security Oracle and ontology", (sourceLoc, enabled, profile, reason) => {
		const result = resolveSecurityIntelligenceProfile({
			settings: DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
			measuredSourceLoc: sourceLoc,
			configured: true,
		});
		expect(result.eligibility).toMatchObject({
			measuredSourceLoc: sourceLoc,
			eligible: enabled,
			reason,
		});
		expect(result.securityOracle.effectiveEnabled).toBe(enabled);
		expect(result.ontology).toMatchObject({
			effectiveEnabled: enabled,
			toolProfile: profile,
		});
	});

	it("disables ontology when an eligible Project disables Security Oracle", () => {
		const result = resolveSecurityIntelligenceProfile({
			settings: {
				...DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
				securityOracleEnabled: false,
			},
			measuredSourceLoc: 50_000,
			configured: true,
		});
		expect(result.securityOracle).toMatchObject({
			effectiveEnabled: false,
			reason: "user_disabled",
		});
		expect(result.ontology).toMatchObject({
			effectiveEnabled: false,
			toolProfile: "standard",
			reason: "oracle_disabled",
		});
	});

	it("keeps the eligible policy enabled but reports an unavailable installation", () => {
		const result = resolveSecurityIntelligenceProfile({
			settings: DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
			measuredSourceLoc: 50_000,
			configured: false,
		});
		expect(result.securityOracle).toMatchObject({
			configured: false,
			effectiveEnabled: true,
			reason: "installation_unavailable",
		});
	});

	it("fails closed when measurement is unavailable", () => {
		const result = resolveSecurityIntelligenceProfile({
			settings: DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
			measuredSourceLoc: Number.NaN,
			configured: true,
		});
		expect(result.eligibility).toMatchObject({
			measuredSourceLoc: null,
			eligible: false,
			reason: "measurement_unavailable",
		});
		expect(result.securityOracle.effectiveEnabled).toBe(false);
		expect(result.ontology.toolProfile).toBe("standard");
	});

	it("reads the legacy settings shape with Security Oracle enabled", () => {
		expect(
			readProjectSecurityIntelligenceSettings({
				securityIntelligence: {
					ontologyToolsEnabled: false,
					securityMaxIterations: 2,
				},
			}),
		).toEqual({
			securityOracleEnabled: true,
			ontologyToolsEnabled: false,
			securityMaxIterations: 2,
		});
	});

	it("rejects unknown and invalid project settings", () => {
		expect(
			projectSecurityIntelligenceSettingsSchema.safeParse({
				securityOracleEnabled: true,
				ontologyToolsEnabled: true,
				securityMaxIterations: 0,
			}).success,
		).toBe(false);
		expect(
			projectSecurityIntelligenceSettingsSchema.safeParse({
				securityOracleEnabled: true,
				ontologyToolsEnabled: true,
				securityMaxIterations: 3,
				apiKey: "must-not-be-accepted",
			}).success,
		).toBe(false);
	});
});
