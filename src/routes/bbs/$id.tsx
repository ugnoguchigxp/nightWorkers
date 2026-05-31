import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '../../lib/auth';
import { CommentForm, CommentList, ThreadDetailView } from '../../modules/bbs/components';
import { useThreadDetail } from '../../modules/bbs/hooks/bbs.hooks';

export const Route = createFileRoute('/bbs/$id')({
  component: BBSDetail,
});

function BBSDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { thread, isLoading, error, postComment, isPosting } = useThreadDetail(id);

  if (isLoading) return <p>Loading...</p>;
  if (error || !thread) return <p>Error: {(error as Error)?.message || 'Not found'}</p>;

  return (
    <div className="mx-auto max-w-4xl">
      <ThreadDetailView thread={thread} />

      <section>
        <CommentList comments={thread.comments} />

        {user ? (
          <CommentForm onSubmit={(data) => postComment(data)} isPending={isPosting} />
        ) : (
          <p>Please login to post a comment.</p>
        )}
      </section>
    </div>
  );
}
