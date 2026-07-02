export type LlmUsageMode = 'measured' | 'estimated' | 'mixed' | 'unavailable';

export type NormalizedLlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  mode: LlmUsageMode;
  rawUsage?: unknown;
};

export type LlmPromptPartTokenEstimates = {
  systemPromptTokens?: number | null;
  userPromptTokens?: number | null;
  latestUserMessageTokens?: number | null;
  stateCardTokens?: number | null;
};

export type TaskLlmUsageSummary = {
  taskId: string;
  promptInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  stateCardTokens: number;
  cachedInputTokens: number;
  nonCachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageMode: LlmUsageMode;
  callCount: number;
  measuredCallCount: number;
  estimatedCallCount: number;
  lastUpdatedAt: string | null;
};
