import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  useWorkspaceLayoutActions,
  useWorkspaceLayoutState,
} from '../contexts/WorkspaceLayoutContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type { ThinkingDepth, WorkbenchArtifactRef, WorkbenchChatIntent } from '../types';
import { ArtifactPane } from './ArtifactPane';
import { FolderBrowserDialog } from './FolderBrowserDialog';
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

export function NightWorkersShell(props: NightWorkersShellProps) {
  const { workspace } = props;
  const { panelSizes } = useWorkspaceLayoutState();
  const { setPanelSizes } = useWorkspaceLayoutActions();
  const initialPanelSizes = useRef(panelSizes);
  const workspaceRef = useRef(workspace);
  const [selectedPath, setSelectedPath] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('medium');
  const [selectedArtifact, setSelectedArtifact] = useState<WorkbenchArtifactRef | null>(null);
  const [showArtifactPane, setShowArtifactPane] = useState(false);
  const artifactPaneOpen = showArtifactPane || Boolean(selectedArtifact);

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

  const submitPrompt = async (prompt: string, intent: WorkbenchChatIntent = 'draft') => {
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
  const handleSelectSession = useCallback((sessionId: string | null) => {
    setSelectedArtifact(null);
    setShowArtifactPane(false);
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
  const handleMoveSession = useCallback(
    (input: Parameters<NightWorkersWorkspaceState['moveWorkbenchSession']>[0]) => {
      void workspaceRef.current.moveWorkbenchSession(input);
    },
    []
  );
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

  return (
    <div className="min-h-screen bg-[#111827] text-slate-100">
      <Group
        className="min-h-screen"
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
            onUpdateProject={(projectId, input) => void workspace.updateProject(projectId, input)}
            onDeleteProject={handleDeleteProject}
            onMoveSession={handleMoveSession}
            onToggleProject={handleToggleProject}
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
          ) : (
            <ThreadWorkspace
              activeSession={workspace.activeSession}
              activeSessionView={workspace.activeSessionView}
              activeProject={workspace.activeProject}
              runs={workspace.activeSessionRuns}
              latestRun={workspace.latestRun}
              taskMessages={workspace.taskMessages}
              latestRunEvents={workspace.latestRunEvents}
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
              onSubmitWorkbenchMessage={(prompt, intent) =>
                workspace.activeSession
                  ? workspace.sendWorkbenchMessage(workspace.activeSession.id, prompt, intent)
                  : submitPrompt(prompt, intent)
              }
              onToggleDraftReady={async () => {
                if (!workspace.activeSession) return;
                if (!['draft', 'ready'].includes(workspace.activeSession.status)) return;
                const nextStatus = workspace.activeSession.status === 'draft' ? 'ready' : 'draft';
                await workspace.updateSessionStatus(workspace.activeSession.id, nextStatus);
              }}
              isUpdatingSessionStatus={workspace.isUpdatingSessionStatus}
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
            <Panel id="nightworkers-artifact" defaultSize="42%" minSize="32%" maxSize="55%">
              <ArtifactPane
                activeProject={workspace.activeProject}
                selectedArtifact={selectedArtifact}
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
