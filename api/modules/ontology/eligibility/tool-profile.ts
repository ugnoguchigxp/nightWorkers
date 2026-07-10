import type {
	OntologyToolProfile,
	ProjectSecurityIntelligenceSettings,
} from "../../../../shared/schemas/ontology.schema";

export const ONTOLOGY_MIN_SOURCE_LOC = 50_000 as const;

export const DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS: ProjectSecurityIntelligenceSettings =
	{
		ontologyToolsEnabled: true,
		securityMaxIterations: 3,
	};

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
	const measuredSourceLoc = normalizeSourceLoc(input.measuredSourceLoc);
	const eligible =
		measuredSourceLoc !== null && measuredSourceLoc >= ONTOLOGY_MIN_SOURCE_LOC;
	const effectiveEnabled = eligible && input.settings.ontologyToolsEnabled;
	return {
		thresholdSourceLoc: ONTOLOGY_MIN_SOURCE_LOC,
		measuredSourceLoc,
		eligible,
		effectiveEnabled,
		toolProfile: effectiveEnabled ? "ontology_extended" : "standard",
		reason:
			measuredSourceLoc === null
				? "measurement_unavailable"
				: !eligible
					? "below_threshold"
					: input.settings.ontologyToolsEnabled
						? "enabled"
						: "user_disabled",
		scannedAt: input.scannedAt ?? null,
	};
}

function normalizeSourceLoc(value: number | null | undefined) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? Math.floor(value)
		: null;
}
