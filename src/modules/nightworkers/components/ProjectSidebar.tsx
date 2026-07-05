import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ProjectSessionGroups } from '../hooks/useNightWorkersWorkspace';
import { handleWorkbenchAnchorClick } from '../routing/workbench-link-click';
import { serializeWorkbenchRoute } from '../routing/workbench-route-state';
import type { Repository, WorkbenchSessionView } from '../types';
import { getRelativeTimestamp } from '../utils/time';

type ProjectSidebarProps = {
  projects: Repository[];
  groupedSessions: Record<string, ProjectSessionGroups>;
  isProjectsLoading: boolean;
  activeSessionId: string | null;
  expandedProjects: Record<string, boolean>;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (repositoryId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onToggleProject: (projectId: string) => void;
  onOpenProjectQueue: (projectId: string) => void;
  activeProjectQueueId: string | null;
  onOpenProjectDetail: (projectId: string) => void;
  activeProjectDetailId: string | null;
  onOpenOverview: () => void;
  isOverviewActive: boolean;
  onOpenFolderBrowser: () => void;
  onRefreshProjects: () => void;
  isProjectListRefreshing: boolean;
};

const EMPTY_PROJECT_SESSION_GROUPS: ProjectSessionGroups = {
  processing: [],
  queue: [],
  archive: [],
};

export const ProjectSidebar = memo(function ProjectSidebar(props: ProjectSidebarProps) {
  const { t } = useTranslation();
  const handleSelectSession = (session: WorkbenchSessionView) => {
    props.onSelectSession(session.task.id);
  };

  return (
    <div className="nightworkers-sidebar flex h-full min-h-0 w-full flex-col overflow-hidden border-r">
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
        <a
          href={serializeWorkbenchRoute({ kind: 'overview', range: '30d', projectId: null })}
          onClick={(event) => handleWorkbenchAnchorClick(event, props.onOpenOverview)}
          className={`nightworkers-sidebar-logo inline-flex min-w-0 items-center px-1 py-1 text-left text-base transition focus-visible:outline-none focus-visible:ring-2 ${
            props.isOverviewActive ? 'nightworkers-sidebar-link-active rounded-lg' : ''
          }`}
          aria-current={props.isOverviewActive ? 'page' : undefined}
        >
          <img
            src="/nightworkers-logo-icon-64.webp"
            alt=""
            width={24}
            height={24}
            className="mr-2 h-6 w-6 shrink-0 rounded-md"
            aria-hidden="true"
          />
          <span className="truncate">nightWorkers</span>
        </a>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={props.onRefreshProjects}
            disabled={props.isProjectListRefreshing}
            className="nightworkers-sidebar-control flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            title={t('sidebar.refreshProjects')}
          >
            <RefreshCw
              className={`h-4 w-4 ${props.isProjectListRefreshing ? 'animate-spin' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={props.onOpenFolderBrowser}
            className="nightworkers-sidebar-control flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2"
            title={t('sidebar.registerProjectFolder')}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain pb-4">
        {props.isProjectsLoading ? (
          <div className="nightworkers-sidebar-muted px-4 text-xs">
            {t('sidebar.loadingWorkspaces')}
          </div>
        ) : props.projects.length === 0 ? (
          <div className="nightworkers-sidebar-subtle px-4 text-xs italic">
            {t('sidebar.emptyProjects')}
          </div>
        ) : (
          props.projects.map((project) => {
            const grouped = props.groupedSessions[project.id] || EMPTY_PROJECT_SESSION_GROUPS;
            const isExpanded = props.expandedProjects[project.id] ?? true;
            const isProjectDetailActive = props.activeProjectDetailId === project.id;
            const sessions = [...grouped.processing, ...grouped.queue, ...grouped.archive];
            return (
              <div key={project.id} className="space-y-1">
                <div className="group flex items-center justify-between px-3 py-1">
                  <button
                    type="button"
                    onClick={() => props.onToggleProject(project.id)}
                    className="nightworkers-sidebar-control mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2"
                    aria-expanded={isExpanded}
                    title={isExpanded ? 'Collapse project' : 'Expand project'}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onToggleProject(project.id)}
                    className="nightworkers-sidebar-project flex min-w-0 flex-1 items-center rounded-lg px-1.5 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2"
                    aria-expanded={isExpanded}
                    title={isExpanded ? 'Collapse project' : 'Expand project'}
                  >
                    <span className="truncate font-medium">{project.name}</span>
                  </button>
                  <div className="flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="nightworkers-sidebar-control h-7 w-7 rounded-md p-0"
                      onClick={() => props.onCreateSession(project.id)}
                      title={t('sidebar.createTask')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <a
                      href={serializeWorkbenchRoute({
                        kind: 'project_detail',
                        projectId: project.id,
                        tab: 'overview',
                      })}
                      className={`nightworkers-sidebar-control inline-flex h-7 w-7 items-center justify-center rounded-md p-0 ${
                        isProjectDetailActive ? 'nightworkers-sidebar-link-active' : ''
                      }`}
                      aria-current={isProjectDetailActive ? 'page' : undefined}
                      onClick={(event) =>
                        handleWorkbenchAnchorClick(event, () =>
                          props.onOpenProjectDetail(project.id)
                        )
                      }
                      title={t('sidebar.openProjectDetail')}
                    >
                      <span className="flex h-full w-full items-center justify-center">
                        <LayoutDashboard className="h-3.5 w-3.5" />
                      </span>
                    </a>
                    <a
                      href={serializeWorkbenchRoute({
                        kind: 'project_queue',
                        projectId: project.id,
                        view: 'board',
                      })}
                      className={`nightworkers-sidebar-control inline-flex h-7 w-7 items-center justify-center rounded-md p-0 ${
                        props.activeProjectQueueId === project.id
                          ? 'nightworkers-sidebar-link-active'
                          : ''
                      }`}
                      aria-current={props.activeProjectQueueId === project.id ? 'page' : undefined}
                      onClick={(event) =>
                        handleWorkbenchAnchorClick(event, () =>
                          props.onOpenProjectQueue(project.id)
                        )
                      }
                      title={t('sidebar.openProjectQueue')}
                    >
                      <span className="flex h-full w-full items-center justify-center">
                        <ListTodo className="h-3.5 w-3.5" />
                      </span>
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="nightworkers-sidebar-danger-button h-7 w-7 rounded-md p-0"
                      onClick={() => {
                        const ok = window.confirm(
                          t('sidebar.confirmDeleteProject', { name: project.name })
                        );
                        if (!ok) return;
                        props.onDeleteProject(project.id);
                      }}
                      title={t('sidebar.deleteProject')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="space-y-1">
                    <SessionList
                      sessions={sessions}
                      activeSessionId={props.activeSessionId}
                      onSelectSession={handleSelectSession}
                    />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
}: {
  sessions: WorkbenchSessionView[];
  activeSessionId: string | null;
  onSelectSession: (session: WorkbenchSessionView) => void;
}) {
  const { t } = useTranslation();

  return (
    <section>
      {sessions.length === 0 ? (
        <div className="nightworkers-sidebar-subtle px-12 py-2 text-xs">{t('sidebar.noTasks')}</div>
      ) : (
        <ul className="min-w-0 space-y-1 overflow-hidden">
          {sessions.map((session) => (
            <SessionRow
              key={session.task.id}
              session={session}
              active={session.task.id === activeSessionId}
              onSelectSession={() => onSelectSession(session)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionRow({
  session,
  active,
  onSelectSession,
}: {
  session: WorkbenchSessionView;
  active: boolean;
  onSelectSession: () => void;
}) {
  return (
    <li className="min-w-0 overflow-hidden px-1">
      <a
        href={serializeWorkbenchRoute({
          kind: 'session',
          sessionId: session.task.id,
          artifact: null,
        })}
        onClick={(event) => handleWorkbenchAnchorClick(event, onSelectSession)}
        className={`nightworkers-sidebar-session-row flex min-h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-lg px-3 py-1.5 text-left transition focus-visible:outline-none focus-visible:ring-2 ${
          active ? 'nightworkers-sidebar-session-row-active' : ''
        }`}
        aria-current={active ? 'page' : undefined}
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {session.task.title}
        </span>
        <SessionTrailingIndicator session={session} />
      </a>
    </li>
  );
}

function SessionTrailingIndicator({ session }: { session: WorkbenchSessionView }) {
  const { t } = useTranslation();

  if (session.emailState === 'running') {
    return (
      <LoaderCircle
        className="nightworkers-sidebar-running h-3.5 w-3.5 shrink-0 animate-spin"
        aria-label={t('sidebar.running')}
      />
    );
  }
  if (session.emailState === 'review_needed') {
    return (
      <span
        className="nightworkers-sidebar-review-dot h-2.5 w-2.5 shrink-0 rounded-full"
        aria-label={t('sidebar.reviewNeeded')}
        role="img"
        title={t('sidebar.reviewNeeded')}
      />
    );
  }
  if (session.emailState === 'plan_ready') {
    return (
      <span
        className="nightworkers-sidebar-ready-dot h-2.5 w-2.5 shrink-0 rounded-full"
        aria-label={t('sidebar.readyForImplementation')}
        role="img"
        title={t('sidebar.readyForImplementation')}
      />
    );
  }
  if (session.emailState === 'failed' || session.emailState === 'needs_input') {
    return (
      <span
        className="nightworkers-sidebar-problem h-2.5 w-2.5 shrink-0 rounded-full"
        aria-label={t('sidebar.problem')}
        role="img"
        title={t('sidebar.problem')}
      />
    );
  }

  return (
    <span className="nightworkers-sidebar-subtle shrink-0 text-[11px]">
      {getRelativeTimestamp(session.task.updatedAt)}
    </span>
  );
}
