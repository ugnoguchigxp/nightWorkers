import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '../../lib/auth';
import { CreateThreadForm, ThreadList } from '../../modules/bbs/components';
import { useThreads } from '../../modules/bbs/hooks/bbs.hooks';

export const Route = createFileRoute('/bbs/')({
  component: BBSList,
});

function BBSList() {
  const { user } = useAuth();
  const { threads, isLoading, createThread, isCreating } = useThreads();

  if (isLoading) return <p>Loading...</p>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1>BBS</h1>
      </div>

      {user ? (
        <CreateThreadForm onSubmit={createThread} isPending={isCreating} />
      ) : (
        <p className="mb-8">Please login to create a new thread.</p>
      )}

      <ThreadList threads={threads} />
    </div>
  );
}
