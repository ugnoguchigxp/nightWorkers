import { Button } from '@repo/design-system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  AlertTriangle,
  Clock,
  FolderOpen,
  HelpCircle,
  Play,
  Plus,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';
import { client } from '../lib/api';

export const Route = createFileRoute('/')({
  component: TasksDashboard,
});

function TasksDashboard() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(3600);

  // Fetch Repositories
  const { data: repos = [] } = useQuery({
    queryKey: ['repositories'],
    queryFn: async () => {
      const res = await client.repositories.$get();
      if (!res.ok) throw new Error('Failed to fetch repositories');
      return res.json();
    },
  });

  // Fetch Tasks
  const {
    data: tasks = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const res = await client.tasks.$get();
      if (!res.ok) throw new Error('Failed to fetch tasks');
      return res.json();
    },
    refetchInterval: 3000, // auto refetch every 3s to capture execution updates
  });

  // Create Task Mutation
  const createTaskMutation = useMutation({
    mutationFn: async (data: {
      repositoryId: string;
      title: string;
      description: string;
      timeoutSeconds: number;
    }) => {
      const res = await client.tasks.$post({ json: data });
      if (!res.ok) throw new Error('Failed to create task');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setTitle('');
      setDescription('');
    },
  });

  // Start Run Mutation
  const startRunMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await client.tasks[':id'].run.$post({ param: { id: taskId } });
      if (!res.ok) throw new Error('Failed to start run');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !repositoryId) return;
    createTaskMutation.mutate({
      repositoryId,
      title,
      description,
      timeoutSeconds,
    });
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      case 'failed':
        return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
      case 'running':
      case 'compiling_context':
        return 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 animate-pulse';
      case 'needs_review':
        return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
      default:
        return 'bg-muted text-muted-foreground border border-border';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
            Control Dashboard
          </h1>
          <p className="text-muted-foreground">Manage your local autonomous development tasks</p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Creation Panel */}
        <div className="lg:col-span-1 bg-card border border-border rounded-xl p-6 shadow-lg shadow-black/20">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-foreground">
            <Plus className="h-5 w-5 text-primary" />
            New Task Intake
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1">
                Target Repository
              </span>
              <select
                value={repositoryId}
                onChange={(e) => setRepositoryId(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              >
                <option value="">Select a repository...</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.name} ({repo.localPath})
                  </option>
                ))}
              </select>
              {repos.length === 0 && (
                <p className="text-xs text-rose-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  <Link to="/repositories" className="underline">
                    Please add a repository first.
                  </Link>
                </p>
              )}
            </div>

            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1">
                Task Title / Goal
              </span>
              <input
                type="text"
                placeholder="e.g. Implement user profile page"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1">
                Task Context & Details
              </span>
              <textarea
                placeholder="Describe the instructions or bugs to fix..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Clock className="h-4 w-4" /> Timeout (seconds)
              </span>
              <input
                type="number"
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={createTaskMutation.isPending || !repositoryId}
              className="w-full"
            >
              {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </form>
        </div>

        {/* Task List Panel */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
            <Terminal className="h-5 w-5 text-cyan-400" />
            Active & Pending Operations
          </h2>

          {isLoading ? (
            <div className="text-center py-12 border border-border border-dashed rounded-xl bg-card/25">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 border border-border border-dashed rounded-xl bg-card/25">
              <HelpCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No tasks registered yet.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {tasks.map((task) => {
                const repo = repos.find((r) => r.id === task.repositoryId);
                return (
                  <div
                    key={task.id}
                    className="bg-card border border-border hover:border-primary/30 rounded-xl p-5 shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <Link
                          to="/tasks/$id"
                          params={{ id: task.id }}
                          className="font-bold text-lg text-foreground hover:text-primary hover:underline transition-colors"
                        >
                          {task.title}
                        </Link>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${getStatusStyle(task.status)}`}
                        >
                          {task.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 max-w-xl">
                        {task.description || 'No description provided.'}
                      </p>
                      {repo && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80 mt-2">
                          <FolderOpen className="h-3.5 w-3.5" />
                          <span>{repo.name}</span>
                          <span className="text-border">|</span>
                          <span className="font-mono">{repo.localPath}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center">
                      <Button variant="outline" asChild size="sm">
                        <Link to="/tasks/$id" params={{ id: task.id }}>
                          View Console
                        </Link>
                      </Button>

                      {task.status !== 'running' && task.status !== 'compiling_context' && (
                        <Button
                          onClick={() => startRunMutation.mutate(task.id)}
                          disabled={startRunMutation.isPending}
                          size="sm"
                          className="gap-1.5"
                        >
                          <Play className="h-3.5 w-3.5 fill-current" />
                          Run Agent
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
