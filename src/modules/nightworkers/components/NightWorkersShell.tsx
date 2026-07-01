import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { toDeepRecord } from '../../../../shared/json-record';
import { fetchDesignQuestionnaireSession } from '../../questionnaire';
import { ImplementationQueueScreen, ProjectQueueScreen, useImplementationQueue } from '../../queue';
import { fetchPlanModeWorkspace } from '../../specification';
import { useWorkspaceAppearanceState } from '../contexts/WorkspaceAppearanceContext';
import {
  useWorkspaceLayoutActions,
  useWorkspaceLayoutState,
} from '../contexts/WorkspaceLayoutContext';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import { shouldAutoOpenPlanArtifact } from '../planArtifactVisibility';
import type {
  LlmModelTarget,
  LlmRoleRoute,
  ProjectSafetyPolicy,
  Task,
  TaskMessage,
  ThinkingDepth,
  ThinkingDepthOption,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';
import { buildArtifactContext, buildPlanModeWorkspaceArtifactRef } from '../workbenchSelectors';
import { ArtifactPane } from './ArtifactPane';
import { FolderBrowserDialog } from './FolderBrowserDialog';
import { OverviewScreen } from './OverviewScreen';
import { ProjectDetailScreen } from './ProjectDetailScreen';
import { ProjectSidebar } from './ProjectSidebar';
import { BlueprintShowcaseButton, SettingsButton } from './SettingsButton';
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

function asProjectSafetyPolicy(value: unknown): ProjectSafetyPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ProjectSafetyPolicy;
}

type ArtifactPaneFocus =
  | { type: 'closed' }
  | { type: 'project_tree' }
  | { type: 'todo' }
  | { type: 'artifact'; artifact: WorkbenchArtifactRef };

type ComposerModelTarget = {
  providerEndpointId: string;
  model: string;
};

const modelTargetKey = (target: ComposerModelTarget) => JSON.stringify(target);

function parseModelTargetKey(value: string): ComposerModelTarget | null {
  try {
    const parsed = JSON.parse(value) as Partial<ComposerModelTarget>;
    if (typeof parsed.providerEndpointId === 'string' && typeof parsed.model === 'string') {
      return { providerEndpointId: parsed.providerEndpointId, model: parsed.model };
    }
  } catch {
    // Legacy model values fall through.
  }
  return null;
}

function isThinkingModel(modelName: string) {
  const normalized = modelName.toLowerCase();
  return (
    /^gpt-5(\b|[.-])/.test(normalized) ||
    /^o[134](\b|[.-])/.test(normalized) ||
    normalized.includes('codex') ||
    normalized.includes('reasoning') ||
    normalized.includes('thinking') ||
    normalized.includes('deepseek-r1') ||
    normalized.includes('qwen3')
  );
}

function resolveComposerRouteTarget(
  routes: LlmRoleRoute[] | undefined,
  availableModelKeys: Set<string>
): LlmModelTarget | null {
  const roles = ['plan', 'implementation'] as const;
  for (const role of roles) {
    const route = routes?.find((item) => item.role === role);
    if (!route) continue;
    for (const target of [route.primary, ...route.fallbacks]) {
      const key = modelTargetKey(target);
      if (availableModelKeys.has(key)) return target;
    }
  }
  return null;
}

function isImplementationLockedStatus(status: string | undefined) {
  return status === 'completed';
}

function isDesignQuestionnaireReadyMessage(message: TaskMessage) {
  return String(toDeepRecord(message.metadataJson).intent) === 'design_questionnaire_ready';
}

function designQuestionnaireMessageIds(messages: TaskMessage[]) {
  return new Set(messages.filter(isDesignQuestionnaireReadyMessage).map((message) => message.id));
}

export function projectEvaluationDraftStorageKey(taskId: string) {
  return `nightworkers:composer:${taskId}`;
}

export function projectEvaluationTaskPromptDrafts(tasks: Task[]) {
  return tasks
    .map((task) => ({ taskId: task.id, prompt: task.objective?.trim() || '' }))
    .filter((draft) => draft.prompt.length > 0);
}

