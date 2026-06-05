import { estimateTokens } from './token-budget';
import type { ConversationContextOptions, ConversationContextSnapshotV1 } from './types';

const CODE_EDIT_JOB_TYPES = new Set(['code_change', 'code_edit', 'minor_code_edit']);

export function buildPromptWithStateCard(input: {
  latestUserMessage: string;
  stateCardText?: string | null;
}) {
  const request = input.latestUserMessage.trim();
  const card = input.stateCardText?.trim();
  if (!card) return request;
  return `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`;
}

export function renderStateCard(
  snapshot: ConversationContextSnapshotV1,
  options?: ConversationContextOptions
) {
  const maxTokens = options?.maxTokens ?? 1200;
  const truncated = new Set(snapshot.limits.truncatedFields);
  let renderSnapshot = snapshot;
  const build = (
    variant: 'full' | 'short-action' | 'no-next' | 'minimal',
    cardSnapshot: ConversationContextSnapshotV1 = renderSnapshot
  ) => {
    const userMax = variant === 'minimal' ? 160 : 360;
    const goalMax = variant === 'minimal' ? 160 : 360;
    const userRequest = truncate(cardSnapshot.task.latestUserRequest, userMax) || '';
    const goal = truncate(cardSnapshot.classification.goal, goalMax);
    if (cardSnapshot.task.latestUserRequest.length > userRequest.length) {
      truncated.add('task.latestUserRequest');
    }
    if (
      cardSnapshot.classification.goal &&
      goal &&
      cardSnapshot.classification.goal.length > goal.length
    ) {
      truncated.add('classification.goal');
    }
    const lines: string[] = [
      '<STATE_CARD>',
      `Task: ${cardSnapshot.task.id} | ${cardSnapshot.classification.jobType || 'unknown'} | ${
        cardSnapshot.continuity.isContinuation ? 'continuation' : 'new'
      }`,
      `User: ${userRequest}`,
    ];
    if (goal) lines.push(`Goal: ${goal}`);

    if (variant !== 'minimal') {
      lines.push('', 'Continuity:');
      const previousAction =
        variant === 'short-action'
          ? truncate(cardSnapshot.continuity.previousAction, 160)
          : cardSnapshot.continuity.previousAction;
      lines.push(`- ${previousAction || 'none'}`);
      if (CODE_EDIT_JOB_TYPES.has(cardSnapshot.classification.jobType || '')) {
        lines.push('- current intent: continue/edit existing work, not re-plan');
      }
    }

    lines.push('', 'Files:');
    lines.push(
      `- target: ${cardSnapshot.files.target.length ? cardSnapshot.files.target.join(', ') : 'none'}`
    );

    if (variant !== 'minimal') {
      lines.push('', 'Current state:');
      lines.push(`- previous run: ${cardSnapshot.continuity.previousTerminalState || 'unknown'}`);
      lines.push(
        `- last error: ${cardSnapshot.runState.lastError || cardSnapshot.runState.lastToolFailure || 'none'}`
      );
      if (cardSnapshot.runState.lastFinalReport) {
        lines.push(`- last final report: ${truncate(cardSnapshot.runState.lastFinalReport, 360)}`);
      }
    }

    if (variant === 'full' || variant === 'short-action') {
      const snippets = cardSnapshot.code.snippets.filter((snippet) => snippet.content.trim());
      if (snippets.length > 0) {
        lines.push('', 'Relevant code:');
        for (const snippet of snippets.slice(0, 3)) {
          lines.push(
            `File: ${snippet.path} (${snippet.reason}${snippet.truncated ? ', truncated' : ''})`
          );
          lines.push('```');
          lines.push(snippet.content);
          lines.push('```');
        }
      }
    }

    if (variant !== 'minimal' && variant !== 'no-next') {
      const next = deterministicNextAction(cardSnapshot);
      if (next) lines.push('', 'Next:', `- ${next}`);
    }

    lines.push('</STATE_CARD>');
    return lines.join('\n');
  };

  let text = build('full');
  if (estimateTokens(text) > maxTokens) {
    truncated.add('code.snippets');
    renderSnapshot = {
      ...snapshot,
      code: {
        snippets: [],
      },
    };
    text = build('full');
  }
  if (estimateTokens(text) > maxTokens) {
    truncated.add('continuity.previousAction');
    text = build('short-action');
  }
  if (estimateTokens(text) > maxTokens) {
    truncated.add('next');
    text = build('no-next');
  }
  if (estimateTokens(text) > maxTokens) {
    truncated.add('minimal');
    text = build('minimal');
  }
  snapshot.limits.truncatedFields = Array.from(truncated);
  snapshot.limits.tokenEstimate = estimateTokens(text);
  return text;
}

function deterministicNextAction(snapshot: ConversationContextSnapshotV1) {
  if (CODE_EDIT_JOB_TYPES.has(snapshot.classification.jobType || '') && snapshot.files.target[0]) {
    return `${snapshot.files.target[0]} の既存変更を踏まえて最新依頼を実装する`;
  }
  return null;
}

function truncate(value: string | null, max: number) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
