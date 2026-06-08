import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { apiFetch } from '../../../lib/api-base';
import { useWorkspaceAppearanceState } from '../contexts/WorkspaceAppearanceContext';
import {
  useWorkspaceLayoutActions,
  useWorkspaceLayoutState,
} from '../contexts/WorkspaceLayoutContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type {
  ProjectSafetyPolicy,
  TaskMessage,
  ThinkingDepth,
  WorkbenchArtifactContext,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
} from '../types';
import { ArtifactPane } from './ArtifactPane';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { ImplementationQueueScreen } from './ImplementationQueueScreen';
import { OverviewScreen } from './OverviewScreen';
import { ProjectSidebar } from './ProjectSidebar';
import { SettingsButton } from './SettingsButton';
import { SettingsScreen } from './SettingsScreen';
import { ThreadWorkspace } from './ThreadWorkspace';
import { TodoListPane } from './TodoListPane';

type NightWorkersShellProps = {
  workspace: NightWorkersWorkspaceState;
  showSettings: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  showFolderBrowser: boolean;
  onOpenFolderBrowser: () => void;
  onCloseFolderBrowser: () => void;
};

function buildBlueprintArtifactRef(message: TaskMessage): WorkbenchArtifactRef {
  const metadata = message.metadataJson || {};
  const blueprint = metadata.appBlueprint || {};
  const title = blueprint.name || metadata.display?.title || metadata.title || 'App Blueprint';
  const artifactId = metadata.artifactRef?.artifactId;
  return {
    id: typeof artifactId === 'string' ? `artifact-${artifactId}` : `message-${message.id}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind: 'app_blueprint',
    title: `Blueprint: ${title}`,
    summary: String(metadata.display?.summary || message.content.slice(0, 160)),
    source:
      typeof artifactId === 'string'
        ? { type: 'artifact_row', artifactId }
        : { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata,
  };
}

function buildQuestionnaireWorkspaceArtifactRef(message: TaskMessage): WorkbenchArtifactRef {
  return {
    id: `blueprint-workspace-${message.taskId}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind: 'blueprint_workspace',
    title: 'Specification Workspace',
    summary: message.content.slice(0, 160),
    source: { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata: {
      specificationSource: 'design_questionnaire_ready',
      questionnaireSessionId: message.metadataJson?.questionnaireSessionId,
      initialTab: 'questionnaire',
    },
  };
}

function asProjectSafetyPolicy(value: unknown): ProjectSafetyPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ProjectSafetyPolicy;
}

function toRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function buildArtifactContext(
  artifact: WorkbenchArtifactRef | null,
  activeSessionId: string | null
): WorkbenchArtifactContext | null {
  if (!artifact || artifact.taskId !== activeSessionId) return null;
  const metadata = artifact.metadata || {};
  const appBlueprint = toRecord(metadata.appBlueprint);
  const screens = Array.isArray(appBlueprint?.screens) ? appBlueprint.screens : [];
  const screenNames = screens
    .map((screen) => toRecord(screen))
    .filter((screen): screen is Record<string, any> => Boolean(screen))
    .map((screen) => String(screen.name || screen.id || ''))
    .filter(Boolean)
    .slice(0, 6);
  const sectionNames = screens
    .flatMap((screen) => {
      const record = toRecord(screen);
      return Array.isArray(record?.sections) ? record.sections : [];
    })
    .map((section) => toRecord(section))
    .filter((section): section is Record<string, any> => Boolean(section))
    .map((section) =>
      String(section.name || section.title || section.componentName || section.id || '')
    )
    .filter(Boolean)
    .slice(0, 10);
  const tables = Array.isArray(toRecord(appBlueprint?.databaseSchema)?.tables)
    ? (toRecord(appBlueprint?.databaseSchema)?.tables as unknown[])
    : [];
  const tableNames = tables
    .map((table) => toRecord(table))
    .filter((table): table is Record<string, any> => Boolean(table))
    .map((table) => String(table.label || table.name || ''))
    .filter(Boolean)
    .slice(0, 10);
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    source: artifact.source,
    metadata: {
      intent: typeof metadata.intent === 'string' ? metadata.intent : undefined,
      artifactType: typeof metadata.artifactType === 'string' ? metadata.artifactType : undefined,
      appBlueprintName: String(appBlueprint?.name || appBlueprint?.id || '') || undefined,
      screenNames: screenNames.length ? screenNames : undefined,
      sectionNames: sectionNames.length ? sectionNames : undefined,
      tableNames: tableNames.length ? tableNames : undefined,
      initialTab: typeof metadata.initialTab === 'string' ? metadata.initialTab : undefined,
    },
  };
}

