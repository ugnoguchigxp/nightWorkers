import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";

type BlueprintGenerationInput = {
	prompt?: string;
	questionnaireSessionId?: string | null;
	sourceBlueprintMessageId?: string | null;
};

export function generateBlueprintArtifact(
	sessionId: string,
	input: BlueprintGenerationInput,
) {
	return apiFetch(
		`/api/tasks/${sessionId}/plan-mode/blueprint`,
		jsonRequest("POST", input),
	);
}

export function fetchBlueprintDesignSettings(
	sessionId: string,
	init?: RequestInit,
) {
	return apiFetch(`/api/tasks/${sessionId}/blueprint-design-settings`, init);
}

export function saveBlueprintDesignSettings(
	sessionId: string,
	settings: unknown,
) {
	return apiFetch(
		`/api/tasks/${sessionId}/blueprint-design-settings`,
		jsonRequest("PUT", settings),
	);
}

export function fetchBlueprintAdoption(
	sessionId: string,
	messageId: string,
	init?: RequestInit,
) {
	return apiFetch(
		`/api/tasks/${sessionId}/blueprint-adoption?messageId=${encodeURIComponent(messageId)}`,
		init,
	);
}

export function saveBlueprintAdoption(
	sessionId: string,
	input: { messageId: string; adopted: boolean },
) {
	return apiFetch(
		`/api/tasks/${sessionId}/blueprint-adoption`,
		jsonRequest("PUT", input),
	);
}

export function fetchBlueprintDesignTokenAdoption(
	sessionId: string,
	messageId: string,
	init?: RequestInit,
) {
	return apiFetch(
		`/api/tasks/${sessionId}/blueprint-design-token-adoption?messageId=${encodeURIComponent(
			messageId,
		)}`,
		init,
	);
}

export function saveBlueprintDesignTokenAdoption(
	sessionId: string,
	input: { messageId: string; adopted: boolean },
) {
	return apiFetch(
		`/api/tasks/${sessionId}/blueprint-design-token-adoption`,
		jsonRequest("PUT", input),
	);
}
