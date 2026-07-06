import {
	buildConversationContextSnapshot,
	finalizeSnapshotTokenEstimate,
} from "./build";
import {
	getConversationContextRuntimeOptions,
	isConversationContextEnabled,
} from "./flags";
import {
	buildPromptWithStateCard,
	buildPromptWithStateCardParts,
	renderStateCard,
} from "./render";
import {
	getLatestConversationContextForTask as getLatestSnapshot,
	loadConversationContextSource,
	upsertConversationContextSnapshot,
} from "./repository";
import type {
	ConversationContextRefreshResult,
	RefreshConversationContextInput,
} from "./types";

export async function refreshConversationContextSnapshot(
	input: RefreshConversationContextInput,
): Promise<ConversationContextRefreshResult> {
	if (!isConversationContextEnabled()) {
		throw new Error("Conversation context is disabled");
	}
	const source = await loadConversationContextSource(input);
	const options = {
		...getConversationContextRuntimeOptions(),
		currentRunId:
			input.reason === "run_finished" ? null : (input.runId ?? null),
	};
	const snapshot = await buildConversationContextSnapshot({
		source,
		options,
	});
	const stateCardText = renderStateCard(snapshot, options);
	finalizeSnapshotTokenEstimate(snapshot, stateCardText);
	const record = await upsertConversationContextSnapshot({
		taskId: input.taskId,
		runId: input.runId ?? null,
		snapshot,
		stateCardText,
	});
	return { snapshot: record };
}

export const getLatestConversationContextForTask = getLatestSnapshot;
export type {
	ConversationContextRefreshResult,
	ConversationContextSnapshotRecord,
	PromptWithStateCardParts,
	RefreshConversationContextInput,
} from "./types";
export { buildPromptWithStateCard, buildPromptWithStateCardParts };
