import type { ProjectDetailMetrics } from '../../../../../shared/schemas/project-detail.schema';

export const emptyMetrics: ProjectDetailMetrics = {
  stackProfile: {
    summary: '',
    manifestStatus: 'missing',
    manifestPath: '',
    packageManager: null,
    technologies: [],
  },
  runs: { total: 0, completed: 0, failed: 0 },
  llmUsage: {
    totalTokens: 0,
    promptInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningOutputTokens: 0,
    stateCardTokens: 0,
    callCount: 0,
    totalCost: null,
    averageTokensPerRun: null,
    averageCostPerRun: null,
    modelMix: [],
    topTokenTasks: [],
  },
  health: { latestEvaluationScore: null, coverageAverage: null },
};

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
