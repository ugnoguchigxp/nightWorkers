import type { ConversationContextOptions } from './types';

export const DEFAULT_CONVERSATION_CONTEXT_MAX_TOKENS = 1200;
export const DEFAULT_SMALL_FILE_CHAR_LIMIT = 6000;

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function resolveConversationContextOptions(
  options?: ConversationContextOptions
): Required<
  Pick<ConversationContextOptions, 'maxTokens' | 'includeSmallTargetFile' | 'smallFileCharLimit'>
> {
  return {
    maxTokens: options?.maxTokens ?? DEFAULT_CONVERSATION_CONTEXT_MAX_TOKENS,
    includeSmallTargetFile: options?.includeSmallTargetFile ?? true,
    smallFileCharLimit: options?.smallFileCharLimit ?? DEFAULT_SMALL_FILE_CHAR_LIMIT,
  };
}
