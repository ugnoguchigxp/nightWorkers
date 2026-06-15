import type { TaskMessage } from './types';

export function isWorkspaceOnlyTaskMessage(message: TaskMessage): boolean {
  const intent = (message.metadataJson as Record<string, unknown>)?.intent;
  return intent === 'draft_spec';
}

export function isUserVisibleChatMessage(message: TaskMessage): boolean {
  if (message.role !== 'user' && message.role !== 'assistant') return false;
  const intent = (message.metadataJson as Record<string, unknown>)?.intent;
  return (
    intent !== 'blueprint_raw_output' &&
    intent !== 'blueprint_db_design_raw_output' &&
    !isWorkspaceOnlyTaskMessage(message)
  );
}
