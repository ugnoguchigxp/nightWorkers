import type { Dispatch, SetStateAction } from 'react';
import type {
  ActivityArtifact,
  ActivityEvent,
  AgentHookConfig,
  AgentHookInput,
  AgentHookTestResult,
  BackgroundProcess,
  CreateProjectInput,
  CreateSessionInput,
  ImplementationQueueDashboard,
  LlmProvider,
  LlmSettings,
  McpServerConfig,
  McpServerImportResult,
  McpServerInput,
  McpServerTestResult,
  ProjectDiff,
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  ReviewResult,
  Task,
  TaskEvent,
  TaskLlmUsageSummary,
  TaskMessage,
  TaskRun,
  TaskRunTodo,
  TodoWorkflowSettings,
  UpdateProjectInput,
  WorkbenchArtifactContext,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
  WorkbenchMovableSessionGroup,
  WorkbenchSessionView,
} from '../types';

export type FolderDir = { name: string; path: string };
export type RealtimeStatus = 'initializing' | 'connecting' | 'connected' | 'disconnected';
export type WorkbenchMessageResult = {
  task?: Task;
  run?: TaskRun | null;
  messages?: TaskMessage[];
};
export type WorkbenchLlmSelection = {
  model?: string;
  providerEndpointId?: string;
  thinkingDepth?: string;
};
export type NightWorkersWorkspaceState = {
  projects: Repository[];
  sessions: Task[];
  sessionViews: WorkbenchSessionView[];
  groupedSessionViews: Record<string, ProjectSessionGroups>;
  activeSessionId: string | null;
  activeSession: Task | null;
  activeSessionView: WorkbenchSessionView | null;
  activeProject: Repository | null;
  activeSessionRuns: TaskRun[];
  latestRun: TaskRun | undefined;
  taskMessages: TaskMessage[];
  latestRunEvents: TaskEvent[];
  llmUsageSummary: TaskLlmUsageSummary | null;
  activityEvents: ActivityEvent[];
  activityArtifacts: ActivityArtifact[];
  backgroundProcesses: BackgroundProcess[];
  activeStreamingResponse: string;
  latestRunTodos: TaskRunTodo[];
  latestRunReviews: ReviewResult[];
  activeArtifactRefs: WorkbenchArtifactRef[];
  implementationQueue: ImplementationQueueDashboard | null;
  todoWorkflowSettings: TodoWorkflowSettings | null;
  projectFileEntries: ProjectFileEntry[];
  projectFileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedProjectDirectories: Record<string, boolean>;
  loadingProjectDirectories: Record<string, boolean>;
  selectedProjectFile: ProjectFileContent | null;
  selectedProjectFilePath: string | null;
  isProjectFilesLoading: boolean;
  isProjectFileLoading: boolean;
  projectDiff: ProjectDiff | null;
  isProjectDiffLoading: boolean;
  isRealtimeConnected: boolean;
  realtimeStatus: RealtimeStatus;
  isChatSubmitting: boolean;
  isProjectsLoading: boolean;
  isSessionsLoading: boolean;
  isAgentWorking: boolean;
  isAgentThinking: boolean;
  isUpdatingSessionStatus: boolean;
  isImplementationQueueLoading: boolean;
  expandedProjects: Record<string, boolean>;
  setExpandedProjects: Dispatch<SetStateAction<Record<string, boolean>>>;
  setActiveSessionId: (id: string | null) => void;
  createProject: (input: CreateProjectInput) => void;
  updateProject: (id: string, input: UpdateProjectInput) => Promise<Repository>;
  deleteProject: (id: string) => void;
  deleteSession: (id: string) => void;
  createSession: (input: CreateSessionInput) => Promise<Task>;
  startRun: (sessionId: string) => Promise<TaskRun>;
  stopRun: (runId: string) => Promise<TaskRun>;
  stopBackgroundProcess: (processId: string) => Promise<BackgroundProcess>;
  queueSession: (sessionId: string) => Promise<Task>;
  createImplementationQueueEntry: (sessionId: string) => Promise<void>;
  archiveImplementationQueueEntry: (entryId: string) => Promise<void>;
  removeImplementationQueueEntry: (entryId: string) => Promise<void>;
  requeueImplementationQueueEntry: (entryId: string, note?: string) => Promise<void>;
  submitRunReview: (
    runId: string,
    input: { action: 'complete' | 'cancel'; note?: string }
  ) => Promise<void>;
  updateImplementationQueueProcessorCount: (processorCount: number) => Promise<void>;
  updateTodoWorkflowSettings: (input: Partial<TodoWorkflowSettings>) => Promise<void>;
  updateSessionStatus: (sessionId: string, status: 'draft' | 'ready') => Promise<Task>;
  reorderQueueSessions: (sessionIds: string[]) => Promise<Task[]>;
  moveWorkbenchSession: (input: {
    sessionId: string;
    sourceGroup: WorkbenchMovableSessionGroup;
    targetGroup: WorkbenchMovableSessionGroup;
    processingIds: string[];
    queueIds: string[];
    archiveIds: string[];
  }) => Promise<void>;
  sendChatMessage: (sessionId: string, prompt: string) => Promise<void>;
  sendWorkbenchMessage: (
    sessionId: string,
    prompt: string,
    intent: WorkbenchChatIntent,
    artifactContext?: WorkbenchArtifactContext | null,
    llmSelection?: WorkbenchLlmSelection
  ) => Promise<WorkbenchMessageResult | undefined>;
  refreshWorkspace: () => void;
  currentBrowserPath: string | null;
  browserParentPath: string | null;
  browserDirectories: FolderDir[];
  isBrowserLoading: boolean;
  fetchDirectories: (targetPath?: string) => Promise<void>;
  createFolder: (input: { parentPath?: string; name: string }) => Promise<FolderDir>;
  refreshProjectFiles: () => Promise<void>;
  refreshProjectDiff: () => Promise<void>;
  llmSettings: LlmSettings | null;
  activeProvider: LlmProvider;
  providerModelOptions: Array<{ value: string; label: string }>;
  mcpServers: McpServerConfig[];
  agentHooks: AgentHookConfig[];
  createMcpServer: (input: McpServerInput) => Promise<McpServerConfig>;
  importMcpServers: (text: string, testAfterImport?: boolean) => Promise<McpServerImportResult>;
  updateMcpServer: (id: string, input: Partial<McpServerInput>) => Promise<McpServerConfig>;
  deleteMcpServer: (id: string) => Promise<void>;
  testMcpServer: (id: string) => Promise<McpServerTestResult>;
  createAgentHook: (input: AgentHookInput) => Promise<AgentHookConfig>;
  updateAgentHook: (id: string, input: Partial<AgentHookInput>) => Promise<AgentHookConfig>;
  deleteAgentHook: (id: string) => Promise<void>;
  testAgentHook: (id: string) => Promise<AgentHookTestResult>;
  setActiveProvider: (provider: LlmProvider) => Promise<void>;
  toggleProviderEnabled: (provider: LlmProvider, enabled: boolean) => Promise<void>;
  updateProviderModel: (model: string) => Promise<void>;
  runLlmSmokeTest: () => Promise<{ ok: boolean; provider: string; message: string }>;
  toggleProjectDirectory: (path: string) => Promise<void>;
  openProjectFile: (path: string) => void;
};

export type ProjectSessionGroups = {
  processing: WorkbenchSessionView[];
  queue: WorkbenchSessionView[];
  archive: WorkbenchSessionView[];
};
