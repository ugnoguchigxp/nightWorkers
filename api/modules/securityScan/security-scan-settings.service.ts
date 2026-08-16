import {
	type SecurityScanBinding,
	type SecurityScanProviderSettings,
	securityScanBindingSchema,
	securityScanProviderSettingsInputSchema,
} from "../../../shared/schemas/security-scan.schema";
import { ValidationError } from "../../lib/errors";
import { replaceRuntimeSecretValues } from "../../services/security/secret-redaction";
import {
	readApplicationSetting,
	readApplicationSettingSecrets,
	writeApplicationSetting,
	writeApplicationSettingBundle,
} from "../../services/settings/application-settings-store";
import { isVulnWorkbenchCliConfigured } from "../../services/vulnworkbench-cli-runtime";

const DEFAULT_PROVIDER_BASE_URL = "http://127.0.0.1:29831";
const MAX_BINDINGS_PER_REPOSITORY = 20;

type IntegrationPublicSettings = Record<string, unknown> & {
	securityScanProvider?: {
		enabled?: boolean;
		transport?: "local_cli" | "http";
		baseUrl?: string;
		bindings?: Record<string, SecurityScanBinding[]>;
	};
};

type IntegrationSecretSettings = Record<string, unknown> & {
	securityScanProvider?: {
		token?: string;
	};
};

export type SecurityScanProviderConnection = {
	enabled: boolean;
	transport: "local_cli" | "http";
	baseUrl: string;
	token: string;
	localCliConfigured: boolean;
};

let settingsWriteQueue: Promise<void> = Promise.resolve();

function serializeSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
	const result = settingsWriteQueue.then(operation);
	settingsWriteQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function readPublicSettings(): IntegrationPublicSettings {
	return (
		readApplicationSetting<IntegrationPublicSettings>("integrations") ?? {}
	);
}

function readSecretSettings(): IntegrationSecretSettings {
	return (
		readApplicationSettingSecrets<IntegrationSecretSettings>("integrations") ??
		{}
	);
}

export function normalizeProviderBaseUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new ValidationError("vulnWorkbench Base URL が不正です。");
	}
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new ValidationError("Base URL は http または https が必要です。");
	}
	if (parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new ValidationError(
			"Base URL に認証情報、query、fragmentは指定できません。",
		);
	}
	if (parsed.pathname !== "/" && parsed.pathname !== "") {
		throw new ValidationError(
			"Base URL には origin のみを指定してください（例: http://127.0.0.1:29831）。",
		);
	}
	const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
	if (parsed.protocol === "http:" && !loopbackHosts.has(parsed.hostname)) {
		throw new ValidationError(
			"loopback 以外の provider には https を使用してください。",
		);
	}
	return parsed.origin;
}

export function getSecurityScanProviderSettings(): SecurityScanProviderSettings {
	const publicSettings = readPublicSettings().securityScanProvider;
	const transport = publicSettings?.transport === "http" ? "http" : "local_cli";
	return {
		enabled: publicSettings?.enabled === true,
		transport,
		baseUrl: providerBaseUrl(
			typeof publicSettings?.baseUrl === "string"
				? publicSettings.baseUrl
				: undefined,
			transport,
		),
		tokenConfigured: Boolean(readConfiguredToken()),
		localCliConfigured: isVulnWorkbenchCliConfigured(),
	};
}

export function getSecurityScanProviderConnection(): SecurityScanProviderConnection {
	const settings = getSecurityScanProviderSettings();
	const token = readConfiguredToken();
	return {
		enabled: settings.enabled,
		transport: settings.transport,
		baseUrl: settings.baseUrl,
		token,
		localCliConfigured: settings.localCliConfigured,
	};
}

export async function saveSecurityScanProviderSettings(
	input: unknown,
): Promise<SecurityScanProviderSettings> {
	const parsed = securityScanProviderSettingsInputSchema.safeParse(input);
	if (!parsed.success) {
		throw new ValidationError("vulnWorkbench 接続設定が不正です。", {
			issues: parsed.error.issues,
		});
	}
	return serializeSettingsWrite(async () => {
		const currentPublic = readPublicSettings();
		const currentSecrets = readSecretSettings();
		const currentBaseUrl = currentPublic.securityScanProvider?.baseUrl;
		const baseUrl = providerBaseUrl(
			parsed.data.baseUrl ??
				(typeof currentBaseUrl === "string" ? currentBaseUrl : undefined),
			parsed.data.transport,
		);
		const currentToken = currentSecrets.securityScanProvider?.token;
		const token =
			parsed.data.token?.trim() ??
			(typeof currentToken === "string" ? currentToken.trim() : "");
		await writeApplicationSettingBundle(
			"integrations",
			{
				...currentPublic,
				securityScanProvider: {
					...currentPublic.securityScanProvider,
					enabled: parsed.data.enabled,
					transport: parsed.data.transport,
					baseUrl,
				},
			},
			{
				...currentSecrets,
				securityScanProvider: {
					...currentSecrets.securityScanProvider,
					token,
				},
			},
		);
		replaceRuntimeSecretValues("security-scan-provider", [token]);
		return {
			enabled: parsed.data.enabled,
			transport: parsed.data.transport,
			baseUrl,
			tokenConfigured: Boolean(token),
			localCliConfigured: isVulnWorkbenchCliConfigured(),
		};
	});
}

function readConfiguredToken() {
	const value = readSecretSettings().securityScanProvider?.token;
	const token = typeof value === "string" ? value.trim() : "";
	replaceRuntimeSecretValues("security-scan-provider", [token]);
	return token;
}

function providerBaseUrl(
	value: string | undefined,
	transport: "local_cli" | "http",
) {
	const candidate = value ?? DEFAULT_PROVIDER_BASE_URL;
	if (transport === "http") return normalizeProviderBaseUrl(candidate);
	try {
		return normalizeProviderBaseUrl(candidate);
	} catch {
		return DEFAULT_PROVIDER_BASE_URL;
	}
}

export function listSecurityScanBindings(
	repositoryId: string,
): SecurityScanBinding[] {
	const bindings =
		readPublicSettings().securityScanProvider?.bindings?.[repositoryId] ?? [];
	return bindings
		.map((binding) => securityScanBindingSchema.safeParse(binding))
		.filter((result) => result.success)
		.map((result) => result.data)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function recordSecurityScanBinding(
	repositoryId: string,
	binding: SecurityScanBinding,
): Promise<void> {
	await serializeSettingsWrite(async () => {
		const current = readPublicSettings();
		const provider = current.securityScanProvider ?? {};
		const bindings = provider.bindings ?? {};
		const repositoryBindings = [
			binding,
			...(bindings[repositoryId] ?? []).filter(
				(item) => item.scanRunRef !== binding.scanRunRef,
			),
		].slice(0, MAX_BINDINGS_PER_REPOSITORY);
		await writeApplicationSetting("integrations", {
			...current,
			securityScanProvider: {
				...provider,
				bindings: {
					...bindings,
					[repositoryId]: repositoryBindings,
				},
			},
		});
	});
}
