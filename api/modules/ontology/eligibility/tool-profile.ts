import type {
	OntologyToolProfile,
	ProjectSecurityIntelligenceSettings,
} from "../../../../shared/schemas/ontology.schema";

export const ONTOLOGY_MIN_SOURCE_LOC = 50_000 as const;

export const DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS: ProjectSecurityIntelligenceSettings =
	{
		securityOracleEnabled: true,
		ontologyToolsEnabled: true,
		securityMaxIterations: 3,
	};

export type SecurityIntelligenceProfileResolution = {
	eligibility: {
		thresholdSourceLoc: typeof ONTOLOGY_MIN_SOURCE_LOC;
		measuredSourceLoc: number | null;
		eligible: boolean;
		scannedAt: string | Date | null;
		reason: "enabled" | "below_threshold" | "measurement_unavailable";
	};
	securityOracle: {
		configured: boolean;
		effectiveEnabled: boolean;
		reason:
			| "enabled"
			| "user_disabled"
			| "below_threshold"
			| "measurement_unavailable"
			| "installation_unavailable";
	};
	ontology: {
		effectiveEnabled: boolean;
		toolProfile: OntologyToolProfile;
		reason:
			| "enabled"
			| "user_disabled"
			| "below_threshold"
			| "measurement_unavailable"
			| "oracle_disabled";
	};
};

export function resolveSecurityIntelligenceProfile(input: {
	settings: ProjectSecurityIntelligenceSettings;
	measuredSourceLoc: number | null | undefined;
	scannedAt?: string | Date | null;
	configured: boolean;
}): SecurityIntelligenceProfileResolution {
	const measuredSourceLoc = normalizeSourceLoc(input.measuredSourceLoc);
	const eligible =
		measuredSourceLoc !== null && measuredSourceLoc >= ONTOLOGY_MIN_SOURCE_LOC;
	const eligibilityReason =
		measuredSourceLoc === null
			? "measurement_unavailable"
			: eligible
				? "enabled"
				: "below_threshold";
	const securityEffective = eligible && input.settings.securityOracleEnabled;
	const securityReason =
		eligibilityReason !== "enabled"
			? eligibilityReason
			: !input.settings.securityOracleEnabled
				? "user_disabled"
				: !input.configured
					? "installation_unavailable"
					: "enabled";
	const ontologyEffective =
		securityEffective && input.settings.ontologyToolsEnabled;
	const ontologyReason =
		eligibilityReason !== "enabled"
			? eligibilityReason
			: !securityEffective
				? "oracle_disabled"
				: input.settings.ontologyToolsEnabled
					? "enabled"
					: "user_disabled";
	return {
		eligibility: {
			thresholdSourceLoc: ONTOLOGY_MIN_SOURCE_LOC,
			measuredSourceLoc,
			eligible,
			scannedAt: input.scannedAt ?? null,
			reason: eligibilityReason,
		},
		securityOracle: {
			configured: input.configured,
			effectiveEnabled: securityEffective,
			reason: securityReason,
		},
		ontology: {
			effectiveEnabled: ontologyEffective,
			toolProfile: ontologyEffective ? "ontology_extended" : "standard",
			reason: ontologyReason,
		},
	};
}

export type OntologyToolProfileResolution = {
	thresholdSourceLoc: typeof ONTOLOGY_MIN_SOURCE_LOC;
	measuredSourceLoc: number | null;
	eligible: boolean;
	effectiveEnabled: boolean;
	toolProfile: OntologyToolProfile;
	reason:
		| "enabled"
		| "user_disabled"
		| "below_threshold"
		| "measurement_unavailable";
	scannedAt: string | Date | null;
};

export function resolveOntologyToolProfile(input: {
	settings: ProjectSecurityIntelligenceSettings;
	measuredSourceLoc: number | null | undefined;
	scannedAt?: string | Date | null;
}): OntologyToolProfileResolution {
	const resolution = resolveSecurityIntelligenceProfile({
		...input,
		configured: true,
	});
	return {
		...resolution.eligibility,
		effectiveEnabled: resolution.ontology.effectiveEnabled,
		toolProfile: resolution.ontology.toolProfile,
		reason:
			resolution.ontology.reason === "oracle_disabled"
				? "user_disabled"
				: resolution.ontology.reason,
	};
}

function normalizeSourceLoc(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: null;
}
