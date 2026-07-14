import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ValidationError } from "../../lib/errors";
import { getRuntimePaths } from "../../runtime/paths";
import {
	archiveLegacySettingsFile,
	readApplicationSetting,
	writeApplicationSetting,
} from "../settings/application-settings-store";
import {
	type AgentHookInputConfig,
	type AgentHookUpdateInput,
	agentHookConfigSchema,
	agentHookInputSchema,
} from "./hooks-config-schema";
import type { AgentHookConfig, AgentHookLastRun } from "./types";

const RUNTIME_SETTINGS_DIR = getRuntimePaths().settingsDir;
const DEFAULT_HOOKS_SETTINGS_PATH = path.join(
	RUNTIME_SETTINGS_DIR,
	"agent-hooks.json",
);

type PersistedAgentHooksSettings = {
	hooks: AgentHookConfig[];
};

function getHooksSettingsPath() {
	return DEFAULT_HOOKS_SETTINGS_PATH;
}

function parsePersistedSettings(value: unknown): PersistedAgentHooksSettings {
	if (!value || typeof value !== "object") return { hooks: [] };
	const rawHooks = Array.isArray((value as { hooks?: unknown }).hooks)
		? (value as { hooks: unknown[] }).hooks
		: [];
	const hooks = rawHooks.flatMap((hook) => {
		const parsed = agentHookConfigSchema.safeParse(hook);
		return parsed.success ? [parsed.data] : [];
	});
	return { hooks };
}

export function readAgentHooksSettings(): PersistedAgentHooksSettings {
	const sqliteSettings =
		readApplicationSetting<PersistedAgentHooksSettings>("agent-hooks");
	if (sqliteSettings) return parsePersistedSettings(sqliteSettings);
	try {
		const settingsPath = getHooksSettingsPath();
		if (!fs.existsSync(settingsPath)) return { hooks: [] };
		const settings = parsePersistedSettings(
			JSON.parse(fs.readFileSync(settingsPath, "utf-8")),
		);
		void writeApplicationSetting("agent-hooks", settings)
			.then(() => archiveLegacySettingsFile(settingsPath))
			.catch(() => undefined);
		return settings;
	} catch {
		return { hooks: [] };
	}
}

async function writeAgentHooksSettings(settings: PersistedAgentHooksSettings) {
	await writeApplicationSetting("agent-hooks", settings);
}

export function listAgentHooks(): AgentHookConfig[] {
	return readAgentHooksSettings().hooks;
}

export function getAgentHook(id: string): AgentHookConfig | null {
	return listAgentHooks().find((hook) => hook.id === id) ?? null;
}

export async function createAgentHook(
	input: AgentHookInputConfig,
): Promise<AgentHookConfig> {
	const parsed = agentHookInputSchema.parse(input);
	const settings = readAgentHooksSettings();
	if (settings.hooks.some((hook) => hook.name === parsed.name)) {
		throw new ValidationError(`Agent Hook name already exists: ${parsed.name}`);
	}
	const now = new Date().toISOString();
	const hook = agentHookConfigSchema.parse({
		...parsed,
		id: crypto.randomUUID(),
		createdAt: now,
		updatedAt: now,
	});
	settings.hooks.push(hook);
	await writeAgentHooksSettings(settings);
	return hook;
}

export async function updateAgentHook(
	id: string,
	input: AgentHookUpdateInput,
): Promise<AgentHookConfig | null> {
	const settings = readAgentHooksSettings();
	const index = settings.hooks.findIndex((hook) => hook.id === id);
	if (index === -1) return null;
	const current = settings.hooks[index];
	const mergedInput = agentHookInputSchema.parse({
		name: input.name ?? current.name,
		enabled: input.enabled ?? current.enabled,
		event: input.event ?? current.event,
		matcher: input.matcher ?? current.matcher,
		handler: input.handler ?? current.handler,
	});
	if (
		settings.hooks.some(
			(hook) => hook.id !== id && hook.name === mergedInput.name,
		)
	) {
		throw new ValidationError(
			`Agent Hook name already exists: ${mergedInput.name}`,
		);
	}
	const updated = agentHookConfigSchema.parse({
		...current,
		...mergedInput,
		updatedAt: new Date().toISOString(),
	});
	settings.hooks[index] = updated;
	await writeAgentHooksSettings(settings);
	return updated;
}

export async function deleteAgentHook(
	id: string,
): Promise<AgentHookConfig | null> {
	const settings = readAgentHooksSettings();
	const index = settings.hooks.findIndex((hook) => hook.id === id);
	if (index === -1) return null;
	const [removed] = settings.hooks.splice(index, 1);
	await writeAgentHooksSettings(settings);
	return removed ?? null;
}

export async function updateAgentHookLastRun(
	id: string,
	lastRun: AgentHookLastRun,
): Promise<AgentHookConfig | null> {
	const settings = readAgentHooksSettings();
	const index = settings.hooks.findIndex((hook) => hook.id === id);
	if (index === -1) return null;
	const updated = agentHookConfigSchema.parse({
		...settings.hooks[index],
		lastRun,
		updatedAt: new Date().toISOString(),
	});
	settings.hooks[index] = updated;
	await writeAgentHooksSettings(settings);
	return updated;
}
