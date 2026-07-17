import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
	getStructuredLlmSetting,
	readStructuredLlmProviderSettings,
	type StructuredLlmProviderSettings,
} from "./settings";

export function resolveCodexEndpointAccessToken(
	providerEndpointId: string | null | undefined,
	settings: StructuredLlmProviderSettings = readStructuredLlmProviderSettings(),
) {
	const endpoint = settings.providerEndpoints?.find(
		(candidate) => candidate.id === providerEndpointId,
	);
	if (endpoint?.kind === "codex" && endpoint.apiKey?.trim()) {
		return endpoint.apiKey.trim();
	}
	return getStructuredLlmSetting(settings, "CODEX_ACCESS_TOKEN").trim();
}

export function resolveCodexAuthScopeFingerprint(
	providerEndpointId: string | null | undefined,
	settings: StructuredLlmProviderSettings = readStructuredLlmProviderSettings(),
) {
	const accessToken = resolveCodexEndpointAccessToken(
		providerEndpointId,
		settings,
	);
	const scope = accessToken
		? `token:${accessToken}`
		: `home:${resolveCodexHome()}`;
	return createHash("sha256").update(scope).digest("hex");
}

function resolveCodexHome() {
	const configuredHome =
		process.env.NIGHTWORKERS_CODEX_HOME?.trim() ||
		process.env.CODEX_HOME?.trim();
	return configuredHome
		? path.resolve(configuredHome)
		: path.join(os.homedir(), ".codex");
}
