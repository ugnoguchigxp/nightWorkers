import {
	type ProjectExplorationCatalogPilotSettings,
	projectExplorationCatalogPilotSettingsSchema,
} from "../../../../shared/schemas/project-exploration-catalog.schema";
import { NotFoundError } from "../../../lib/errors";
import * as nightworkersRepo from "../../nightworkers/nightworkers.repository";
import { updateRepositoryFeatureSetting } from "../../nightworkers/repository-feature-settings.repository";

const DEFAULT_SETTINGS: ProjectExplorationCatalogPilotSettings = {
	enabled: false,
	mcpServerId: null,
};

export async function getProjectExplorationCatalogSettings(
	repositoryId: string,
): Promise<ProjectExplorationCatalogPilotSettings> {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	return readProjectExplorationCatalogSettings(repository.featureSettings);
}

export async function saveProjectExplorationCatalogSettings(
	repositoryId: string,
	input: ProjectExplorationCatalogPilotSettings,
): Promise<ProjectExplorationCatalogPilotSettings> {
	const repository = await nightworkersRepo.getRepository(repositoryId);
	if (!repository) throw new NotFoundError("Repository not found");
	const settings = projectExplorationCatalogPilotSettingsSchema.parse(input);
	const updated = await updateRepositoryFeatureSetting(
		repositoryId,
		"projectExplorationCatalog",
		settings,
	);
	if (!updated) throw new NotFoundError("Repository not found");
	return settings;
}

export function readProjectExplorationCatalogSettings(
	featureSettings: unknown,
): ProjectExplorationCatalogPilotSettings {
	const raw = isRecord(featureSettings)
		? featureSettings.projectExplorationCatalog
		: null;
	const parsed = projectExplorationCatalogPilotSettingsSchema.safeParse(raw);
	return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
