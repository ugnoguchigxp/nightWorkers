import {
  buildConversationContextSnapshot,
  deriveTargetFiles,
  finalizeSnapshotTokenEstimate,
} from './build';
import { getConversationContextRuntimeOptions, isConversationContextEnabled } from './flags';
import { emptyGitState, loadConversationGitState } from './git';
import { buildPromptWithStateCard, renderStateCard } from './render';
import {
  getLatestConversationContextForTask as getLatestSnapshot,
  loadConversationContextSource,
  upsertConversationContextSnapshot,
} from './repository';
import type { ConversationContextRefreshResult, RefreshConversationContextInput } from './types';

export async function refreshConversationContextSnapshot(
  input: RefreshConversationContextInput
): Promise<ConversationContextRefreshResult> {
  if (!isConversationContextEnabled()) {
    throw new Error('Conversation context is disabled');
  }
  const source = await loadConversationContextSource(input);
  const options = {
    ...getConversationContextRuntimeOptions(),
    currentRunId: input.reason === 'run_finished' ? null : (input.runId ?? null),
  };
  const emptyState = emptyGitState();
  const preliminary = await buildConversationContextSnapshot({
    source,
    gitState: emptyState,
    options,
  });
  const baseGitState = await loadConversationGitState({
    repoRoot: source.task.repositoryPath,
  });
  const targetPaths = deriveTargetFiles({
    latestUserRequest: preliminary.task.latestUserRequest,
    intakeGoal: preliminary.classification.goal,
    previousRunText: preliminary.continuity.previousAction,
    previousSnapshot: source.previousSnapshot?.snapshotJson ?? null,
    gitState: baseGitState,
  });
  const gitState = await loadConversationGitState({
    repoRoot: source.task.repositoryPath,
    targetPaths,
  });
  const snapshot = await buildConversationContextSnapshot({
    source,
    gitState,
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
  RefreshConversationContextInput,
} from './types';
export { buildPromptWithStateCard };
