import {
	type ProjectSecurityIntelligenceSettings,
	type ProjectSecurityIntelligenceSettingsResponse,
	projectSecurityIntelligenceSettingsSchema,
} from "../../../shared/schemas/ontology.schema";
import { NotFoundError } from "../../lib/errors";
import { isVulnWorkbenchCliConfigured } from "../../services/vulnworkbench-cli-runtime";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { getRepositoryTechStackOverview } from "../techStack";
import {
	DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS,
	resolveSecurityIntelligenceProfile,
} from "./eligibility/tool-profile";

export async function getProjectSecurityIntelligenceSettings(
	repositoryId: string,
): Promise<ProjectSecurityIntelligenceSettingsResponse> {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const settings = readProjectSecurityIntelligenceSettings(
		repository.featureSettings,
	);
	const overview = await getRepositoryTechStackOverview(repositoryId);
	const snapshot = overview.codeSizeSnapshot;
	const resolution = resolveSecurityIntelligenceProfile({
		settings,
		measuredSourceLoc: snapshot?.totals.sourceEffectiveLines,
		scannedAt: snapshot?.measuredAt ?? null,
		configured: isVulnWorkbenchCliConfigured(),
	});
	return {
		settings,
		...resolution,
	};
}

export async function saveProjectSecurityIntelligenceSettings(
	repositoryId: string,
	input: ProjectSecurityIntelligenceSettings,
) {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const settings = projectSecurityIntelligenceSettingsSchema.parse(input);
	const featureSettings = isRecord(repository.featureSettings)
		? repository.featureSettings
		: {};
	await nightworkersRepo.updateRepositoryFeatureSettings(repositoryId, {
		...featureSettings,
		securityIntelligence: settings,
	});
	return getProjectSecurityIntelligenceSettings(repositoryId);
}

export function readProjectSecurityIntelligenceSettings(
	featureSettings: unknown,
): ProjectSecurityIntelligenceSettings {
	const raw = isRecord(featureSettings)
		? featureSettings.securityIntelligence
		: null;
	const parsed = projectSecurityIntelligenceSettingsSchema.safeParse(raw);
	if (parsed.success) return parsed.data;
	if (isRecord(raw)) {
		const legacy = projectSecurityIntelligenceSettingsSchema.safeParse({
			securityOracleEnabled: true,
			ontologyToolsEnabled: raw.ontologyToolsEnabled,
			securityMaxIterations: raw.securityMaxIterations,
		});
		if (legacy.success) return legacy.data;
	}
	return { ...DEFAULT_PROJECT_SECURITY_INTELLIGENCE_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
