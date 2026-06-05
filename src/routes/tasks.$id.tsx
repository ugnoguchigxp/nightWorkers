import { Button } from '@repo/design-system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  Check,
  GitPullRequest,
  MessageSquare,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import { useState } from 'react';
import { client } from '../lib/api';
import { apiPath } from '../lib/api-base';

export const Route = createFileRoute('/tasks/$id')({
  component: TaskConsolePage,
});

function TaskConsolePage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'log' | 'diff'>('log');

  // Fetch Task Details
  const { data: task, isLoading: isTaskLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: async () => {
      const res = await client.tasks[':id'].$get({ param: { id } });
      if (!res.ok) throw new Error('Failed to fetch task');
      return res.json();
    },
    refetchInterval: 3000, // keep updated
  });

  // Fetch Repository
  const { data: repo } = useQuery({
    queryKey: ['repository', task?.repositoryId],
    queryFn: async () => {
      if (!task?.repositoryId) return null;
      const res = await client.repositories[':id'].$get({ param: { id: task.repositoryId } });
      if (!res.ok) throw new Error('Failed to fetch repository');
      return res.json();
    },
    enabled: !!task?.repositoryId,
  });

  // Fetch Task Runs
  const { data: runs = [] } = useQuery({
    queryKey: ['taskRuns', id],
    queryFn: async () => {
      const res = await client.tasks[':id'].runs.$get({ param: { id } });
      if (!res.ok) throw new Error('Failed to fetch task runs');
      return res.json();
    },
    refetchInterval: 3000,
  });

  // Get active run details
  const activeRun = runs[0]; // assuming latest run

  // Fetch Active Run Events & Logs
  const { data: runDetails } = useQuery({
    queryKey: ['runDetails', activeRun?.id],
    queryFn: async () => {
      if (!activeRun?.id) return null;
      const res = await client.runs[':id'].$get({ param: { id: activeRun.id } });
      if (!res.ok) throw new Error('Failed to fetch run details');
      return res.json();
    },
    enabled: !!activeRun?.id,
    refetchInterval: 1500, // highly interactive logging
  });

  // Start Run Mutation
  const startRunMutation = useMutation({
    mutationFn: async () => {
      const res = await client.tasks[':id'].run.$post({ param: { id } });
      if (!res.ok) throw new Error('Failed to start run');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['taskRuns', id] });
    },
  });

  const reviewRunMutation = useMutation({
    mutationFn: async (data: { action: 'complete' | 'cancel'; note?: string }) => {
      const res = await fetch(apiPath(`/api/runs/${activeRun?.id}/review`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to submit review');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] });
      queryClient.invalidateQueries({ queryKey: ['taskRuns', id] });
    },
  });

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'completed':
        return 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/20';
      case 'failed':
        return 'text-rose-400 bg-rose-400/10 border border-rose-400/20';
      case 'running':
      case 'compiling_context':
      case 'context_compiling':
      case 'finalizing':
        return 'text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 animate-pulse';
      case 'needs_review':
        return 'text-amber-400 bg-amber-400/10 border border-amber-400/20';
      default:
        return 'text-muted-foreground bg-muted/20 border border-border';
    }
  };
  const getStatusLabel = (status?: string) =>
    status === 'context_compiling' || status === 'compiling_context' ? 'prompt_preparing' : status;

  if (isTaskLoading || !task) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${getStatusColor(task.status)}`}
            >
              {getStatusLabel(task.status)}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              ID: {task.id.slice(0, 8)}
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{task.title}</h1>
          {repo && (
            <p className="text-sm text-muted-foreground mt-1">
              Repository:{' '}
              <span className="font-mono">
                {repo.name} ({repo.localPath})
              </span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!['running', 'context_compiling', 'compiling_context', 'finalizing'].includes(
            task.status
          ) && (
            <Button
              onClick={() => startRunMutation.mutate()}
              disabled={startRunMutation.isPending}
              className="gap-1.5"
            >
              <Play className="h-4 w-4 fill-current" />
              Re-run Agent
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Context & Task details */}
        <div className="space-y-6 lg:col-span-1">
          {/* Instructions Box */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h2 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
              <GitPullRequest className="h-5 w-5 text-primary" />
              Goal & Instructions
            </h2>
            <div className="text-sm text-muted-foreground bg-background/50 rounded-lg p-3 border border-border/60 min-h-[100px] whitespace-pre-wrap">
              {task.description || 'No instruction description provided.'}
            </div>
          </div>

          {/* Runtime Prompt Snapshot Box */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h2 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-cyan-400" />
              Runtime Prompt
            </h2>
            <p className="text-xs text-muted-foreground mb-2">
              Prompt snapshot used for execution:
            </p>
            <div className="text-xs text-muted-foreground bg-background/50 rounded-lg p-3 border border-border/60 font-mono min-h-[100px] max-h-[250px] overflow-y-auto whitespace-pre-wrap">
              {task.compiledPrompt || '(No runtime prompt snapshot yet. Run the agent first.)'}
            </div>
          </div>

          {/* Safety & Policy Box */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h2 className="text-lg font-bold mb-3 text-foreground flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-400" />
              Execution Boundaries
            </h2>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex justify-between border-b border-border/50 pb-1">
                <span>Timeout</span>
                <span className="font-mono">{task.timeoutSeconds}s</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-1">
                <span>Safe Mode</span>
                <span className="text-emerald-400">Command blocklists active</span>
              </div>
              <div className="flex justify-between">
                <span>Memory Loop</span>
                <span className="text-cyan-400">Post-evaluation active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Console Terminal / Diff */}
        <div className="lg:col-span-2 flex flex-col min-h-[500px]">
          {/* Tabs */}
          <div className="flex items-center justify-between border-b border-border mb-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('log')}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'log'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Agent Terminal Console
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('diff')}
                className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === 'diff'
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                Review Diffs
              </button>
            </div>
            {runDetails?.endedAt && (
              <span className="text-xs text-muted-foreground">
                Ended: {new Date(runDetails.endedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Console View */}
          {activeTab === 'log' && (
            <div className="flex-1 bg-black border border-zinc-800 rounded-xl p-5 shadow-2xl font-mono text-xs text-zinc-300 overflow-y-auto max-h-[500px] flex flex-col justify-between">
              <div className="space-y-4">
                <div className="text-zinc-500 flex justify-between border-b border-zinc-900 pb-2 mb-2">
                  <span>SYSTEM: Native Local Worker Active</span>
                  <span className="animate-pulse text-cyan-400">● LIVE MONITORING</span>
                </div>

                {runDetails?.events && runDetails.events.length > 0 ? (
                  runDetails.events.map((evt: any) => {
                    const runEventType = evt.payloadJson?.runEvent?.type;
                    const isResponseDelta = runEventType === 'model.response_delta';
                    const isSupervisor =
                      evt.actor === 'supervisor' || evt.eventType === 'supervisor_decision';
                    const isToolCall = evt.eventType === 'tool_call';
                    const isToolResult = evt.eventType === 'tool_result';
                    const isFinalReport = evt.eventType === 'final_report';
                    const isError = evt.type === 'error' || evt.eventType === 'error';

                    if (isResponseDelta) {
                      const text = String(
                        evt.payloadJson?.runEvent?.data?.text || evt.message || ''
                      );
                      return (
                        <div
                          key={evt.id}
                          className="border-l-2 border-cyan-500 pl-4 py-2 bg-cyan-950/10 rounded-r-lg space-y-1"
                        >
                          <div className="flex items-center gap-2 text-cyan-300 font-semibold">
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            <span>OpenAI stream</span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              [{new Date(evt.timestamp).toLocaleTimeString()}]
                            </span>
                          </div>
                          <p className="text-zinc-200 whitespace-pre-wrap font-sans">{text}</p>
                        </div>
                      );
                    }

                    if (isSupervisor) {
                      const payload = evt.payloadJson;
                      return (
                        <div
                          key={evt.id}
                          className="border-l-2 border-amber-500 pl-4 py-2 bg-amber-950/10 rounded-r-lg space-y-1"
                        >
                          <div className="flex items-center gap-2 text-amber-400 font-bold">
                            <Shield className="h-4 w-4" />
                            <span>Supervisor: Phase {payload?.phase || 'Plan'}</span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              [{new Date(evt.timestamp).toLocaleTimeString()}]
                            </span>
                          </div>
                          <p className="text-zinc-200 font-medium">
                            {evt.message.replace(/\[Supervisor Decision\]\s*/, '')}
                          </p>
                          {payload?.rationale && (
                            <p className="text-[11px] text-amber-300/80 italic font-sans">
                              Rationale: {payload.rationale}
                            </p>
                          )}
                          {payload?.expectedEvidence && payload.expectedEvidence.length > 0 && (
                            <div className="text-[10px] text-zinc-400 font-sans">
                              Expected Evidence:{' '}
                              {payload.expectedEvidence.map((e: string) => `"${e}"`).join(', ')}
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (isToolCall) {
                      const payload = evt.payloadJson;
                      return (
                        <div
                          key={evt.id}
                          className="border-l-2 border-blue-500 pl-4 py-2 bg-blue-950/10 rounded-r-lg space-y-1"
                        >
                          <div className="flex items-center gap-2 text-blue-400 font-semibold">
                            <Terminal className="h-3.5 w-3.5" />
                            <span>Worker: Running tool "{payload?.toolName}"</span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              [{new Date(evt.timestamp).toLocaleTimeString()}]
                            </span>
                          </div>
                          {payload?.arguments && (
                            <pre className="text-[10px] text-zinc-400 bg-zinc-950 p-2 rounded border border-zinc-900 overflow-x-auto max-w-full">
                              {JSON.stringify(payload.arguments, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    }

                    if (isToolResult) {
                      const payload = evt.payloadJson;
                      const isSuccess = payload?.ok;
                      return (
                        <div
                          key={evt.id}
                          className={`border-l-2 ${
                            isSuccess
                              ? 'border-emerald-500 bg-emerald-950/5'
                              : 'border-rose-500 bg-rose-950/5'
                          } pl-4 py-2 rounded-r-lg space-y-1`}
                        >
                          <div
                            className={`flex items-center gap-2 ${
                              isSuccess ? 'text-emerald-400' : 'text-rose-400'
                            } font-semibold`}
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>
                              Worker: Tool "{payload?.toolName}" {isSuccess ? 'success' : 'failed'}
                            </span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              [{new Date(evt.timestamp).toLocaleTimeString()}]
                            </span>
                          </div>
                          {payload?.payload?.content && (
                            <pre className="text-[10px] text-zinc-300 bg-zinc-950/80 p-2 rounded border border-zinc-900/50 overflow-y-auto max-h-[120px] whitespace-pre-wrap">
                              {payload.payload.content}
                            </pre>
                          )}
                          {payload?.payload?.stdout && (
                            <pre className="text-[10px] text-zinc-300 bg-zinc-950/80 p-2 rounded border border-zinc-900/50 overflow-y-auto max-h-[120px] whitespace-pre-wrap font-mono">
                              {payload.payload.stdout}
                            </pre>
                          )}
                          {payload?.payload?.stderr && (
                            <pre className="text-[10px] text-rose-300 bg-zinc-950/80 p-2 rounded border border-zinc-900/50 overflow-y-auto max-h-[120px] whitespace-pre-wrap font-mono">
                              {payload.payload.stderr}
                            </pre>
                          )}
                          {payload?.error && (
                            <p className="text-[11px] text-rose-300 font-sans">
                              Error: {payload.error.message}
                            </p>
                          )}
                        </div>
                      );
                    }

                    if (isFinalReport) {
                      const payload = evt.payloadJson;
                      return (
                        <div
                          key={evt.id}
                          className="border-l-2 border-purple-500 pl-4 py-3 bg-purple-950/10 rounded-r-lg space-y-2"
                        >
                          <div className="flex items-center gap-2 text-purple-400 font-bold">
                            <Check className="h-4 w-4" />
                            <span>Execution Final Report</span>
                            <span className="text-[10px] text-zinc-500 font-mono">
                              [{new Date(evt.timestamp).toLocaleTimeString()}]
                            </span>
                          </div>
                          <p className="text-zinc-200 text-sm whitespace-pre-wrap font-sans">
                            {payload?.finalReport || evt.message}
                          </p>
                          {payload?.diffStat && (
                            <div>
                              <span className="text-xs text-purple-300 font-bold">
                                Change stats:
                              </span>
                              <pre className="text-[10px] text-zinc-300 bg-zinc-950 p-2 rounded border border-zinc-900 overflow-x-auto max-w-full font-mono mt-1">
                                {payload.diffStat}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div key={evt.id} className="flex gap-2.5 py-1 text-zinc-400">
                        <span className="text-zinc-600">
                          [{new Date(evt.timestamp).toLocaleTimeString()}]
                        </span>
                        <span className={isError ? 'text-rose-400 font-semibold' : 'text-zinc-400'}>
                          {evt.message}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-zinc-600 italic py-8 text-center">
                    No run logs generated yet. Click "Run Agent" to begin execution.
                  </div>
                )}

                {['running', 'context_compiling', 'compiling_context', 'finalizing'].includes(
                  activeRun?.status || ''
                ) && (
                  <div className="flex items-center gap-2 text-cyan-400 animate-pulse mt-4">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>
                      {activeRun?.status === 'finalizing'
                        ? 'Final judgment is being prepared...'
                        : 'Agent is working inside the workspace sandbox...'}
                    </span>
                  </div>
                )}
              </div>

              {runDetails?.logContent && (
                <details className="mt-8 border-t border-zinc-900 pt-4">
                  <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                    View raw standard outputs
                  </summary>
                  <pre className="mt-2 text-[10px] text-zinc-400 whitespace-pre-wrap max-h-[200px] overflow-y-auto bg-zinc-950 p-2 rounded">
                    {runDetails.logContent}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* Diff View */}
          {activeTab === 'diff' && (
            <div className="flex-1 bg-zinc-950 border border-zinc-900 rounded-xl p-5 shadow-2xl font-mono text-xs overflow-y-auto max-h-[500px]">
              {runDetails?.diffPatch ? (
                <div>
                  <div className="text-zinc-500 border-b border-zinc-900 pb-2 mb-4 flex items-center justify-between">
                    <span>Generated Git Patch</span>
                    <span className="text-emerald-400 font-bold">READY TO REVIEW</span>
                  </div>
                  <pre className="text-zinc-300 whitespace-pre bg-zinc-900/50 p-3 rounded-lg border border-zinc-900 max-h-[300px] overflow-x-auto">
                    {runDetails.diffPatch}
                  </pre>

                  {/* Manual Approval Action */}
                  <div className="mt-6 flex gap-3">
                    <Button
                      onClick={() =>
                        reviewRunMutation.mutate({
                          action: 'complete',
                          note: 'Approved and finalized',
                        })
                      }
                      disabled={reviewRunMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-1.5 flex-1"
                    >
                      <Check className="h-4 w-4" />
                      {reviewRunMutation.isPending ? 'Completing...' : 'Approve & Merge Diff'}
                    </Button>
                    <Button
                      onClick={() =>
                        reviewRunMutation.mutate({ action: 'cancel', note: 'Discarded by user' })
                      }
                      disabled={reviewRunMutation.isPending}
                      variant="outline"
                      className="border-zinc-800 hover:bg-zinc-900 hover:text-white flex-1"
                    >
                      {reviewRunMutation.isPending ? 'Discarding...' : 'Discard Diff'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-zinc-500 italic py-12 text-center">
                  No diff was generated. This run might be pending, running, or failed.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
