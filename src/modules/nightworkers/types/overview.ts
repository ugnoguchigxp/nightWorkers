export type TaskLlmUsageSummary = {
  taskId: string;
  promptInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  stateCardTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageMode: 'measured' | 'estimated' | 'mixed' | 'unavailable';
  callCount: number;
  measuredCallCount: number;
  estimatedCallCount: number;
  lastUpdatedAt?: unknown | null;
};

export type NightWorkersLanguage = 'ja' | 'en';
export type NightWorkersCurrency = 'JPY' | 'USD' | 'EUR';
export type PlanModeCapability =
  | 'feature_plan'
  | 'questionnaire'
  | 'user_flow'
  | 'blueprint'
  | 'data_model'
  | 'api_io_contract'
  | 'activity_flow'
  | 'sequence_flow'
  | 'zod_schema_design';

export type PlanModeSettings = {
  capabilities: Record<PlanModeCapability, boolean>;
};

export type LlmUsageSettings = {
  promptPartObservabilityEnabled: boolean;
};

export type GeneralSettings = {
  timezone: string;
  language: NightWorkersLanguage;
  currency: NightWorkersCurrency;
  fx: {
    source: 'ecb' | 'manual';
    autoRefresh: boolean;
    lastRefreshedAt: string | null;
  };
  planMode: PlanModeSettings;
  llmUsage: LlmUsageSettings;
};

export type OverviewUsageSummary = {
  promptInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  stateCardTokens: number;
  totalTokens: number;
  callCount: number;
  measuredCallCount: number;
  estimatedCallCount: number;
  mixedCallCount: number;
  unavailableCallCount: number;
};

export type OverviewUsageBucket = OverviewUsageSummary & {
  key: string;
  startsAt: string;
  endsAt: string;
};

export type OverviewModelUsage = OverviewUsageSummary & {
  provider: string;
  model: string | null;
  pricingStatus: 'priced' | 'manual' | 'missing' | 'ambiguous';
  estimatedCost: number;
};

export type OverviewExpensiveCall = {
  id: string;
  taskId: string;
  runId: string | null;
  repositoryId: string | null;
  taskTitle: string | null;
  provider: string;
  model: string | null;
  label: string;
  inputTokens: number;
  outputTokens: number;
  stateCardTokens: number;
  totalTokens: number;
  estimatedCost: number | null;
  usageMode: string;
  createdAt: string;
};

export type OverviewDashboard = {
  generatedAt: string;
  scope: {
    repositoryId: string | null;
    range: '24h' | '7d' | '30d' | 'all';
    timezone: string;
    currency: NightWorkersCurrency;
  };
  settings: {
    language: NightWorkersLanguage;
    timezone: string;
    currency: NightWorkersCurrency;
    activeProvider: string | null;
    activeModel: string | null;
  };
  usage: OverviewUsageSummary;
  cost: {
    currency: NightWorkersCurrency;
    estimatedTotal: number | null;
    inputCost: number | null;
    cachedInputCost: number | null;
    outputCost: number | null;
    reasoningOutputCost: number | null;
    creditTotal: number | null;
    pricedCallCount: number;
    unpricedCallCount: number;
    fxRate: number | null;
    fxBaseCurrency: string | null;
    fxUpdatedAt: string | null;
    pricingUpdatedAt: string | null;
    incompleteReasons: string[];
  };
  dailyUsage: OverviewUsageBucket[];
  modelBreakdown: OverviewModelUsage[];
  recentExpensiveCalls: OverviewExpensiveCall[];
  warnings: Array<Record<string, unknown>>;
};
