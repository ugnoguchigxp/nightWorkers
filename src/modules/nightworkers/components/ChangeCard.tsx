import { Button } from '@repo/design-system';
import { getChangedFiles, getDiffStats } from '../utils/diff';

type ChangeCardProps = {
  runId: string;
  diffPatch: string;
  status: string;
  onReview: (runId: string) => void;
};

export function ChangeCard({ runId, diffPatch, status, onReview }: ChangeCardProps) {
  const files = getChangedFiles(diffPatch);
  const stats = getDiffStats(diffPatch);
  const primary = files[0]?.path || '変更ファイル';
  const summary =
    files.length > 1
      ? `${primary} ほか ${files.length - 1} 件を編集しました`
      : `${primary} を編集しました`;
  const canReview = status === 'needs_review' || status === 'completed';

  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/70 p-4">
      <div className="text-sm text-zinc-100">{summary}</div>
      <div className="mt-1 text-xs text-zinc-400">
        <span className="text-emerald-400">+{stats.added}</span>{' '}
        <span className="text-rose-400">-{stats.deleted}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={!canReview}
          onClick={() => onReview(runId)}
        >
          レビューする
        </Button>
      </div>
    </div>
  );
}
