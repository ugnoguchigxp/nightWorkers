import {
	HOOK_DEFAULT_TIMEOUT_SECONDS,
	HOOK_OUTPUT_LIMIT_BYTES,
	type HookExecutionResult,
} from "./hooks-execution-contract";
import type { AgentHookConfig, AgentHookInput } from "./types";

export async function runHttpHook(
	hook: AgentHookConfig,
	input: AgentHookInput,
	signal?: AbortSignal,
): Promise<HookExecutionResult> {
	signal?.throwIfAborted();
	if (hook.handler.type !== "http")
		throw new Error("Hook handler is not http.");
	const timeoutSeconds =
		hook.handler.timeoutSeconds ?? HOOK_DEFAULT_TIMEOUT_SECONDS;
	const controller = new AbortController();
	const timeout = setTimeout(
		() =>
			controller.abort(new Error(`Hook timed out after ${timeoutSeconds}s`)),
		timeoutSeconds * 1000,
	);
	try {
		const res = await fetch(hook.handler.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...resolveAllowedEnvHeaders(
					hook.handler.headers || {},
					hook.handler.allowedEnvVars || [],
				),
			},
			body: JSON.stringify(input),
			signal: signal
				? AbortSignal.any([signal, controller.signal])
				: controller.signal,
		});
		const reader = res.body?.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		if (reader) {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > HOOK_OUTPUT_LIMIT_BYTES) {
						await reader.cancel();
						throw new Error(
							`Hook output exceeded ${HOOK_OUTPUT_LIMIT_BYTES} bytes`,
						);
					}
					chunks.push(value);
				}
			} finally {
				reader.releaseLock();
			}
		}
		return {
			stdout: Buffer.concat(chunks).toString("utf8"),
			stderr: res.ok ? "" : `HTTP ${res.status}`,
			exitCode: res.ok ? 0 : 1,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function resolveAllowedEnvHeaders(
	headers: Record<string, string>,
	allowedEnvVars: string[],
): Record<string, string> {
	const allowed = new Set(allowedEnvVars);
	return Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [
			key,
			value.replace(
				/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
				(_match, name: string) =>
					allowed.has(name) ? (process.env[name] ?? "") : "",
			),
		]),
	);
}