export function NightWorkersShell(props: NightWorkersShellProps) {
  const { workspace } = props;
  const { attributes: appearanceAttributes } = useWorkspaceAppearanceState();
  const { panelSizes } = useWorkspaceLayoutState();
  const { setPanelSizes } = useWorkspaceLayoutActions();
  const initialPanelSizes = useRef(panelSizes);
  const workspaceRef = useRef(workspace);
  const queueState = useImplementationQueue();
  const openedQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
  const openingQuestionnaireMessageIdsRef = useRef<Set<string>>(new Set());
  const previousActiveSessionIdRef = useRef<string | null>(null);
  const userSelectedComposerModelRef = useRef(false);
  const [selectedPath, setSelectedPath] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [thinkingDepth, setThinkingDepth] = useState<ThinkingDepth>('medium');
  const [artifactFocus, setArtifactFocus] = useState<ArtifactPaneFocus>({ type: 'closed' });
  const [clearedArtifactContextId, setClearedArtifactContextId] = useState<string | null>(null);
  const [showQueueScreen, setShowQueueScreen] = useState(false);
  const [showOverviewScreen, setShowOverviewScreen] = useState(true);
  const [projectQueueProjectId, setProjectQueueProjectId] = useState<string | null>(null);
  const [projectDetailProjectId, setProjectDetailProjectId] = useState<string | null>(null);
  const [queueProjectFilterId, setQueueProjectFilterId] = useState<string | null>(null);
  const isOverviewActive = showOverviewScreen && !props.showSettings;
  const projectQueueProject = projectQueueProjectId
    ? workspace.projects.find((project) => project.id === projectQueueProjectId) || null
    : null;
  const projectDetailProject = projectDetailProjectId
    ? workspace.projects.find((project) => project.id === projectDetailProjectId) || null
    : null;
  const projectQueueSessionViews = projectQueueProject
    ? [
        ...(workspace.groupedSessionViews[projectQueueProject.id]?.processing || []),
        ...(workspace.groupedSessionViews[projectQueueProject.id]?.queue || []),
        ...(workspace.groupedSessionViews[projectQueueProject.id]?.archive || []),
      ]
    : [];
  const projectDetailSessionViews = projectDetailProject
    ? [
        ...(workspace.groupedSessionViews[projectDetailProject.id]?.processing || []),
        ...(workspace.groupedSessionViews[projectDetailProject.id]?.queue || []),
        ...(workspace.groupedSessionViews[projectDetailProject.id]?.archive || []),
      ]
    : [];
  const visibleActiveSessionId =
    props.showSettings || isOverviewActive || projectQueueProject || projectDetailProject
      ? null
      : workspace.activeSessionId;
  const selectedArtifact = artifactFocus.type === 'artifact' ? artifactFocus.artifact : null;
  const selectedArtifactContext =
    selectedArtifact && selectedArtifact.id !== clearedArtifactContextId
      ? buildArtifactContext(selectedArtifact, workspace.activeSessionId)
      : null;
  const artifactPaneOpen = artifactFocus.type !== 'closed';
  const isTodoArtifactOpen = artifactFocus.type === 'todo';
  const isBlueprintArtifactOpen =
    artifactPaneOpen &&
    (selectedArtifact?.kind === 'plan_mode_workspace' ||
      selectedArtifact?.kind === 'app_blueprint');
  const hasTodoArtifact = Boolean(workspace.activeSession);
  const isActiveImplementationLocked = isImplementationLockedStatus(
    workspace.activeSession?.status
  );
  const activeSessionId = workspace.activeSessionId;
  const canStopLatestRun = Boolean(
    workspace.latestRun &&
      ['running', 'context_compiling', 'compiling_context', 'finalizing'].includes(
        workspace.latestRun.status
      )
  );

  if (previousActiveSessionIdRef.current !== activeSessionId) {
    previousActiveSessionIdRef.current = activeSessionId;
    userSelectedComposerModelRef.current = false;
  }

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!selectedArtifact) return;
    if (selectedArtifact.taskId !== workspace.activeSessionId) {
      setArtifactFocus({ type: 'closed' });
      return;
    }
    if (selectedArtifact.kind === 'plan_mode_workspace') return;
    const stillAvailable = workspace.activeArtifactRefs.some(
      (artifact) => artifact.id === selectedArtifact.id
    );
    if (!stillAvailable && selectedArtifact.kind !== 'diff') setArtifactFocus({ type: 'closed' });
  }, [selectedArtifact, workspace.activeArtifactRefs, workspace.activeSessionId]);

  const currentProviderModel =
    workspace.activeProvider === 'openai'
      ? workspace.llmSettings?.OPENAI_MODEL
      : workspace.activeProvider === 'azure'
        ? workspace.llmSettings?.AZURE_OPENAI_DEPLOYMENT_NAME
        : workspace.activeProvider === 'bedrock'
          ? workspace.llmSettings?.AWS_BEDROCK_MODEL
          : workspace.activeProvider === 'codex'
            ? workspace.llmSettings?.CODEX_MODEL
            : null;
  const composerModelOptions = useMemo(() => {
    const endpoints = workspace.llmSettings?.providerEndpoints || [];
    const options = endpoints
      .filter((endpoint) =>
        endpoint.kind === 'codex' ? workspace.llmSettings?.CODEX_ENABLED : endpoint.enabled
      )
      .flatMap((endpoint) =>
        endpoint.models.map((endpointModel) => ({
          value: modelTargetKey({ providerEndpointId: endpoint.id, model: endpointModel }),
          label:
            endpoint.modelDisplayNames?.[endpointModel]?.trim() ||
            `${endpointModel} (${endpoint.name})`,
        }))
      );
    return options.length ? options : workspace.providerModelOptions;
  }, [workspace.llmSettings, workspace.providerModelOptions]);
  const composerModelOptionKeys = useMemo(
    () => new Set(composerModelOptions.map((option) => option.value)),
    [composerModelOptions]
  );
  const preferredRouteTarget = useMemo(
    () => resolveComposerRouteTarget(workspace.llmSettings?.roleRoutes, composerModelOptionKeys),
    [composerModelOptionKeys, workspace.llmSettings?.roleRoutes]
  );
  const selectedModelTarget = parseModelTargetKey(model);
  const selectedComposerModel = selectedModelTarget?.model || currentProviderModel || model;
  const selectedComposerModelSupportsThinking = isThinkingModel(selectedComposerModel);
  const composerThinkingDepthOptions: ThinkingDepthOption[] = selectedComposerModelSupportsThinking
    ? THINKING_DEPTH_OPTIONS
    : [];

  useEffect(() => {
    if (!composerModelOptions.length) return;
    const currentModelIsAvailable = composerModelOptionKeys.has(model);
    if (userSelectedComposerModelRef.current && currentModelIsAvailable) return;
    if (!currentModelIsAvailable) userSelectedComposerModelRef.current = false;
    const nextModel = preferredRouteTarget
      ? modelTargetKey(preferredRouteTarget)
      : composerModelOptions[0].value;
    if (model !== nextModel) setModel(nextModel);
    if (
      preferredRouteTarget?.thinkingDepth &&
      isThinkingModel(preferredRouteTarget.model) &&
      thinkingDepth !== preferredRouteTarget.thinkingDepth
    ) {
      setThinkingDepth(preferredRouteTarget.thinkingDepth);
    }
  }, [composerModelOptionKeys, composerModelOptions, model, preferredRouteTarget, thinkingDepth]);

  useEffect(() => {
    if (selectedComposerModelSupportsThinking) return;
    setThinkingDepth('medium');
  }, [selectedComposerModelSupportsThinking]);

  const buildComposerLlmSelection = () => {
    if (!userSelectedComposerModelRef.current) return undefined;
    const target = parseModelTargetKey(model);
    const selected = target || { providerEndpointId: '', model: currentProviderModel || model };
    return {
      model: selected.model,
      providerEndpointId: selected.providerEndpointId || undefined,
      thinkingDepth: isThinkingModel(selected.model) ? thinkingDepth : undefined,
    };
  };
  const handleComposerModelChange = useCallback((nextModel: string) => {
    userSelectedComposerModelRef.current = true;
    setModel(nextModel);
  }, []);

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
      userSelectedComposerModelRef.current = false;
      await workspace.sendWorkbenchMessage(
        session.id,
        prompt,
        intent,
        null,
        buildComposerLlmSelection()
      );
      return;
    }
    await workspace.sendWorkbenchMessage(
      workspace.activeSession.id,
      prompt,
      intent,
      null,
      buildComposerLlmSelection()
    );
  };
  const handleOpenBlueprintArtifact = useCallback(async () => {
    if (isBlueprintArtifactOpen) {
      setArtifactFocus({ type: 'closed' });
      return;
    }
    const current = workspaceRef.current;
    const existing =
      current.activeArtifactRefs.find((artifact) => artifact.kind === 'plan_mode_workspace') ||
      current.activeArtifactRefs.find((artifact) => artifact.kind === 'app_blueprint');
    if (existing) {
      setClearedArtifactContextId(null);
      setArtifactFocus({ type: 'artifact', artifact: existing });
      return;
    }
  }, [isBlueprintArtifactOpen]);
  const focusTodoArtifact = useCallback(() => {
    setShowOverviewScreen(false);
    setShowQueueScreen(false);
    setProjectQueueProjectId(null);
    setProjectDetailProjectId(null);
    props.onCloseSettings();
    setClearedArtifactContextId(null);
    setArtifactFocus({ type: 'todo' });
  }, [props.onCloseSettings]);
  const handleOpenTodoArtifact = useCallback(() => {
    if (!workspaceRef.current.activeSession) return;
    if (artifactFocus.type === 'todo') {
      setArtifactFocus({ type: 'closed' });
      return;
    }
    focusTodoArtifact();
  }, [artifactFocus.type, focusTodoArtifact]);
  const startSessionAndFocusTodo = useCallback(
    async (sessionId: string) => {
      const current = workspaceRef.current;
      const targetSession =
        current.sessions.find((session) => session.id === sessionId) || current.activeSession;
      if (isImplementationLockedStatus(targetSession?.status)) return;
      setShowOverviewScreen(false);
      setShowQueueScreen(false);
      setProjectQueueProjectId(null);
      setProjectDetailProjectId(null);
      props.onCloseSettings();
      current.setActiveSessionId(sessionId);
      setClearedArtifactContextId(null);
      setArtifactFocus({ type: 'todo' });
      await current.startRun(sessionId);
      setArtifactFocus({ type: 'todo' });
    },
    [props.onCloseSettings]
  );
  const queueSessionAndFocusTodo = useCallback(
    async (sessionId: string) => {
      const current = workspaceRef.current;
      const targetSession =
        current.sessions.find((session) => session.id === sessionId) || current.activeSession;
      if (isImplementationLockedStatus(targetSession?.status)) return;
      setShowOverviewScreen(false);
      setShowQueueScreen(false);
      setProjectQueueProjectId(null);
      setProjectDetailProjectId(null);
      props.onCloseSettings();
      current.setActiveSessionId(sessionId);
      setClearedArtifactContextId(null);
      setArtifactFocus({ type: 'todo' });
      await queueState.createImplementationQueueEntry(sessionId);
      setArtifactFocus({ type: 'todo' });
    },
    [props.onCloseSettings, queueState]
  );
  const queueActiveSessionAndFocusTodo = useCallback(async () => {
    const sessionId = workspaceRef.current.activeSession?.id;
    if (!sessionId) return;
    await queueSessionAndFocusTodo(sessionId);
  }, [queueSessionAndFocusTodo]);
  const addActiveSessionToQueue = useCallback(async () => {
    const activeSession = workspaceRef.current.activeSession;
    if (isImplementationLockedStatus(activeSession?.status)) return;
    const sessionId = activeSession?.id;
    if (!sessionId) return;
    await queueState.createImplementationQueueEntry(sessionId);
  }, [queueState]);
  const handleSelectSession = useCallback((sessionId: string | null) => {
    setArtifactFocus({ type: 'closed' });
    setShowQueueScreen(false);
    setShowOverviewScreen(false);
    setProjectQueueProjectId(null);
    setProjectDetailProjectId(null);
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
    setProjectQueueProjectId(null);
    setProjectDetailProjectId(null);
    setShowOverviewScreen(true);
    props.onCloseSettings();
  }, [props.onCloseSettings]);
  const handleOpenProjectQueue = useCallback(
    (projectId: string) => {
      setArtifactFocus({ type: 'closed' });
      setShowQueueScreen(false);
      setShowOverviewScreen(false);
      setProjectQueueProjectId(projectId);
      setProjectDetailProjectId(null);
      props.onCloseSettings();
    },
    [props.onCloseSettings]
  );
  const handleOpenProjectDetail = useCallback(
    (projectId: string) => {
      setArtifactFocus({ type: 'closed' });
      setShowQueueScreen(false);
      setShowOverviewScreen(false);
      setProjectQueueProjectId(null);
      setProjectDetailProjectId(projectId);
      props.onCloseSettings();
    },
    [props.onCloseSettings]
  );
  const handleProjectEvaluationTasksCreated = useCallback(
    (tasks: Task[]) => {
      const drafts = projectEvaluationTaskPromptDrafts(tasks);
      try {
        for (const draft of drafts) {
          window.localStorage.setItem(projectEvaluationDraftStorageKey(draft.taskId), draft.prompt);
        }
      } catch {
        // localStorage is a convenience for Composer drafts; the Task objective still has the prompt.
      }
      const firstTask = tasks[0];
      if (!firstTask) return;
      setArtifactFocus({ type: 'closed' });
      setShowQueueScreen(false);
      setShowOverviewScreen(false);
      setProjectQueueProjectId(null);
      setProjectDetailProjectId(null);
      props.onCloseSettings();
      workspaceRef.current.setActiveSessionId(firstTask.id);
    },
    [props.onCloseSettings]
  );

  const waitForQuestionnaireWorkspaceReady = useCallback(async (message: TaskMessage) => {
    const sessionId = String(toDeepRecord(message.metadataJson).questionnaireSessionId || '');
    if (!sessionId) return false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const [workspaceRes, sessionRes] = await Promise.all([
        fetchPlanModeWorkspace(message.taskId),
        fetchDesignQuestionnaireSession(message.taskId, sessionId),
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
    async (message: TaskMessage, initialTab: 'questionnaire' | 'status' = 'questionnaire') => {
      if (openingQuestionnaireMessageIdsRef.current.has(message.id)) return;
      openingQuestionnaireMessageIdsRef.current.add(message.id);
      try {
        const ready = await waitForQuestionnaireWorkspaceReady(message);
        if (!ready) return;
        openedQuestionnaireMessageIdsRef.current.add(message.id);
        setShowOverviewScreen(false);
        setProjectDetailProjectId(null);
        props.onCloseSettings();
        setClearedArtifactContextId(null);
        setArtifactFocus({
          type: 'artifact',
          artifact: buildPlanModeWorkspaceArtifactRef(message, initialTab),
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
          message.taskId === workspace.activeSessionId && isDesignQuestionnaireReadyMessage(message)
      );
    if (!latestQuestionnaireMessage) return;
    if (
      !shouldAutoOpenPlanArtifact({
        activeSession: workspace.activeSession,
        sessionView: workspace.activeSessionView,
        latestRun: workspace.latestRun,
        isChatSubmitting: workspace.isChatSubmitting,
        hasPlanArtifact: true,
      })
    ) {
      return;
    }
    if (openedQuestionnaireMessageIdsRef.current.has(latestQuestionnaireMessage.id)) return;
    void openQuestionnaireWorkspace(latestQuestionnaireMessage, 'questionnaire');
  }, [
    openQuestionnaireWorkspace,
    workspace.activeSession,
    workspace.activeSessionId,
    workspace.activeSessionView,
    workspace.isChatSubmitting,
    workspace.latestRun,
    workspace.taskMessages,
  ]);

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
            onOpenProjectQueue={handleOpenProjectQueue}
            activeProjectQueueId={projectQueueProjectId}
            onOpenProjectDetail={handleOpenProjectDetail}
            activeProjectDetailId={projectDetailProjectId}
            onOpenOverview={handleOpenOverview}
            isOverviewActive={isOverviewActive}
            onOpenFolderBrowser={handleOpenFolderBrowser}
            onRefreshProjects={() => void workspace.refreshProjectList()}
            isProjectListRefreshing={workspace.isProjectListRefreshing}
          />
        </Panel>
        <Separator className="nightworkers-panel-resize-handle" />
        <Panel
          id="nightworkers-chat"
          defaultSize={`${initialPanelSizes.current[1]}%`}
          minSize="58%"
        >
          {props.showSettings ? (
            <SettingsScreen
              activeProject={workspace.activeProject}
              onClose={props.onCloseSettings}
            />
          ) : showOverviewScreen ? (
            <OverviewScreen
              projects={workspace.projects}
              initialProjectFilterId={null}
              onOpenSession={(sessionId) => handleSelectSession(sessionId)}
            />
          ) : projectQueueProject ? (
            <ProjectQueueScreen
              implementationQueue={queueState.implementationQueue}
              isLoading={queueState.isImplementationQueueLoading || workspace.isSessionsLoading}
              onOpenSession={(sessionId) => handleSelectSession(sessionId)}
              onQueueSession={queueState.createImplementationQueueEntry}
              onRequeueEntry={queueState.requeueImplementationQueueEntry}
              onUpdateQueueEntry={queueState.updateImplementationQueueEntry}
              project={projectQueueProject}
              sessionViews={projectQueueSessionViews}
              sessions={workspace.sessions}
            />
          ) : projectDetailProject ? (
            <ProjectDetailScreen
              project={projectDetailProject}
              sessionViews={projectDetailSessionViews}
              onOpenSession={(sessionId) => handleSelectSession(sessionId)}
              onEvaluationTasksCreated={handleProjectEvaluationTasksCreated}
            />
          ) : showQueueScreen ? (
            <ImplementationQueueScreen
              dashboard={queueState.implementationQueue}
              projects={workspace.projects}
              activeProjectFilterId={queueProjectFilterId}
              isLoading={queueState.isImplementationQueueLoading}
              onSetProjectFilter={setQueueProjectFilterId}
              onOpenSession={(sessionId) => handleSelectSession(sessionId)}
              onQueueSession={queueSessionAndFocusTodo}
              onArchiveEntry={queueState.archiveImplementationQueueEntry}
              onUpdateProcessorCount={queueState.updateImplementationQueueProcessorCount}
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
              backgroundProcesses={workspace.backgroundProcesses}
              activeStreamingResponse={workspace.activeStreamingResponse}
              artifactRefs={workspace.activeArtifactRefs}
              activeArtifactContext={selectedArtifactContext}
              isAgentWorking={workspace.isAgentWorking}
              isAgentThinking={workspace.isAgentThinking}
              realtimeStatus={workspace.realtimeStatus}
              model={model}
              modelOptions={composerModelOptions}
              thinkingDepth={thinkingDepth}
              onModelChange={handleComposerModelChange}
              onThinkingDepthChange={setThinkingDepth}
              thinkingDepthOptions={composerThinkingDepthOptions}
              onSubmitInitialPrompt={submitPrompt}
              onSubmitWorkbenchMessage={async (prompt, intent) => {
                if (workspace.activeSession) {
                  const existingQuestionnaireMessageIds = designQuestionnaireMessageIds(
                    workspace.taskMessages
                  );
                  const result = await workspace.sendWorkbenchMessage(
                    workspace.activeSession.id,
                    prompt,
                    intent,
                    selectedArtifactContext,
                    buildComposerLlmSelection()
                  );
                  if (!result?.run) {
                    const latestQuestionnaireMessage = [...(result?.messages || [])]
                      .reverse()
                      .find(
                        (message) =>
                          !existingQuestionnaireMessageIds.has(message.id) &&
                          isDesignQuestionnaireReadyMessage(message)
                      );
                    if (latestQuestionnaireMessage) {
                      void openQuestionnaireWorkspace(latestQuestionnaireMessage, 'questionnaire');
                    }
                  }
                  return;
                }
                await submitPrompt(prompt, intent);
              }}
              canStopActiveRun={workspace.isChatSubmitting || canStopLatestRun}
              onStopActiveRun={async () => {
                if (canStopLatestRun && workspace.latestRun?.id) {
                  await workspace.stopRun(workspace.latestRun.id);
                  return;
                }
                await workspace.cancelChatSubmit();
              }}
              onStopBackgroundProcess={workspace.stopBackgroundProcess}
              onOpenBlueprintArtifact={handleOpenBlueprintArtifact}
              isBlueprintArtifactOpen={isBlueprintArtifactOpen}
              isBlueprintActionBusy={workspace.isChatSubmitting}
              onOpenTodoArtifact={handleOpenTodoArtifact}
              isTodoArtifactOpen={isTodoArtifactOpen}
              hasTodoArtifact={hasTodoArtifact}
              onDeleteSession={() => {
                if (!workspace.activeSession) return;
                workspace.deleteSession(workspace.activeSession.id);
              }}
              onQueueSession={async () => {
                const sessionId = workspaceRef.current.activeSession?.id;
                if (!sessionId) return;
                await startSessionAndFocusTodo(sessionId);
              }}
              onRemoveQueueEntry={() => {
                const entryId = workspace.activeSessionView?.queueEntry?.id;
                if (!entryId) return;
                void queueState.removeImplementationQueueEntry(entryId);
              }}
              onRequeueQueueEntry={(note) => {
                const entryId = workspace.activeSessionView?.queueEntry?.id;
                if (!entryId) return;
                void queueState.requeueImplementationQueueEntry(entryId, note);
              }}
              onOpenArtifact={(artifact) => {
                setClearedArtifactContextId(null);
                setArtifactFocus({ type: 'artifact', artifact });
              }}
              onClearArtifactContext={() => {
                if (selectedArtifact) setClearedArtifactContextId(selectedArtifact.id);
              }}
              isProjectFilesOpen={artifactFocus.type === 'project_tree'}
              onOpenProjectFiles={() => {
                if (artifactFocus.type === 'project_tree') {
                  setArtifactFocus({ type: 'closed' });
                  return;
                }
                setClearedArtifactContextId(null);
                setArtifactFocus({ type: 'project_tree' });
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
              splitPanel={
                isTodoArtifactOpen ? (
                  <TodoListPane todos={workspace.latestRunTodos} />
                ) : artifactPaneOpen ? (
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
                    projectDiff={workspace.projectDiff}
                    isDiffLoading={workspace.isProjectDiffLoading}
                    onToggleDirectory={workspace.toggleProjectDirectory}
                    onOpenFile={(path) => {
                      setArtifactFocus({ type: 'project_tree' });
                      workspace.openProjectFile(path);
                    }}
                    onRefreshFiles={workspace.refreshProjectFiles}
                    onRefreshDiff={workspace.refreshProjectDiff}
                    onQueueSession={async () => {
                      await queueActiveSessionAndFocusTodo();
                    }}
                    onAddToQueue={addActiveSessionToQueue}
                    isImplementationLocked={isActiveImplementationLocked}
                  />
                ) : undefined
              }
            />
          )}
        </Panel>
      </Group>
      {!props.showSettings ? (
        <>
          <SettingsButton onClick={props.onOpenSettings} />
          <BlueprintShowcaseButton />
        </>
      ) : null}
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
