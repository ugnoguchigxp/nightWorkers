import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useWorkspaceAppearanceState } from '../contexts/WorkspaceAppearanceContext';
import {
  useWorkspaceLayoutActions,
  useWorkspaceLayoutState,
} from '../contexts/WorkspaceLayoutContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type {
  TaskMessage,
  ThinkingDepth,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
} from '../types';
import { ArtifactPane } from './ArtifactPane';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { ImplementationQueueScreen } from './ImplementationQueueScreen';
import { ProjectSidebar } from './ProjectSidebar';
import { SettingsButton } from './SettingsButton';
import { SettingsScreen } from './SettingsScreen';
import { ThreadWorkspace } from './ThreadWorkspace';

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
  const title = blueprint.name || metadata.title || 'App Blueprint';
  return {
    id: `message-${message.id}`,
    taskId: message.taskId,
    runId: message.runId || undefined,
    kind: 'app_blueprint',
    title: `Blueprint: ${title}`,
    summary: message.content.slice(0, 160),
    source: { type: 'task_message', messageId: message.id },
    createdAt: String(message.createdAt),
    metadata,
  };
}

export function NightWorkersShell(props: NightWorkersShellProps) {
  const { workspace } = props;
  const { attributes: appearanceAttributes } = useWorkspaceAppearanceState();
  const { panelSizes } = useWorkspaceLayoutState();
  const { setPanelSizes } = useWorkspaceLayoutActions();
  const initialPanelSizes = useRef(panelSizes);
  const workspaceRef = useRef(workspace);
  const [selectedPath, setSelectedPath] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('medium');
  const [selectedArtifact, setSelectedArtifact] = useState<WorkbenchArtifactRef | null>(null);
  const [showArtifactPane, setShowArtifactPane] = useState(false);
  const [showQueueScreen, setShowQueueScreen] = useState(false);
  const [queueProjectFilterId, setQueueProjectFilterId] = useState<string | null>(null);
  const artifactPaneOpen = showArtifactPane || Boolean(selectedArtifact);
  const isBlueprintArtifactOpen = artifactPaneOpen && selectedArtifact?.kind === 'app_blueprint';
  const isDiffArtifactOpen = artifactPaneOpen && selectedArtifact?.kind === 'diff';

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!selectedArtifact) return;
    const stillAvailable = workspace.activeArtifactRefs.some(
      (artifact) => artifact.id === selectedArtifact.id
    );
    if (!stillAvailable && selectedArtifact.kind !== 'diff') setSelectedArtifact(null);
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
      setSelectedArtifact(null);
      setShowArtifactPane(false);
      return;
    }
    const current = workspaceRef.current;
    const existing = current.activeArtifactRefs.find(
      (artifact) => artifact.kind === 'app_blueprint'
    );
    if (existing) {
      setShowArtifactPane(true);
      setSelectedArtifact(existing);
      return;
    }
    const session = current.activeSession;
    if (!session) return;
    const prompt = [session.objective, session.description, session.title]
      .find((value) => value?.trim())
      ?.trim();
    if (!prompt) return;
    const result = await current.sendWorkbenchMessage(session.id, prompt, 'draft_spec');
    const blueprintMessage = [...(result?.messages || [])]
      .reverse()
      .find(
        (message) =>
          message.messageType === 'markdown_document' && message.metadataJson?.appBlueprint
      );
    if (!blueprintMessage) return;
    setShowArtifactPane(true);
    setSelectedArtifact(buildBlueprintArtifactRef(blueprintMessage));
  }, [isBlueprintArtifactOpen]);
  const handleSelectSession = useCallback((sessionId: string | null) => {
    setSelectedArtifact(null);
    setShowArtifactPane(false);
    setShowQueueScreen(false);
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
  const handleOpenQueue = useCallback((projectId: string) => {
    setSelectedArtifact(null);
    setShowArtifactPane(false);
    setQueueProjectFilterId(projectId);
    setShowQueueScreen(true);
  }, []);

  return (
    <div
      className="nightworkers-shell h-screen overflow-hidden bg-[#111827] text-slate-100"
      {...appearanceAttributes}
    >
      <Group
        className="h-screen min-h-0"
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
            activeSessionId={workspace.activeSessionId}
            expandedProjects={workspace.expandedProjects}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onDeleteProject={handleDeleteProject}
            onToggleProject={handleToggleProject}
            onOpenQueue={handleOpenQueue}
            onOpenFolderBrowser={handleOpenFolderBrowser}
          />
        </Panel>
        <Separator className="group relative w-1 shrink-0 bg-slate-800 outline-none transition-colors hover:bg-slate-600 focus-visible:bg-slate-500">
          <span className="-translate-x-1/2 absolute top-1/2 left-1/2 h-12 w-1 rounded-full bg-slate-600/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </Separator>
        <Panel
          id="nightworkers-chat"
          defaultSize={`${initialPanelSizes.current[1]}%`}
          minSize={artifactPaneOpen ? '28%' : '58%'}
        >
          {props.showSettings ? (
            <SettingsScreen onClose={props.onCloseSettings} workspace={workspace} />
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
              activeProject={workspace.activeProject}
              runs={workspace.activeSessionRuns}
              latestRun={workspace.latestRun}
              taskMessages={workspace.taskMessages}
              latestRunEvents={workspace.latestRunEvents}
              activityEvents={workspace.activityEvents}
              activityArtifacts={workspace.activityArtifacts}
              activeStreamingResponse={workspace.activeStreamingResponse}
              latestRunTodos={workspace.latestRunTodos}
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
                  await workspace.sendWorkbenchMessage(workspace.activeSession.id, prompt, intent);
                  return;
                }
                await submitPrompt(prompt, intent);
              }}
              onOpenBlueprintArtifact={handleOpenBlueprintArtifact}
              isBlueprintArtifactOpen={isBlueprintArtifactOpen}
              isBlueprintActionBusy={workspace.isChatSubmitting}
              isDiffArtifactOpen={isDiffArtifactOpen}
              onDeleteSession={() => {
                if (!workspace.activeSession) return;
                workspace.deleteSession(workspace.activeSession.id);
              }}
              onOpenArtifact={setSelectedArtifact}
              isProjectFilesOpen={artifactPaneOpen && showArtifactPane && !selectedArtifact}
              onOpenProjectFiles={() => {
                if (artifactPaneOpen && showArtifactPane && !selectedArtifact) {
                  setSelectedArtifact(null);
                  setShowArtifactPane(false);
                  return;
                }
                setShowArtifactPane(true);
                setSelectedArtifact(null);
              }}
              onOpenDiffArtifact={(artifact) => {
                if (artifactPaneOpen && selectedArtifact?.id === artifact.id) {
                  setSelectedArtifact(null);
                  setShowArtifactPane(false);
                  return;
                }
                setShowArtifactPane(true);
                setSelectedArtifact(artifact);
              }}
            />
          )}
        </Panel>
        {artifactPaneOpen ? (
          <>
            <Separator className="group relative w-1 shrink-0 bg-slate-800 outline-none transition-colors hover:bg-slate-600 focus-visible:bg-slate-500">
              <span className="-translate-x-1/2 absolute top-1/2 left-1/2 h-12 w-1 rounded-full bg-slate-600/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </Separator>
            <Panel
              id="nightworkers-artifact"
              defaultSize={isBlueprintArtifactOpen ? '100%' : '42%'}
              minSize="32%"
              maxSize="55%"
            >
              <ArtifactPane
                activeProject={workspace.activeProject}
                activeSessionId={workspace.activeSessionId}
                selectedArtifact={selectedArtifact}
                taskMessages={workspace.taskMessages}
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
                  setSelectedArtifact(null);
                  workspace.openProjectFile(path);
                }}
                onShowDiff={() => {
                  const diffArtifact = workspace.activeArtifactRefs.find(
                    (artifact) => artifact.kind === 'diff'
                  );
                  if (diffArtifact) setSelectedArtifact(diffArtifact);
                }}
                isWorkbenchMessageSubmitting={workspace.isChatSubmitting}
                onSubmitWorkbenchMessage={async (prompt, intent) => {
                  if (workspace.activeSession) {
                    const result = await workspace.sendWorkbenchMessage(
                      workspace.activeSession.id,
                      prompt,
                      intent
                    );
                    const latestBlueprintMessage = [...(result?.messages || [])]
                      .reverse()
                      .find(
                        (message) =>
                          message.messageType === 'markdown_document' &&
                          message.metadataJson?.appBlueprint
                      );
                    if (latestBlueprintMessage) {
                      setSelectedArtifact(buildBlueprintArtifactRef(latestBlueprintMessage));
                    }
                    return;
                  }
                  await submitPrompt(prompt, intent);
                }}
              />
            </Panel>
          </>
        ) : null}
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
