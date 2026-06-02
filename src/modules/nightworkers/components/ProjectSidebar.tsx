import { Button } from '@repo/design-system';
import { Archive, Folder, Plus, Trash2 } from 'lucide-react';
import type { Repository, Task } from '../types';
import { getRelativeTimestamp } from '../utils/time';

type ProjectSidebarProps = {
  projects: Repository[];
  sessions: Task[];
  isProjectsLoading: boolean;
  activeSessionId: string | null;
  expandedProjects: Record<string, boolean>;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (repositoryId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onToggleProject: (projectId: string) => void;
  onOpenFolderBrowser: () => void;
};

export function ProjectSidebar(props: ProjectSidebarProps) {
  return (
    <div className="flex min-h-screen w-full flex-col border-r border-slate-700/70 bg-[#0f172a]">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300/80">
          NightWorkers
        </span>
        <button
          type="button"
          onClick={props.onOpenFolderBrowser}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300 hover:bg-slate-700/40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-5 py-2">
        {props.isProjectsLoading ? (
          <div className="px-4 text-xs text-slate-300/70">Loading workspaces...</div>
        ) : props.projects.length === 0 ? (
          <div className="px-4 text-xs italic text-slate-300/70">
            No project folders registered. Click "+" to register a local directory.
          </div>
        ) : (
          props.projects.map((project) => {
            const projSessions = props.sessions.filter((s) => s.repositoryId === project.id);
            const isExpanded = props.expandedProjects[project.id] ?? true;
            return (
              <div key={project.id} className="space-y-1">
                <div className="flex items-center justify-between px-4 py-1.5 text-slate-200/90">
                  <button
                    type="button"
                    onClick={() => props.onToggleProject(project.id)}
                    className="flex items-center gap-2 text-sm font-bold"
                  >
                    <Folder className="h-4 w-4 text-slate-400" />
                    <span>{project.name}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-rose-300 hover:text-rose-200"
                      onClick={() => {
                        const ok = window.confirm(
                          `Project "${project.name}" を削除します。関連するSessionも削除される可能性があります。続行しますか？`
                        );
                        if (!ok) return;
                        props.onDeleteProject(project.id);
                      }}
                      title="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => props.onCreateSession(project.id)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="space-y-0.5">
                    {projSessions.map((session) => (
                      <div
                        key={session.id}
                        className={`mx-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-md border pl-8 pr-2 py-1.5 text-xs ${session.id === props.activeSessionId ? 'border-slate-500/70 bg-slate-800/60 text-slate-100' : 'border-slate-700/70 text-slate-300 hover:border-slate-500/60 hover:bg-slate-800/40'}`}
                      >
                        <button
                          type="button"
                          onClick={() => props.onSelectSession(session.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate pr-2">{session.title}</span>
                        </button>
                        <span className="shrink-0 pr-2 text-[10px] text-slate-400">
                          {getRelativeTimestamp(session.createdAt)}
                        </span>
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 hover:bg-slate-800/60 hover:text-amber-200"
                          onClick={() => {
                            const ok = window.confirm(
                              `Session "${session.title}" を archive(削除)します。続行しますか？`
                            );
                            if (!ok) return;
                            props.onDeleteSession(session.id);
                          }}
                          title="Archive session"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
