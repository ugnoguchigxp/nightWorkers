import { apiFetch } from '../../lib/api-base';
import type {
  AgentHookInput,
  GeneralSettings,
  LlmProviderEndpoint,
  LlmSettings,
  McpServerInput,
  TestQualitySettings,
  TodoWorkflowSettings,
} from './types';

export type SpecificationWorkspaceAction = 'blueprint' | 'db-design' | 'design-doc';
export type BlueprintAdoptionEndpoint =
  | 'blueprint-adoption'
  | 'blueprint-db-design-adoption'
  | 'blueprint-design-token-adoption';

export function fetchSpecificationWorkspace(sessionId: string, init?: RequestInit) {
  return apiFetch(`/api/tasks/${sessionId}/specification-workspace`, init);
}

export function fetchDesignQuestionnaireSessions(sessionId: string, init?: RequestInit) {
  return apiFetch(`/api/tasks/${sessionId}/design-questionnaire`, init);
}

export function fetchDesignQuestionnaireSession(
  sessionId: string,
  questionnaireSessionId: string,
  init?: RequestInit
) {
  return apiFetch(`/api/tasks/${sessionId}/design-questionnaire/${questionnaireSessionId}`, init);
}

export function startDesignQuestionnaire(
  sessionId: string,
  input: { sourceBlueprintMessageId: string }
) {
  return apiFetch(`/api/tasks/${sessionId}/design-questionnaire`, jsonRequest('POST', input));
}

export function submitDesignQuestionnaireAnswers(
  sessionId: string,
  questionnaireSessionId: string,
  input: { answers: unknown[] }
) {
  return apiFetch(
    `/api/tasks/${sessionId}/design-questionnaire/${questionnaireSessionId}/answers`,
    jsonRequest('POST', input)
  );
}

export function generateSpecificationWorkspaceArtifact(
  sessionId: string,
  action: SpecificationWorkspaceAction,
  input: { questionnaireSessionId: string; sourceBlueprintMessageId: string | null }
) {
  return apiFetch(
    `/api/tasks/${sessionId}/specification-workspace/${action}`,
    jsonRequest('POST', input)
  );
}

export function fetchBlueprintDesignSettings(sessionId: string, init?: RequestInit) {
  return apiFetch(`/api/tasks/${sessionId}/blueprint-design-settings`, init);
}

export function saveBlueprintDesignSettings(sessionId: string, settings: unknown) {
  return apiFetch(
    `/api/tasks/${sessionId}/blueprint-design-settings`,
    jsonRequest('PUT', settings)
  );
}

export function fetchBlueprintAdoption(
  sessionId: string,
  endpoint: BlueprintAdoptionEndpoint,
  messageId: string,
  init?: RequestInit
) {
  return apiFetch(
    `/api/tasks/${sessionId}/${endpoint}?messageId=${encodeURIComponent(messageId)}`,
    init
  );
}

export function saveBlueprintAdoption(
  sessionId: string,
  endpoint: BlueprintAdoptionEndpoint,
  input: { messageId: string; adopted: boolean }
) {
  return apiFetch(`/api/tasks/${sessionId}/${endpoint}`, jsonRequest('PUT', input));
}

export function fetchOverview(query: string) {
  return apiFetch(`/api/overview?${query}`);
}

export function fetchLlmSettings() {
  return apiFetch('/api/settings/llm');
}

export function saveLlmSettings(settings: LlmSettings) {
  return apiFetch('/api/settings/llm', jsonRequest('POST', settings));
}

export function fetchGeneralSettings() {
  return apiFetch('/api/settings/general');
}

export function saveGeneralSettings(settings: GeneralSettings) {
  return apiFetch('/api/settings/general', jsonRequest('POST', settings));
}

export function refreshFxRates() {
  return apiFetch('/api/settings/fx/refresh', { method: 'POST' });
}

export function fetchTestQualitySettings(repositoryId: string) {
  return apiFetch(`/api/repositories/${repositoryId}/settings/test-quality`);
}

export function saveTestQualitySettings(repositoryId: string, settings: TestQualitySettings) {
  return apiFetch(
    `/api/repositories/${repositoryId}/settings/test-quality`,
    jsonRequest('PUT', settings)
  );
}

export function fetchLlmModelOptions() {
  return apiFetch('/api/settings/llm/models');
}

export function fetchCodexSdkStatus() {
  return apiFetch('/api/settings/codex/status');
}

export function fetchMcpServers() {
  return apiFetch('/api/settings/mcp/servers');
}

export function createMcpServer(input: McpServerInput) {
  return apiFetch('/api/settings/mcp/servers', jsonRequest('POST', input));
}

export function importMcpServers(input: { text: string; testAfterImport: boolean }) {
  return apiFetch('/api/settings/mcp/servers/import', jsonRequest('POST', input));
}

export function updateMcpServer(id: string, input: Partial<McpServerInput>) {
  return apiFetch(`/api/settings/mcp/servers/${id}`, jsonRequest('PUT', input));
}

export function deleteMcpServer(id: string) {
  return apiFetch(`/api/settings/mcp/servers/${id}`, { method: 'DELETE' });
}

export function testMcpServer(id: string) {
  return apiFetch(`/api/settings/mcp/servers/${id}/test`, { method: 'POST' });
}

export function fetchAgentHooks() {
  return apiFetch('/api/settings/hooks');
}

export function createAgentHook(input: AgentHookInput) {
  return apiFetch('/api/settings/hooks', jsonRequest('POST', input));
}

