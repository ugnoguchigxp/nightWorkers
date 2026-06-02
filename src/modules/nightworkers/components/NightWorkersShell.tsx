import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  useWorkspaceLayoutActions,
  useWorkspaceLayoutState,
} from '../contexts/WorkspaceLayoutContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type { ThinkingDepth } from '../types';
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
  const [selectedPath, setSelectedPath] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('medium');

  const currentProviderModel =
    workspace.activeProvider === 'openai'
      ? workspace.llmSettings?.OPENAI_MODEL
      : workspace.activeProvider === 'azure'
        ? workspace.llmSettings?.AZURE_OPENAI_DEPLOYMENT_NAME
        : workspace.activeProvider === 'bedrock'
          ? workspace.llmSettings?.AWS_BEDROCK_MODEL
          : workspace.llmSettings?.CODEX_MODEL;

  const submitPrompt = async (prompt: string) => {
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
        acceptanceCriteria: 'Ensure tests compile and complete without errors',
      });
      await workspace.sendChatMessage(session.id, prompt);
      return;
    }
    await workspace.sendChatMessage(workspace.activeSession.id, prompt);
  };

  return (
    <div className="min-h-screen bg-[#111827] text-slate-100">
      <Group
        className="min-h-screen"
        defaultLayout={{
          'nightworkers-sidebar': panelSizes[0],
          'nightworkers-chat': panelSizes[1],
        }}
        onLayoutChanged={(layout) =>
          setPanelSizes([layout['nightworkers-sidebar'], layout['nightworkers-chat']])
        }
        orientation="horizontal"
      >
        <Panel
          id="nightworkers-sidebar"
          defaultSize={`${panelSizes[0]}%`}
          minSize="18%"
          maxSize="42%"
        >
          <ProjectSidebar
            projects={workspace.projects}
            sessions={workspace.sessions}
            isProjectsLoading={workspace.isProjectsLoading}
            activeSessionId={workspace.activeSessionId}
            expandedProjects={workspace.expandedProjects}
            onSelectSession={workspace.setActiveSessionId}
            onCreateSession={(repositoryId) => {
              void workspace.createSession({
                repositoryId,
                title: 'New Session',
                description: '',
                objective: '',
                acceptanceCriteria: 'Ensure tests compile and complete without errors',
              });
            }}
            onDeleteProject={(projectId) => {
              workspace.deleteProject(projectId);
            }}
            onDeleteSession={(sessionId) => {
              workspace.deleteSession(sessionId);
            }}
            onToggleProject={(projectId) =>
              workspace.setExpandedProjects((prev) => ({ ...prev, [projectId]: !prev[projectId] }))
            }
            onOpenFolderBrowser={() => {
              props.onOpenFolderBrowser();
              void workspace.fetchDirectories(selectedPath || undefined);
            }}
          />
        </Panel>
        <Separator className="group relative w-1 shrink-0 bg-slate-800 outline-none transition-colors hover:bg-slate-600 focus-visible:bg-slate-500">
          <span className="-translate-x-1/2 absolute top-1/2 left-1/2 h-12 w-1 rounded-full bg-slate-600/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </Separator>
        <Panel id="nightworkers-chat" defaultSize={`${panelSizes[1]}%`} minSize="58%">
          {props.showSettings ? (
            <SettingsScreen onClose={props.onCloseSettings} workspace={workspace} />
          ) : (
            <ThreadWorkspace
              activeSession={workspace.activeSession}
              activeProject={workspace.activeProject}
              runs={workspace.activeSessionRuns}
              latestRun={workspace.latestRun}
              taskMessages={workspace.taskMessages}
              latestRunEvents={workspace.latestRunEvents}
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
              onReviewRun={(runId) => {
                void workspace.reviewRun({ runId, action: 'complete' });
              }}
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
        onNavigate={(path) => void workspace.fetchDirectories(path)}
        onSelectPath={(path) => {
          setSelectedPath(path);
        }}
        onConfirmSelection={() => {
          const selected = selectedPath || workspace.currentBrowserPath;
          if (!selected) return;
          const cleanPath = selected.replace(/\/$/, '');
          const folderName = cleanPath.split('/').at(-1) || 'Project';
          workspace.createProject({
            name: folderName,
            localPath: selected,
            branch: 'main',
          });
          setSelectedPath('');
          props.onCloseFolderBrowser();
        }}
      />
    </div>
  );
}
