import fs from "node:fs";
import path from "node:path";
import { getCodexGlobalHome } from "./paths";

export type CodexModelOption = {
	value: string;
	label: string;
};

export type CodexAuthSource =
	| "settings-token"
	| "environment-token"
	| "codex-auth-json"
	| "missing";
export type CodexModelSource = "codex-models-cache" | "settings" | "fallback";

const DEFAULT_CODEX_MODEL_OPTIONS: CodexModelOption[] = [
	{ value: "gpt-5.5", label: "GPT-5.5" },
	{ value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
	{ value: "gpt-5-mini", label: "GPT-5-Mini" },
];

export function readCodexModelOptions(input?: {
	configuredModel?: string;
	codexHome?: string;
}): CodexModelOption[] {
	const codexHome = input?.codexHome || getCodexGlobalHome();
	return uniqueModelOptions([
		...(input?.configuredModel
			? [{ value: input.configuredModel, label: input.configuredModel }]
			: []),
		...readCodexModelCache(codexHome),
		...DEFAULT_CODEX_MODEL_OPTIONS,
	]);
}

export function readCodexSdkStatus(input?: {
	accessToken?: string;
	configuredModel?: string;
	codexHome?: string;
}) {
	const codexHome = input?.codexHome || getCodexGlobalHome();
	const cacheModels = readCodexModelCache(codexHome);
	const models = uniqueModelOptions([
		...(input?.configuredModel
			? [{ value: input.configuredModel, label: input.configuredModel }]
			: []),
		...cacheModels,
		...DEFAULT_CODEX_MODEL_OPTIONS,
	]);
	const authSource = resolveCodexAuthSource(input?.accessToken, codexHome);
	const modelSource: CodexModelSource = cacheModels.length
		? "codex-models-cache"
		: input?.configuredModel
			? "settings"
			: "fallback";
	return {
		loggedIn: authSource !== "missing",
		authSource,
		codexHome,
		models,
		modelSource,
		checkedAt: new Date().toISOString(),
	};
}

function resolveCodexAuthSource(
	accessToken: string | undefined,
	codexHome: string,
): CodexAuthSource {
	if (accessToken?.trim()) return "settings-token";
	if (process.env.CODEX_ACCESS_TOKEN?.trim()) return "environment-token";
	if (hasCodexAuthJson(codexHome)) return "codex-auth-json";
	return "missing";
}

function hasCodexAuthJson(codexHome: string) {
	try {
		const authPath = path.join(codexHome, "auth.json");
		if (!fs.existsSync(authPath)) return false;
		const text = fs.readFileSync(authPath, "utf-8").trim();
		if (!text) return false;
		const parsed = JSON.parse(text);
		return Boolean(
			parsed && typeof parsed === "object" && Object.keys(parsed).length,
		);
	} catch {
		return false;
	}
}

function readCodexModelCache(codexHome: string): CodexModelOption[] {
	try {
		const cachePath = path.join(codexHome, "models_cache.json");
		if (!fs.existsSync(cachePath)) return [];
		const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
			models?: Array<{ slug?: unknown; display_name?: unknown }>;
		};
		return (parsed.models || [])
			.map((model) => {
				const value = typeof model.slug === "string" ? model.slug.trim() : "";
				const label =
					typeof model.display_name === "string" && model.display_name.trim()
						? model.display_name.trim()
						: value;
				return value ? { value, label } : null;
			})
			.filter((model): model is CodexModelOption => Boolean(model));
	} catch {
		return [];
	}
}

function uniqueModelOptions(options: CodexModelOption[]) {
	const seen = new Set<string>();
	return options.filter((option) => {
		if (!option.value || seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	});
}