export function updateAgentHook(id: string, input: Partial<AgentHookInput>) {
  return apiFetch(`/api/settings/hooks/${id}`, jsonRequest('PUT', input));
}

export function deleteAgentHook(id: string) {
  return apiFetch(`/api/settings/hooks/${id}`, { method: 'DELETE' });
}

export function testAgentHook(id: string) {
  return apiFetch(`/api/settings/hooks/${id}/test`, { method: 'POST' });
}

export function runLlmSmokeTest() {
  return apiFetch('/api/settings/llm/smoke', { method: 'POST' });
}

export function testLlmProviderHealth(id: string, endpoint?: LlmProviderEndpoint) {
  return apiFetch(`/api/settings/llm/providers/${encodeURIComponent(id)}/health`, {
    method: 'POST',
    ...(endpoint
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) }
      : {}),
  });
}

export function fetchImplementationQueue() {
  return apiFetch('/api/implementation-queue');
}

export function fetchTodoWorkflowSettings() {
  return apiFetch('/api/todo-workflow/settings');
}

export function fetchTaskMessages(sessionId: string) {
  return apiFetch(`/api/tasks/${sessionId}/messages`);
}

export function fetchTaskLlmUsage(sessionId: string) {
  return apiFetch(`/api/tasks/${sessionId}/llm-usage`);
}

export function fetchTaskActivityEvents(sessionId: string) {
  return apiFetch(`/api/tasks/${sessionId}/activity-events`);
}

export function fetchBackgroundProcessesForTask(sessionId: string) {
  return apiFetch(`/api/background-processes?taskId=${sessionId}`);
}

export function appendWorkbenchMessage(
  sessionId: string,
  input: {
    content?: string;
    prompt?: string;
    intent?: string;
    artifactContext?: unknown;
    model?: string;
    providerEndpointId?: string;
    thinkingDepth?: string;
    waitForIntake?: boolean;
  }
) {
  return apiFetch(`/api/workbench/sessions/${sessionId}/messages`, jsonRequest('POST', input));
}

export function patchTask(sessionId: string, input: unknown) {
  return apiFetch(`/api/tasks/${sessionId}`, jsonRequest('PATCH', input));
}

export function createWorkbenchSession(input: unknown) {
  return apiFetch('/api/workbench/sessions', jsonRequest('POST', input));
}

export function deleteTask(sessionId: string) {
  return apiFetch(`/api/tasks/${sessionId}`, { method: 'DELETE' });
}

export function startWorkbenchRun(sessionId: string) {
  return apiFetch(`/api/workbench/sessions/${sessionId}/run`, { method: 'POST' });
}

export function stopRun(runId: string) {
  return apiFetch(`/api/runs/${runId}/stop`, { method: 'POST' });
}

export function stopBackgroundProcess(processId: string) {
  return apiFetch(`/api/background-processes/${processId}/stop`, { method: 'POST' });
}

export function queueWorkbenchSession(sessionId: string) {
  return apiFetch(`/api/workbench/sessions/${sessionId}/queue`, { method: 'POST' });
}

export function archiveWorkbenchSession(sessionId: string) {
  return apiFetch(`/api/workbench/sessions/${sessionId}/archive`, { method: 'PATCH' });
}

export function createImplementationQueueEntry(sessionId: string) {
  return apiFetch('/api/implementation-queue/entries', jsonRequest('POST', { taskId: sessionId }));
}

export function archiveImplementationQueueEntry(entryId: string) {
  return apiFetch(`/api/implementation-queue/entries/${entryId}/archive`, { method: 'POST' });
}

export function cancelImplementationQueueEntry(entryId: string) {
  return apiFetch(
    `/api/implementation-queue/entries/${entryId}`,
    jsonRequest('PATCH', { action: 'cancel' })
  );
}

export function submitRunReview(
  runId: string,
  input: { action: 'complete' | 'cancel'; note?: string }
) {
  return apiFetch(`/api/runs/${runId}/reviews`, jsonRequest('POST', input));
}

export function requeueImplementationQueueEntry(entryId: string, input: { note?: string }) {
  return apiFetch(
    `/api/implementation-queue/entries/${entryId}/requeue`,
    jsonRequest('POST', input)
  );
}

export function updateImplementationQueueSettings(input: { processorCount: number }) {
  return apiFetch('/api/implementation-queue/settings', jsonRequest('PATCH', input));
}

export function updateTodoWorkflowSettings(input: Partial<TodoWorkflowSettings>) {
  return apiFetch('/api/todo-workflow/settings', jsonRequest('PATCH', input));
}

export function browseFolders(targetPath?: string) {
  const path = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
  return apiFetch(`/api/utils/browse-folders${path}`);
}

export function createFolder(input: { parentPath?: string; name: string }) {
  return apiFetch('/api/utils/create-folder', jsonRequest('POST', input));
}

export function fetchRepositoryFiles(repositoryId: string, path?: string) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const query = params.toString();
  return apiFetch(`/api/repositories/${repositoryId}/files${query ? `?${query}` : ''}`);
}

export function fetchRepositoryFile(repositoryId: string, path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch(`/api/repositories/${repositoryId}/file?${params.toString()}`);
}

export function fetchRepositoryDiff(repositoryId: string) {
  return apiFetch(`/api/repositories/${repositoryId}/diff`);
}

function jsonRequest(method: 'PATCH' | 'POST' | 'PUT', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
