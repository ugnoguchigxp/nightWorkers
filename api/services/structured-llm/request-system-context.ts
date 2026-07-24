import { DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY } from "../../modules/agentsShare";
import {
	bindSystemContextCatalogSnapshot,
	systemContextPromptAudit,
} from "../../systemContexts/catalog";
import type { RawLlmCallOptions } from "./providers";
import { providerAdapterKey } from "./request";
import type { NormalizedSupervisorLlmRequest } from "./types";

export function prepareAuditedSystemPrompt(
	systemPrompt: string,
	options: RawLlmCallOptions,
) {
	const systemContexts = bindSystemContextCatalogSnapshot(
		options.systemContextBinding,
	);
	const existingAudit = options.systemContextAudit ?? [];
	let effectiveSystemPrompt = systemPrompt;
	let systemContextAudit = [...existingAudit];
	if (systemContextAudit.length === 0) {
		const invocation = systemContexts.invoke(
			"providerExecution.system-prompt",
			{ systemPrompt },
		);
		effectiveSystemPrompt = invocation.content.text;
		systemContextAudit = [
			systemContextPromptAudit("system", systemContexts, invocation),
		];
	}
	return {
		systemPrompt: effectiveSystemPrompt,
		options: {
			...options,
			systemContextBinding: systemContexts.binding,
			systemContextAudit,
		} satisfies RawLlmCallOptions,
	};
}

export function prepareAuditedExecutionPolicy(
	options: RawLlmCallOptions,
	normalizedRequest: NormalizedSupervisorLlmRequest,
): RawLlmCallOptions {
	if (providerAdapterKey(normalizedRequest.providerId) !== "codex")
		return options;
	const systemContextBinding = options.systemContextBinding;
	if (!systemContextBinding)
		throw new Error("Structured LLM request is missing its locale binding.");
	const sourceExecutionPolicy =
		options.executionPolicy ?? DEFAULT_STRUCTURED_PROVIDER_EXECUTION_POLICY;
	const boundDeveloperInstructions =
		sourceExecutionPolicy.bindDeveloperInstructions?.(systemContextBinding);
	if (!boundDeveloperInstructions) {
		return { ...options, executionPolicy: sourceExecutionPolicy };
	}
	return {
		...options,
		systemContextAudit: [
			...(options.systemContextAudit ?? []),
			...boundDeveloperInstructions.systemContextAudit,
		],
		executionPolicy: {
			...sourceExecutionPolicy,
			developerInstructions: boundDeveloperInstructions.text,
		},
	};
}
