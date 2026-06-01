import { Button } from '@repo/design-system';
import { Folder, Plus } from 'lucide-react';
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
  onToggleProject: (projectId: string) => void;
  onOpenFolderBrowser: () => void;
};

export function ProjectSidebar(props: ProjectSidebarProps) {
  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-r border-zinc-800 bg-[#0f0f11]">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
          NightWorkers
        </span>
        <button
          type="button"
          onClick={props.onOpenFolderBrowser}
          className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-5 py-2">
        {props.isProjectsLoading ? (
          <div className="px-4 text-xs text-zinc-500">Loading workspaces...</div>
        ) : props.projects.length === 0 ? (
          <div className="px-4 text-xs italic text-zinc-500">
            No project folders registered. Click "+" to register a local directory.
          </div>
        ) : (
          props.projects.map((project) => {
            const projSessions = props.sessions.filter((s) => s.repositoryId === project.id);
            const isExpanded = props.expandedProjects[project.id];
            const displaySessions = isExpanded ? projSessions : projSessions.slice(0, 5);
            return (
              <div key={project.id} className="space-y-1">
                <div className="flex items-center justify-between px-4 py-1.5 text-zinc-400">
                  <button
                    type="button"
                    onClick={() => props.onToggleProject(project.id)}
                    className="flex items-center gap-2 text-sm font-bold"
                  >
                    <Folder className="h-4 w-4 text-zinc-500" />
                    <span>{project.name}</span>
                  </button>
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
                <div className="space-y-0.5">
                  {displaySessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => props.onSelectSession(session.id)}
                      className={`mx-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-md pl-8 pr-3 py-1.5 text-xs ${session.id === props.activeSessionId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900/40'}`}
                    >
                      <span className="truncate pr-2">{session.title}</span>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {getRelativeTimestamp(session.createdAt)}
                      </span>
                    </button>
                  ))}
                  {projSessions.length > 5 && !isExpanded ? (
                    <button
                      type="button"
                      onClick={() => props.onToggleProject(project.id)}
                      className="mx-2 rounded-md pl-8 pr-3 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-900/20"
                    >
                      もっと表示する
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
