import { AlertTriangle, Archive, CheckCircle2, Cpu, ListTodo, Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type {
  ImplementationQueueDashboard,
  ImplementationQueueHealth,
  ImplementationQueueHealthClassification,
  ImplementationQueueItem,
  Repository,
} from '../nightworkers/types';
import { getRelativeTimestamp } from '../nightworkers/utils/time';
import { TodoWorkflowPanel } from '../todo/TodoWorkflowPanel';

type ImplementationQueueScreenProps = {
  dashboard: ImplementationQueueDashboard | null;
  health: ImplementationQueueHealth | null;
  projects: Repository[];
  activeProjectFilterId: string | null;
  isLoading: boolean;
  onSetProjectFilter: (projectId: string | null) => void;
  onOpenSession: (sessionId: string) => void;
  onQueueSession: (sessionId: string) => Promise<void>;
  onArchiveEntry: (entryId: string) => Promise<void>;
  onRecoverEntry: (
    entryId: string,
    action: 'retry' | 'mark_needs_human' | 'cancel' | 'archive' | 'complete'
  ) => Promise<void>;
  onUpdateProcessorCount: (processorCount: number) => Promise<void>;
};

export function ImplementationQueueScreen(props: ImplementationQueueScreenProps) {
  const { t } = useTranslation();
  const dashboard = props.dashboard;
  const filteredQueued = filterItems(dashboard?.queued || [], props.activeProjectFilterId);
  const filteredCompleted = filterItems(dashboard?.completed || [], props.activeProjectFilterId);
  const allEntries = [
    ...(dashboard?.queued || []),
    ...(dashboard?.completed || []),
    ...(dashboard?.processors || []).flatMap((processor) =>
      processor.entry ? [processor.entry] : []
    ),
  ];
  const entryById = new Map(allEntries.map((entry) => [entry.id, entry]));
  const problemHealthItems = (props.health?.items || []).filter(
    (item) =>
      (!props.activeProjectFilterId ||
        entryById.get(item.entryId)?.repositoryId === props.activeProjectFilterId) &&
      (item.classification !== 'normal' ||
        ['retry', 'complete', 'mark_needs_human'].includes(item.recommendedAction))
  );
  const filteredNotQueued = (dashboard?.notQueued || []).filter(
    (item) => !props.activeProjectFilterId || item.repository.id === props.activeProjectFilterId
  );
  const processorCount = dashboard?.settings.processorCount ?? 1;

  return (
    <main className="flex h-full min-h-0 flex-col bg-[#111827] text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-slate-800 border-b px-5 py-3">
        <div>
          <h1 className="font-semibold text-base text-slate-100">{t('queue.title')}</h1>
          <div className="mt-1 text-slate-400 text-xs">{t('queue.description')}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
            value={props.activeProjectFilterId || ''}
            onChange={(event) => props.onSetProjectFilter(event.target.value || null)}
          >
            <option value="">{t('queue.allProjects')}</option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="flex h-8 items-center rounded-md border border-slate-700 bg-slate-950">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center text-slate-300 hover:text-slate-100"
              onClick={() => props.onUpdateProcessorCount(Math.max(1, processorCount - 1))}
              title={t('queue.decreaseProcessors')}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-20 text-center font-medium text-xs">
              {t('queue.processorCount', { count: processorCount })}
            </span>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center text-slate-300 hover:text-slate-100"
              onClick={() => props.onUpdateProcessorCount(Math.min(3, processorCount + 1))}
              title={t('queue.increaseProcessors')}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,0.9fr)_minmax(280px,1.15fr)_minmax(280px,1fr)] gap-0 overflow-hidden">
        <section className="min-h-0 border-slate-800 border-r">
          <SectionHeader icon={<Cpu className="h-4 w-4" />} label={t('queue.processors')} />
          <div className="nightworkers-scrollbar min-h-0 space-y-3 overflow-y-auto p-3">
            {props.isLoading ? (
              <EmptyState text={t('queue.loadingProcessors')} />
            ) : (
              (dashboard?.processors || []).map((processor) => (
                <ProcessorLane
                  key={processor.slot}
                  slot={processor.slot}
                  entry={processor.entry}
                  onOpenSession={props.onOpenSession}
                />
              ))
            )}
          </div>
        </section>
        <section className="min-h-0 border-slate-800 border-r">
          <SectionHeader icon={<ListTodo className="h-4 w-4" />} label={t('queue.queue')} />
          <div className="nightworkers-scrollbar min-h-0 space-y-2 overflow-y-auto p-3">
            <QueueHealthPanel
              health={props.health}
              items={problemHealthItems}
              entryById={entryById}
              onRecoverEntry={props.onRecoverEntry}
            />
            {filteredQueued.length === 0 ? (
              <EmptyState text={t('queue.emptyWaiting')} />
            ) : (
              filteredQueued.map((entry, index) => (
                <QueueItem
                  key={entry.id}
                  entry={entry}
                  index={index + 1}
                  onOpenSession={props.onOpenSession}
                />
              ))
            )}
          </div>
        </section>
        <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto_minmax(0,0.85fr)]">
          <div className="min-h-0">
            <SectionHeader icon={<Plus className="h-4 w-4" />} label={t('queue.notQueued')} />
            <div className="nightworkers-scrollbar min-h-0 space-y-2 overflow-y-auto p-3">
              {filteredNotQueued.length === 0 ? (
                <EmptyState text={t('queue.emptyNotQueued')} />
              ) : (
                filteredNotQueued.map((item) => (
                  <NotQueuedItem
                    key={item.task.id}
                    taskTitle={item.task.title}
                    projectName={item.repository.name}
                    updatedAt={item.task.updatedAt}
                    onOpenSession={() => props.onOpenSession(item.task.id)}
                    onQueue={() => props.onQueueSession(item.task.id)}
                  />
                ))
              )}
            </div>
          </div>
          <TodoWorkflowPanel />
          <div className="min-h-0 border-slate-800 border-t">
            <SectionHeader icon={<Archive className="h-4 w-4" />} label={t('queue.completed')} />
            <div className="nightworkers-scrollbar min-h-0 space-y-2 overflow-y-auto p-3">
              {filteredCompleted.length === 0 ? (
                <EmptyState text={t('queue.emptyCompleted')} />
              ) : (
                filteredCompleted.map((entry) => (
                  <CompletedItem
                    key={entry.id}
                    entry={entry}
                    onOpenSession={props.onOpenSession}
                    onArchiveEntry={props.onArchiveEntry}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function QueueHealthPanel({
  health,
  items,
  entryById,
  onRecoverEntry,
}: {
  health: ImplementationQueueHealth | null;
  items: NonNullable<ImplementationQueueHealth['items']>;
  entryById: Map<string, ImplementationQueueItem>;
  onRecoverEntry: ImplementationQueueScreenProps['onRecoverEntry'];
}) {
  const { t } = useTranslation();
  if (!health) return null;
  const visibleCounts = {
    stale: items.filter((item) => ['stale_claim', 'stale_processing'].includes(item.classification))
      .length,
    retryable: items.filter((item) => item.recommendedAction === 'retry').length,
    needsHuman: items.filter((item) => item.classification === 'needs_human').length,
    orphaned: items.filter((item) => item.classification === 'orphaned_active_run').length,
  };
  const hasProblems = items.length > 0;
  if (!hasProblems) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-emerald-900/60 bg-emerald-950/25 px-3 text-emerald-200 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>{t('queue.healthNormal')}</span>
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-900/60 bg-amber-950/25 p-3">
      <div className="flex flex-wrap items-center gap-2 text-amber-100 text-xs">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="font-semibold">{t('queue.healthIssues')}</span>
        <span className="text-amber-200/80">
          {t('queue.healthCounts', {
            stale: visibleCounts.stale,
            retryable: visibleCounts.retryable,
            needsHuman: visibleCounts.needsHuman,
            orphaned: visibleCounts.orphaned,
          })}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.slice(0, 5).map((item) => (
          <QueueHealthItem
            key={item.entryId}
            item={item}
            entry={entryById.get(item.entryId)}
            onRecoverEntry={onRecoverEntry}
          />
        ))}
      </div>
    </div>
  );
}

function QueueHealthItem({
  item,
  entry,
  onRecoverEntry,
}: {
  item: NonNullable<ImplementationQueueHealth['items']>[number];
  entry?: ImplementationQueueItem;
  onRecoverEntry: ImplementationQueueScreenProps['onRecoverEntry'];
}) {
  const { t } = useTranslation();
  const action = item.recommendedAction;
  const actionable = action !== 'none';
  const actionLabel = actionable ? t(`queue.recovery.${action}`) : '';
  const handleAction = async () => {
    if (!actionable) return;
    if (!window.confirm(t('queue.recoveryConfirm', { action: actionLabel }))) return;
    await onRecoverEntry(item.entryId, action);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-amber-900/45 bg-slate-950/45 p-2">
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-100 text-xs">
          {entry?.task.title || item.taskId.slice(0, 8)}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-amber-200/80">
          <span>{classificationLabel(item.classification, t)}</span>
          <span>{item.status}</span>
          {item.lastHeartbeatAt ? <span>{getRelativeTimestamp(item.lastHeartbeatAt)}</span> : null}
        </div>
      </div>
      {actionable ? (
        <Button type="button" size="sm" className="h-7 text-xs" onClick={() => void handleAction()}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function classificationLabel(
  classification: ImplementationQueueHealthClassification,
  t: ReturnType<typeof useTranslation>['t']
) {
  return t(`queue.classification.${classification}`);
}

function SectionHeader({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-10 items-center gap-2 border-slate-800 border-b px-3 font-semibold text-slate-200 text-xs uppercase">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function ProcessorLane({
  slot,
  entry,
  onOpenSession,
}: {
  slot: number;
  entry: ImplementationQueueItem | null;
  onOpenSession: (sessionId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/55 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-cyan-200">{t('queue.processor', { slot })}</span>
        <span className="text-slate-500">{entry ? entry.status : t('queue.idle')}</span>
      </div>
      {entry ? (
        <button
          type="button"
          className="w-full text-left"
          onClick={() => onOpenSession(entry.task.id)}
        >
          <div className="truncate font-medium text-sm text-slate-100">{entry.task.title}</div>
          <div className="mt-1 truncate text-slate-400 text-xs">{entry.repository.name}</div>
          <div className="mt-2 text-slate-500 text-xs">
            {entry.activeRunId
              ? t('queue.runShort', { id: entry.activeRunId.slice(0, 8) })
              : t('queue.claiming')}
          </div>
        </button>
      ) : (
        <EmptyState text={t('queue.waitingNextTask')} compact />
      )}
    </div>
  );
}

function QueueItem({
  entry,
  index,
  onOpenSession,
}: {
  entry: ImplementationQueueItem;
  index: number;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      className="w-full rounded-md border border-slate-700 bg-slate-950/45 p-3 text-left hover:border-cyan-500/50"
      onClick={() => onOpenSession(entry.task.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-cyan-200 text-xs">#{index}</span>
        <span className="text-slate-500 text-xs">{entry.repository.name}</span>
      </div>
      <div className="mt-1 truncate font-medium text-sm text-slate-100">{entry.task.title}</div>
      <div className="mt-1 text-slate-500 text-xs">{getRelativeTimestamp(entry.createdAt)}</div>
    </button>
  );
}

function NotQueuedItem({
  taskTitle,
  projectName,
  updatedAt,
  onOpenSession,
  onQueue,
}: {
  taskTitle: string;
  projectName: string;
  updatedAt: unknown;
  onOpenSession: () => void;
  onQueue: () => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/45 p-3">
      <button type="button" className="w-full text-left" onClick={onOpenSession}>
        <div className="truncate font-medium text-sm text-slate-100">{taskTitle}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-slate-500 text-xs">
          <span className="truncate">{projectName}</span>
          <span>{getRelativeTimestamp(updatedAt)}</span>
        </div>
      </button>
      <Button type="button" size="sm" className="mt-2 h-7 text-xs" onClick={() => void onQueue()}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t('queue.enqueue')}
      </Button>
    </div>
  );
}

function CompletedItem({
  entry,
  onOpenSession,
  onArchiveEntry,
}: {
  entry: ImplementationQueueItem;
  onOpenSession: (sessionId: string) => void;
  onArchiveEntry: (entryId: string) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-md border border-slate-700 bg-slate-950/45 p-3">
      <button
        type="button"
        className="w-full text-left"
        onClick={() => onOpenSession(entry.task.id)}
      >
        <div className="truncate font-medium text-sm text-slate-100">{entry.task.title}</div>
        <div className="mt-1 text-slate-500 text-xs">{entry.status}</div>
      </button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2 h-7 text-xs"
        onClick={() => void onArchiveEntry(entry.id)}
      >
        <Archive className="mr-1 h-3.5 w-3.5" />
        {t('queue.archive')}
      </Button>
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`${compact ? 'py-2' : 'py-6'} text-center text-slate-500 text-xs`}>{text}</div>
  );
}

function filterItems(items: ImplementationQueueItem[], projectId: string | null) {
  if (!projectId) return items;
  return items.filter((item) => item.repositoryId === projectId);
}