type ArtifactPaneFocus =
  | { type: 'closed' }
  | { type: 'project_tree' }
  | { type: 'artifact'; artifact: WorkbenchArtifactRef };

export function NightWorkersShell(props: NightWorkersShellProps) {
  const { workspace } = props;
  const { attributes: appearanceAttributes } = useWorkspaceAppearanceState();
  const { panelSizes } = useWorkspaceLayoutState();
  const { setPanelSizes } = useWorkspaceLayoutActions();
  const initialPanelSizes = useRef(panelSizes);
  const workspaceRef = useRef(workspace);
  const openedQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
  const openingQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('medium');
  const [artifactFocus, setArtifactFocus] = useState<ArtifactPaneFocus>({ type: 'closed' });
  const [showQueueScreen, setShowQueueScreen] = useState(false);
  const [showOverviewScreen, setShowOverviewScreen] = useState(true);
  const [queueProjectFilterId, setQueueProjectFilterId] = useState<string | null>(null);
  const isOverviewActive = showOverviewScreen && !props.showSettings;
  const visibleActiveSessionId =
    props.showSettings || isOverviewActive ? null : workspace.activeSessionId;
  const selectedArtifact = artifactFocus.type === 'artifact' ? artifactFocus.artifact : null;
  const selectedArtifactContext = buildArtifactContext(selectedArtifact, workspace.activeSessionId);
  const artifactPaneOpen = artifactFocus.type !== 'closed';
  const isBlueprintArtifactOpen =
    artifactPaneOpen &&
    (selectedArtifact?.kind === 'blueprint_workspace' ||
      selectedArtifact?.kind === 'app_blueprint');
  const isDiffArtifactOpen = artifactPaneOpen && selectedArtifact?.kind === 'diff';
  const todoPaneOpen =
    !props.showSettings &&
    !showOverviewScreen &&
    !showQueueScreen &&
    !artifactPaneOpen &&
    Boolean(workspace.activeSession) &&
    workspace.latestRunTodos.length > 0;

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!selectedArtifact) return;
    if (selectedArtifact.kind === 'blueprint_workspace') return;
    const stillAvailable = workspace.activeArtifactRefs.some(
      (artifact) => artifact.id === selectedArtifact.id
    );
    if (!stillAvailable && selectedArtifact.kind !== 'diff') setArtifactFocus({ type: 'closed' });
  }, [selectedArtifact, workspace.activeArtifactRefs]);

  const currentProviderModel =
    workspace.activeProvider === 'openai'
      ? workspace.llmSettings?.OPENAI_MODEL
      : workspace.activeProvider === 'azure'
        ? workspace.llmSettings?.AZURE_OPENAI_DEPLOYMENT_NAME
        : workspace.activeProvider === 'bedrock'
          ? workspace.llmSettings?.AWS_BEDROCK_MODEL
          : workspace.llmSettings?.CODEX_MODEL;

  const submitPrompt = async (prompt: string, intent: WorkbenchChatIntent = 'intake') => {
    if (!workspace.activeProject && workspace.projects[0]) {
      workspace.setActiveSessionId(
        workspace.sessions.find((s) => s.repositoryId === workspace.projects[0].id)?.id || null
      );
    }
    if (!workspace.activeSession) {
      const project = workspace.activeProject || workspace.projects[0];
      if (!project) return;
      const session = await workspace.createSession({
        repositoryId: project.id,
        title: 'New Session',
        description: '',
        objective: '',
        acceptanceCriteria: '',
      });
      workspace.setActiveSessionId(session.id);
      await workspace.sendWorkbenchMessage(session.id, prompt, intent);
      return;
    }
    await workspace.sendWorkbenchMessage(workspace.activeSession.id, prompt, intent);
  };
  const handleOpenBlueprintArtifact = useCallback(async () => {
    if (isBlueprintArtifactOpen) {
      setArtifactFocus({ type: 'closed' });
      return;
    }
    const current = workspaceRef.current;
    const existing =
      current.activeArtifactRefs.find((artifact) => artifact.kind === 'blueprint_workspace') ||
      current.activeArtifactRefs.find((artifact) => artifact.kind === 'app_blueprint');
    if (existing) {
      setArtifactFocus({ type: 'artifact', artifact: existing });
      return;
    }
  }, [isBlueprintArtifactOpen]);
  const handleSelectSession = useCallback((sessionId: string | null) => {
    setArtifactFocus({ type: 'closed' });
    setShowQueueScreen(false);
    setShowOverviewScreen(false);
    workspaceRef.current.setActiveSessionId(sessionId);
  }, []);
  const handleCreateSession = useCallback((repositoryId: string) => {
    void workspaceRef.current.createSession({
      repositoryId,
      title: 'New Session',
      description: '',
      objective: '',
      acceptanceCriteria: '',
    });
  }, []);
  const handleDeleteProject = useCallback((projectId: string) => {
    workspaceRef.current.deleteProject(projectId);
  }, []);
  const handleToggleProject = useCallback(
    (projectId: string) =>
      workspaceRef.current.setExpandedProjects((prev) => ({
        ...prev,
        [projectId]: !prev[projectId],
      })),
    []
  );
  const handleOpenFolderBrowser = useCallback(() => {
    props.onOpenFolderBrowser();
    void workspaceRef.current.fetchDirectories(selectedPath || undefined);
  }, [props.onOpenFolderBrowser, selectedPath]);
  const handleOpenOverview = useCallback(() => {
    setArtifactFocus({ type: 'closed' });
    setShowQueueScreen(false);
    setShowOverviewScreen(true);
    props.onCloseSettings();
  }, [props.onCloseSettings]);

  const waitForQuestionnaireWorkspaceReady = useCallback(async (message: TaskMessage) => {
    const sessionId = String(message.metadataJson?.questionnaireSessionId || '');
    if (!sessionId) return false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [workspaceRes, sessionRes] = await Promise.all([
        apiFetch(`/api/tasks/${message.taskId}/specification-workspace`),
        apiFetch(`/api/tasks/${message.taskId}/design-questionnaire/${sessionId}`),
      ]);
      if (workspaceRes.ok && sessionRes.ok) {
        const questionnaireSession = await sessionRes.json();
        if (questionnaireSession?.questionSets?.length) return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }, []);

  const openQuestionnaireWorkspace = useCallback(
    async (message: TaskMessage) => {
      if (openingQuestionnaireMessageIdsRef.current.has(message.id)) return;
      openingQuestionnaireMessageIdsRef.current.add(message.id);
      try {
        const ready = await waitForQuestionnaireWorkspaceReady(message);
        if (!ready) return;
        openedQuestionnaireMessageIdsRef.current.add(message.id);
        setShowOverviewScreen(false);
        props.onCloseSettings();
        setArtifactFocus({
          type: 'artifact',
          artifact: buildQuestionnaireWorkspaceArtifactRef(message),
        });
      } finally {
        openingQuestionnaireMessageIdsRef.current.delete(message.id);
      }
    },
    [props.onCloseSettings, waitForQuestionnaireWorkspaceReady]
  );

  useEffect(() => {
    if (!workspace.activeSessionId) return;
    const latestQuestionnaireMessage = [...workspace.taskMessages]
      .reverse()
      .find(
        (message) =>
          message.taskId === workspace.activeSessionId &&
          message.metadataJson?.intent === 'design_questionnaire_ready'
      );
    if (!latestQuestionnaireMessage) return;
    if (openedQuestionnaireMessageIdsRef.current.has(latestQuestionnaireMessage.id)) return;
    void openQuestionnaireWorkspace(latestQuestionnaireMessage);
  }, [openQuestionnaireWorkspace, workspace.activeSessionId, workspace.taskMessages]);

  return (
    <div
      className="nightworkers-shell h-screen overflow-hidden bg-[#111827] text-slate-100"
      {...appearanceAttributes}
    >
      <Group
        className="nightworkers-workbench-group h-screen min-h-0"
        defaultLayout={{
          'nightworkers-sidebar': initialPanelSizes.current[0],
          'nightworkers-chat': initialPanelSizes.current[1],
        }}
        onLayoutChanged={(layout) =>
          setPanelSizes([layout['nightworkers-sidebar'], layout['nightworkers-chat']])
        }
        orientation="horizontal"
      >
        <Panel
          id="nightworkers-sidebar"
          defaultSize={`${initialPanelSizes.current[0]}%`}
          minSize="18%"
          maxSize="42%"
        >
          <ProjectSidebar
            projects={workspace.projects}
            groupedSessions={workspace.groupedSessionViews}
            isProjectsLoading={workspace.isProjectsLoading}
            activeSessionId={visibleActiveSessionId}
            expandedProjects={workspace.expandedProjects}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onDeleteProject={handleDeleteProject}
            onToggleProject={handleToggleProject}
            onOpenOverview={handleOpenOverview}
            isOverviewActive={isOverviewActive}
            onQueueSession={workspace.createImplementationQueueEntry}
            onRemoveQueueEntry={workspace.removeImplementationQueueEntry}
            onOpenFolderBrowser={handleOpenFolderBrowser}
          />
        </Panel>
        <Separator className="nightworkers-panel-resize-handle" />
        <Panel
          id="nightworkers-chat"
          defaultSize={`${initialPanelSizes.current[1]}%`}
          minSize="58%"
        >
          {props.showSettings ? (
            <SettingsScreen onClose={props.onCloseSettings} workspace={workspace} />
          ) : showOverviewScreen ? (
            <OverviewScreen
              projects={workspace.projects}
              initialProjectFilterId={null}
              onOpenSession={(sessionId) => handleSelectSession(sessionId)}
            />
          ) : showQueueScreen ? (
            <ImplementationQueueScreen
              dashboard={workspace.implementationQueue}
              todoWorkflowSettings={workspace.todoWorkflowSettings}
              projects={workspace.projects}
              activeProjectFilterId={queueProjectFilterId}
              isLoading={workspace.isImplementationQueueLoading}
              onSetProjectFilter={setQueueProjectFilterId}
              onOpenSession={(sessionId) => handleSelectSession(sessionId)}
              onQueueSession={workspace.createImplementationQueueEntry}
              onArchiveEntry={workspace.archiveImplementationQueueEntry}
              onUpdateProcessorCount={workspace.updateImplementationQueueProcessorCount}
              onUpdateTodoWorkflowSettings={workspace.updateTodoWorkflowSettings}
            />
          ) : (
            <ThreadWorkspace
              activeSession={workspace.activeSession}
              sessionView={workspace.activeSessionView}
              activeProject={workspace.activeProject}
              runs={workspace.activeSessionRuns}
              latestRun={workspace.latestRun}
              taskMessages={workspace.taskMessages}
              latestRunEvents={workspace.latestRunEvents}
              llmUsageSummary={workspace.llmUsageSummary}
              activityEvents={workspace.activityEvents}
              activityArtifacts={workspace.activityArtifacts}
              activeStreamingResponse={workspace.activeStreamingResponse}
              artifactRefs={workspace.activeArtifactRefs}
              isAgentWorking={workspace.isAgentWorking}
              isAgentThinking={workspace.isAgentThinking}
              realtimeStatus={workspace.realtimeStatus}
              model={currentProviderModel || model}
              modelOptions={workspace.providerModelOptions}
              thinkingDepth={thinkingDepth}
              onModelChange={(nextModel) => {
                setModel(nextModel);
                void workspace.updateProviderModel(nextModel);
              }}
              onThinkingDepthChange={setThinkingDepth}
              onSubmitInitialPrompt={submitPrompt}
              onSubmitWorkbenchMessage={async (prompt, intent) => {
                if (workspace.activeSession) {
                  const result = await workspace.sendWorkbenchMessage(
                    workspace.activeSession.id,
                    prompt,
                    intent,
                    selectedArtifactContext
                  );
                  const latestQuestionnaireMessage = [...(result?.messages || [])]
                    .reverse()
                    .find(
                      (message) => message.metadataJson?.intent === 'design_questionnaire_ready'
                    );
                  if (latestQuestionnaireMessage) {
                    void openQuestionnaireWorkspace(latestQuestionnaireMessage);
                  }
                  return;
                }
                await submitPrompt(prompt, intent);
              }}
              canStopActiveRun={Boolean(
                workspace.latestRun &&
                  ['running', 'context_compiling', 'compiling_context', 'finalizing'].includes(
                    workspace.latestRun.status
                  )
              )}
              onStopActiveRun={async () => {
                const runId = workspace.latestRun?.id;
                if (!runId) return;
                await workspace.stopRun(runId);
              }}
              onOpenBlueprintArtifact={handleOpenBlueprintArtifact}
              isBlueprintArtifactOpen={isBlueprintArtifactOpen}
              isBlueprintActionBusy={workspace.isChatSubmitting}
              isDiffArtifactOpen={isDiffArtifactOpen}
              onDeleteSession={() => {
                if (!workspace.activeSession) return;
                workspace.deleteSession(workspace.activeSession.id);
              }}
              onQueueSession={() => {
                if (!workspace.activeSession) return;
                void workspace.createImplementationQueueEntry(workspace.activeSession.id);
              }}
              onRemoveQueueEntry={() => {
                const entryId = workspace.activeSessionView?.queueEntry?.id;
                if (!entryId) return;
                void workspace.removeImplementationQueueEntry(entryId);
              }}
              onSubmitReview={(action, note) => {
                const runId = workspace.latestRun?.id;
                if (!runId) return;
                void workspace.submitRunReview(runId, { action, note });
              }}
              onRequeueQueueEntry={(note) => {
                const entryId = workspace.activeSessionView?.queueEntry?.id;
                if (!entryId) return;
                void workspace.requeueImplementationQueueEntry(entryId, note);
              }}
              onArchiveQueueExecution={() => {
                const entryId = workspace.activeSessionView?.queueEntry?.id;
                if (!entryId) return;
                void workspace.archiveImplementationQueueEntry(entryId);
              }}
              onOpenArtifact={(artifact) => setArtifactFocus({ type: 'artifact', artifact })}
              isProjectFilesOpen={artifactFocus.type === 'project_tree'}
              onOpenProjectFiles={() => {
                if (artifactFocus.type === 'project_tree') {
                  setArtifactFocus({ type: 'closed' });
                  return;
                }
                setArtifactFocus({ type: 'project_tree' });
              }}
              onOpenDiffArtifact={(artifact) => {
                if (artifactPaneOpen && selectedArtifact?.id === artifact.id) {
                  setArtifactFocus({ type: 'closed' });
                  return;
                }
                setArtifactFocus({ type: 'artifact', artifact });
              }}
              onGrantExternalPath={async (externalPath) => {
                const project = workspace.activeProject;
                if (!project) return;
                const currentPolicy = asProjectSafetyPolicy(project.safetyPolicy);
                const externalAllowedPaths = Array.from(
                  new Set([...(currentPolicy.externalAllowedPaths || []), externalPath])
                );
                await workspace.updateProject(project.id, {
                  safetyPolicy: {
                    ...currentPolicy,
                    externalAllowedPaths,
                  },
                });
              }}
              sidePanel={
                todoPaneOpen ? <TodoListPane todos={workspace.latestRunTodos} /> : undefined
              }
              splitPanel={
                artifactPaneOpen ? (
                  <ArtifactPane
                    activeProject={workspace.activeProject}
                    activeSessionId={workspace.activeSessionId}
                    focusType={artifactFocus.type === 'project_tree' ? 'project_tree' : 'artifact'}
                    selectedArtifact={selectedArtifact}
                    taskMessages={workspace.taskMessages}
                    activityArtifacts={workspace.activityArtifacts}
                    latestRun={workspace.latestRun}
                    fileEntries={workspace.projectFileEntries}
                    fileEntriesByDirectory={workspace.projectFileEntriesByDirectory}
                    expandedDirectories={workspace.expandedProjectDirectories}
                    loadingDirectories={workspace.loadingProjectDirectories}
                    selectedFile={workspace.selectedProjectFile}
                    selectedFilePath={workspace.selectedProjectFilePath}
                    isFilesLoading={workspace.isProjectFilesLoading}
                    isFileLoading={workspace.isProjectFileLoading}
                    onToggleDirectory={workspace.toggleProjectDirectory}
                    onOpenFile={(path) => {
                      setArtifactFocus({ type: 'project_tree' });
                      workspace.openProjectFile(path);
                    }}
                    onShowDiff={() => {
                      const diffArtifact = workspace.activeArtifactRefs.find(
                        (artifact) => artifact.kind === 'diff'
                      );
                      if (diffArtifact)
                        setArtifactFocus({ type: 'artifact', artifact: diffArtifact });
                    }}
                    onQueueSession={async () => {
                      if (!workspace.activeSession) return;
                      await workspace.createImplementationQueueEntry(workspace.activeSession.id);
                    }}
                    onStartImplementation={async () => {
                      if (!workspace.activeSession) return;
                      setArtifactFocus({ type: 'closed' });
                      await workspace.sendWorkbenchMessage(
                        workspace.activeSession.id,
                        [
                          '現在のSpecification artifactを読み込み、この設計書の実装を開始してください。',
                          '実装前に read_current_specification で最新の仕様書を確認し、仕様書に沿って必要な変更を進めてください。',
                        ].join('\n'),
                        'run_task',
                        selectedArtifactContext
                      );
                    }}
                    isWorkbenchMessageSubmitting={workspace.isChatSubmitting}
                    onSubmitWorkbenchMessage={async (prompt, intent) => {
                      if (workspace.activeSession) {
                        const result = await workspace.sendWorkbenchMessage(
                          workspace.activeSession.id,
                          prompt,
                          intent,
                          selectedArtifactContext
                        );
                        const latestBlueprintMessage = [...(result?.messages || [])]
                          .reverse()
                          .find(
                            (message) =>
                              message.messageType === 'markdown_document' &&
                              (message.metadataJson?.appBlueprint ||
                                message.metadataJson?.artifactRef?.artifactId)
                          );
                        if (latestBlueprintMessage) {
                          setArtifactFocus({
                            type: 'artifact',
                            artifact: buildBlueprintArtifactRef(latestBlueprintMessage),
                          });
                        }
                        return;
                      }
                      await submitPrompt(prompt, intent);
                    }}
                  />
                ) : undefined
              }
            />
          )}
        </Panel>
      </Group>
      {!props.showSettings ? <SettingsButton onClick={props.onOpenSettings} /> : null}
      <FolderBrowserDialog
        open={props.showFolderBrowser}
        currentPath={workspace.currentBrowserPath}
        parentPath={workspace.browserParentPath}
        directories={workspace.browserDirectories}
        selectedPath={selectedPath}
        isLoading={workspace.isBrowserLoading}
        onClose={props.onCloseFolderBrowser}
        onNavigate={(path) => {
          setSelectedPath(path);
          void workspace.fetchDirectories(path);
        }}
        onSelectPath={(path) => {
          setSelectedPath(path);
        }}
        onCreateFolder={async (name) => {
          const parentPath = workspace.currentBrowserPath || undefined;
          const folder = await workspace.createFolder({ parentPath, name });
          await workspace.fetchDirectories(parentPath);
          setSelectedPath(folder.path);
        }}
        onConfirmSelection={() => {
          const selected = selectedPath || workspace.currentBrowserPath;
          if (!selected) return;
          const cleanPath = selected.replace(/[\\/]+$/, '');
          const folderName = cleanPath.split(/[\\/]/).filter(Boolean).at(-1) || 'Project';
          workspace.createProject({
            name: folderName,
            localPath: selected,
          });
          setSelectedPath('');
          props.onCloseFolderBrowser();
        }}
      />
    </div>
  );
}
