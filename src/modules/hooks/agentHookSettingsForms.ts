import type {
	AgentHookConfig,
	AgentHookEvent,
	AgentHookInput,
} from "../nightworkers/types";

export type AgentHookForm = {
	id?: string;
	name: string;
	enabled: boolean;
	event: AgentHookEvent;
	matcher: string;
	handlerType: "command" | "http";
	command: string;
	argsText: string;
	cwd: string;
	envText: string;
	url: string;
	headersText: string;
	timeoutSeconds: number;
	failClosed: boolean;
};

export const emptyHookForm: AgentHookForm = {
	name: "",
	enabled: true,
	event: "PreToolUse",
	matcher: "*",
	handlerType: "command",
	command: "",
	argsText: "",
	cwd: "",
	envText: "",
	url: "",
	headersText: "",
	timeoutSeconds: 30,
	failClosed: true,
};

export const hookEventOptions: Array<{ value: AgentHookEvent; label: string }> =
	[
		{ value: "SessionStart", label: "SessionStart" },
		{ value: "UserPromptSubmit", label: "UserPromptSubmit" },
		{ value: "PreToolUse", label: "PreToolUse" },
		{ value: "PostToolUse", label: "PostToolUse" },
		{ value: "PostToolUseFailure", label: "PostToolUseFailure" },
		{ value: "Stop", label: "Stop" },
		{ value: "SessionEnd", label: "SessionEnd" },
	];

function parseKeyValueText(text: string): Record<string, string> {
	return Object.fromEntries(
		text
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [key, ...rest] = line.split("=");
				return [key.trim(), rest.join("=").trim()];
			})
			.filter(([key]) => key),
	);
}

export function formFromAgentHook(hook: AgentHookConfig): AgentHookForm {
	if (hook.handler.type === "command") {
		return {
			id: hook.id,
			name: hook.name,
			enabled: hook.enabled,
			event: hook.event,
			matcher: hook.matcher || "*",
			handlerType: "command",
			command: hook.handler.command,
			argsText: (hook.handler.args || []).join(" "),
			cwd: hook.handler.cwd || "",
			envText: Object.entries(hook.handler.env || {})
				.map(([key, value]) => `${key}=${value}`)
				.join("\n"),
			url: "",
			headersText: "",
			timeoutSeconds: hook.handler.timeoutSeconds || 30,
			failClosed: hook.handler.failClosed ?? hook.event === "PreToolUse",
		};
	}
	return {
		id: hook.id,
		name: hook.name,
		enabled: hook.enabled,
		event: hook.event,
		matcher: hook.matcher || "*",
		handlerType: hook.handler.type,
		command: "",
		argsText: "",
		cwd: "",
		envText: "",
		url: hook.handler.url,
		headersText: Object.entries(hook.handler.headers || {})
			.map(([key, value]) => `${key}=${value}`)
			.join("\n"),
		timeoutSeconds: hook.handler.timeoutSeconds || 30,
		failClosed: hook.handler.failClosed ?? false,
	};
}

export function hookFormToInput(form: AgentHookForm): AgentHookInput {
	const matcher =
		form.event === "PreToolUse" ||
		form.event === "PostToolUse" ||
		form.event === "PostToolUseFailure"
			? form.matcher.trim() || "*"
			: undefined;
	return {
		name: form.name.trim(),
		enabled: form.enabled,
		event: form.event,
		matcher,
		handler:
			form.handlerType === "command"
				? {
						type: "command",
						command: form.command.trim(),
						args: form.argsText.split(/\s+/).filter(Boolean),
						cwd: form.cwd.trim() || undefined,
						env: parseKeyValueText(form.envText),
						timeoutSeconds: form.timeoutSeconds,
						failClosed: form.failClosed,
					}
				: {
						type: "http",
						url: form.url.trim(),
						headers: parseKeyValueText(form.headersText),
						timeoutSeconds: form.timeoutSeconds,
						failClosed: form.failClosed,
					},
	};
}
