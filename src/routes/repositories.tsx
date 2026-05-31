import { Button } from '@repo/design-system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FolderGit2, GitBranch, Plus, Shield, Terminal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { client } from '../lib/api';

export const Route = createFileRoute('/repositories')({
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [branch, setBranch] = useState('main');

  // Fetch Repositories
  const { data: repos = [], isLoading } = useQuery({
    queryKey: ['repositories'],
    queryFn: async () => {
      const res = await client.repositories.$get();
      if (!res.ok) throw new Error('Failed to fetch repositories');
      return res.json();
    },
  });

  // Create Repository Mutation
  const createRepoMutation = useMutation({
    mutationFn: async (data: { name: string; localPath: string; branch: string }) => {
      const res = await client.repositories.$post({ json: data });
      if (!res.ok) throw new Error('Failed to create repository');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
      setName('');
      setLocalPath('');
      setBranch('main');
    },
  });

  // Delete Repository Mutation
  const deleteRepoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await client.repositories[':id'].$delete({ param: { id } });
      if (!res.ok) throw new Error('Failed to delete repository');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !localPath) return;
    createRepoMutation.mutate({ name, localPath, branch });
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent">
          Repositories
        </h1>
        <p className="text-muted-foreground">
          Register local workspaces for coding agents to work inside
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Registration Panel */}
        <div className="lg:col-span-1 bg-card border border-border rounded-xl p-6 shadow-lg shadow-black/20">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-foreground">
            <Plus className="h-5 w-5 text-primary" />
            Register Repository
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1">
                Friendly Name
              </span>
              <input
                type="text"
                placeholder="e.g. My Awesome App"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1">
                Absolute Local Path
              </span>
              <input
                type="text"
                placeholder="e.g. /Users/name/Projects/app"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-muted-foreground mb-1">
                Target Git Branch
              </span>
              <input
                type="text"
                placeholder="e.g. main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                required
              />
            </div>

            <Button type="submit" disabled={createRepoMutation.isPending} className="w-full">
              {createRepoMutation.isPending ? 'Registering...' : 'Register Workspace'}
            </Button>
          </form>
        </div>

        {/* Repositories List Panel */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
            <FolderGit2 className="h-5 w-5 text-cyan-400" />
            Registered Workspaces
          </h2>

          {isLoading ? (
            <div className="text-center py-12 border border-border border-dashed rounded-xl bg-card/25">
              <p className="text-muted-foreground">Loading workspaces...</p>
            </div>
          ) : repos.length === 0 ? (
            <div className="text-center py-12 border border-border border-dashed rounded-xl bg-card/25">
              <FolderGit2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No repositories registered yet.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  className="bg-card border border-border rounded-xl p-5 shadow-sm transition-all flex items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <h3 className="font-bold text-lg text-foreground">{repo.name}</h3>
                    <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <span className="font-mono">{repo.localPath}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <span>{repo.branch}</span>
                        <span className="text-border">|</span>
                        <Shield className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <span>Sandbox execution active</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this repository?')) {
                        deleteRepoMutation.mutate(repo.id);
                      }
                    }}
                    disabled={deleteRepoMutation.isPending}
                    variant="ghost"
                    size="sm"
                    className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
