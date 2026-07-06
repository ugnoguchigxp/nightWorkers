import { createHash, randomUUID } from "node:crypto";

export type EndpointIdMigrationEndpoint = {
	id: string;
	name?: string;
	kind?: string;
	baseUrl?: string;
	endpoint?: string;
	models?: string[];
};

export type EndpointIdMigrationTarget = {
	providerEndpointId: string;
	model: string;
	thinkingDepth?: string;
};

export type EndpointIdMigrationRoleRoute = {
	role: string;
	primary: EndpointIdMigrationTarget;
	fallbacks: EndpointIdMigrationTarget[];
};

export type EndpointIdMigrationSettings<
	TEndpoint extends EndpointIdMigrationEndpoint = EndpointIdMigrationEndpoint,
	TRoleRoute extends
		EndpointIdMigrationRoleRoute = EndpointIdMigrationRoleRoute,
> = {
	providerEndpoints?: TEndpoint[];
	roleRoutes?: TRoleRoute[];
	endpointIdSchemaVersion?: number;
	settingsRevision?: string;
};

export type EndpointIdMapping = {
	oldId: string;
	newId: string;
	kind: string;
	name: string;
};

export type EndpointIdMigrationResult<TSettings> = {
	settings: TSettings;
	mappings: EndpointIdMapping[];
	changed: boolean;
};

const CURRENT_ENDPOINT_ID_SCHEMA_VERSION = 2;

const legacyEndpointIdPatterns = [
	/^azure-default$/,
	/^openai-default$/,
	/^bedrock-default$/,
	/^codex-default$/,
	/^endpoint-\d+$/,
];

export function migrateStructuredLlmEndpointIds<
	TSettings extends EndpointIdMigrationSettings<TEndpoint, TRoleRoute>,
	TEndpoint extends EndpointIdMigrationEndpoint = EndpointIdMigrationEndpoint,
	TRoleRoute extends
		EndpointIdMigrationRoleRoute = EndpointIdMigrationRoleRoute,
>(settings: TSettings): EndpointIdMigrationResult<TSettings> {
	const endpoints = settings.providerEndpoints ?? [];
	if (endpoints.length === 0) {
		return { settings, mappings: [], changed: false };
	}

	const usedIds = new Set(endpoints.map((endpoint) => endpoint.id));
	const idMap = new Map<string, string>();
	const mappings: EndpointIdMapping[] = [];

	const migratedEndpoints = endpoints.map((endpoint, index) => {
		if (!shouldMigrateEndpointId(endpoint.id)) return endpoint;
		const newId = generateStableEndpointId(endpoint, index, usedIds);
		usedIds.delete(endpoint.id);
		usedIds.add(newId);
		idMap.set(endpoint.id, newId);
		mappings.push({
			oldId: endpoint.id,
			newId,
			kind: endpoint.kind ?? "",
			name: endpoint.name ?? "",
		});
		return { ...endpoint, id: newId };
	}) as TEndpoint[];

	if (
		mappings.length === 0 &&
		settings.endpointIdSchemaVersion === CURRENT_ENDPOINT_ID_SCHEMA_VERSION
	) {
		return { settings, mappings, changed: false };
	}

	const migratedRoutes = (settings.roleRoutes ?? []).map((route) => ({
		...route,
		primary: migrateTarget(route.primary, idMap),
		fallbacks: (route.fallbacks ?? []).map((target) =>
			migrateTarget(target, idMap),
		),
	})) as TRoleRoute[];

	return {
		settings: {
			...settings,
			providerEndpoints: migratedEndpoints,
			roleRoutes: migratedRoutes,
			endpointIdSchemaVersion: CURRENT_ENDPOINT_ID_SCHEMA_VERSION,
			settingsRevision: new Date().toISOString(),
		},
		mappings,
		changed: true,
	};
}

export function createStructuredLlmEndpointId(): string {
	return `ep_${hashEndpointSeed(`created:${randomUUID()}`).slice(0, 16)}`;
}

export function isStructuredLlmEndpointIdLegacy(id: string): boolean {
	return shouldMigrateEndpointId(id);
}

function shouldMigrateEndpointId(id: string): boolean {
	return legacyEndpointIdPatterns.some((pattern) => pattern.test(id));
}

function generateStableEndpointId(
	endpoint: EndpointIdMigrationEndpoint,
	index: number,
	usedIds: Set<string>,
): string {
	const baseSeed = [
		"legacy",
		endpoint.id,
		endpoint.kind ?? "",
		endpoint.baseUrl || endpoint.endpoint || "",
		endpoint.models?.[0] ?? "",
	].join(":");
	for (let ordinal = 0; ordinal < 1000; ordinal += 1) {
		const seed = ordinal === 0 ? baseSeed : `${baseSeed}:${index}:${ordinal}`;
		const id = `ep_${hashEndpointSeed(seed).slice(0, 16)}`;
		if (!usedIds.has(id)) return id;
	}
	return createStructuredLlmEndpointId();
}

function hashEndpointSeed(seed: string): string {
	return createHash("sha256").update(seed).digest("hex");
}

function migrateTarget<TTarget extends EndpointIdMigrationTarget>(
	target: TTarget,
	idMap: Map<string, string>,
): TTarget {
	const migratedId = idMap.get(target.providerEndpointId);
	if (!migratedId) return target;
	return { ...target, providerEndpointId: migratedId };
}
