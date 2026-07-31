import { afterEach } from "vitest";
import { config } from "../api/config";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import { bootstrapMissionPilotTables } from "../api/modules/missionPilot/persistence/bootstrap";
import {
	applyVitestDatabaseEnv,
	assertVitestDatabaseIsolation,
} from "./vitest-db-env";

applyVitestDatabaseEnv();
assertVitestDatabaseIsolation(config.DATABASE_URL);
installRegularVitestLlmFetchGuard();
await ensureNightWorkersSchema();
await bootstrapMissionPilotTables();

afterEach(async () => {
	assertVitestDatabaseIsolation(config.DATABASE_URL);
	await client.execute("DELETE FROM application_setting_secrets");
	await client.execute("DELETE FROM application_settings");
	await client.execute("DELETE FROM application_setting_migrations");
});

function installRegularVitestLlmFetchGuard() {
	const originalFetch = globalThis.fetch;
	if (!originalFetch) return;

	globalThis.fetch = async (input, init) => {
		const url = readFetchUrl(input);
		if (url && isLlmProviderUrl(url)) {
			throw new Error(
				`Unexpected live LLM fetch in regular Vitest: ${url}. Use bun run test:live:llm with NIGHTWORKERS_LIVE_LLM_VITEST=1 for live provider tests.`,
			);
		}
		return originalFetch(input, init);
	};
}

function readFetchUrl(input: Parameters<typeof fetch>[0]): string | null {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url || null;
}

function isLlmProviderUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}

	if (url.hostname === "api.openai.com") return true;
	if (url.hostname.endsWith(".openai.azure.com")) return true;
	if (
		(url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
		url.port === "11434" &&
		(url.pathname.includes("/chat/completions") || url.pathname === "/health")
	) {
		return true;
	}

	return configuredLlmBaseUrls().some((baseUrl) => {
		try {
			return url.href.startsWith(new URL(baseUrl).href.replace(/\/+$/, ""));
		} catch {
			return false;
		}
	});
}

function configuredLlmBaseUrls(): string[] {
	return [
		process.env.OPENAI_BASE_URL,
		process.env.OPENAI_COMPATIBLE_BASE_URL,
		process.env.LOCAL_OPENAI_BASE_URL,
		process.env.NIGHTWORKERS_LOCAL_LLM_BASE_URL,
		process.env.AZURE_OPENAI_ENDPOINT,
	].filter((value): value is string => Boolean(value?.trim()));
}
