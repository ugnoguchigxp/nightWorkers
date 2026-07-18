export const CURRENT_PROVIDER_ENABLEMENT_MIGRATION_VERSION = 1;

type ProviderEnablementSettings = {
	providerEnablementMigrationVersion?: number;
	settingsRevision?: string;
	AZURE_OPENAI_ENABLED?: boolean;
	OPENAI_ENABLED?: boolean;
	AWS_BEDROCK_ENABLED?: boolean;
	CODEX_ENABLED?: boolean;
	providerEndpoints?: Array<{
		kind: string;
		enabled: boolean;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
};

const enablementKeyByEndpointKind = {
	azure: "AZURE_OPENAI_ENABLED",
	openai: "OPENAI_ENABLED",
	bedrock: "AWS_BEDROCK_ENABLED",
	codex: "CODEX_ENABLED",
} as const;

/**
 * Repairs settings created by the SQLite settings migration that copied model
 * and credential fields but omitted the legacy provider enablement flags.
 * The marker makes this additive repair run once, so later user disablement is
 * preserved.
 */
export function migrateLegacyProviderEnablement<
	TSettings extends ProviderEnablementSettings,
>(
	settings: TSettings,
	env: NodeJS.ProcessEnv = process.env,
): { settings: TSettings; changed: boolean } {
	if (
		(settings.providerEnablementMigrationVersion ?? 0) >=
		CURRENT_PROVIDER_ENABLEMENT_MIGRATION_VERSION
	)
		return { settings, changed: false };

	const legacyEnablement = {
		AZURE_OPENAI_ENABLED: readLegacyEnabled(env.AZURE_OPENAI_ENABLED),
		OPENAI_ENABLED: readLegacyEnabled(env.OPENAI_ENABLED),
		AWS_BEDROCK_ENABLED: readLegacyEnabled(env.AWS_BEDROCK_ENABLED),
		CODEX_ENABLED: readLegacyEnabled(env.CODEX_ENABLED),
	};
	const migrated = {
		...settings,
		...Object.fromEntries(
			Object.entries(legacyEnablement).flatMap(([key, enabled]) =>
				enabled ? [[key, true]] : [],
			),
		),
		providerEndpoints: (settings.providerEndpoints ?? []).map((endpoint) => {
			const key =
				enablementKeyByEndpointKind[
					endpoint.kind as keyof typeof enablementKeyByEndpointKind
				];
			return key && legacyEnablement[key]
				? { ...endpoint, enabled: true }
				: endpoint;
		}),
		providerEnablementMigrationVersion:
			CURRENT_PROVIDER_ENABLEMENT_MIGRATION_VERSION,
		settingsRevision: new Date().toISOString(),
	} as TSettings;
	return { settings: migrated, changed: true };
}

function readLegacyEnabled(value: string | undefined) {
	return value?.trim().toLowerCase() === "true" || value?.trim() === "1";
}
