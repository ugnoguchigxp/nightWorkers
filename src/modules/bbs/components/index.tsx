import { Link } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import type {
  Comment,
  CreateCommentInput,
  CreateThreadInput,
  Thread,
} from '../repositories/bbs.repository';

// --- Thread List ---
const columnHelper = createColumnHelper<Thread>();

const columns = [
  columnHelper.accessor('title', {
    header: 'Title',
    cell: (info) => (
      <Link to="/bbs/$id" params={{ id: info.row.original.id }}>
        {info.getValue()}
      </Link>
    ),
  }),
  columnHelper.accessor('createdAt', {
    header: 'Created At',
    cell: (info) => new Date(info.getValue()).toLocaleString(),
  }),
];

export const ThreadList = ({ threads }: { threads: Thread[] | undefined }) => {
  const table = useReactTable({
    data: threads || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <table className="w-full border-collapse">
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id} className="border-b-2 border-border p-3 text-left">
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="border-b border-border p-3">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// --- Create Thread Form ---
export const CreateThreadForm = ({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: CreateThreadInput) => void;
  isPending: boolean;
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim() && content.trim()) {
      onSubmit({ title, content });
      setTitle('');
      setContent('');
    }
  };

  return (
    <section className="mb-12 rounded-xl border border-border bg-muted/30 p-6">
      <h3>Create New Thread</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Thread Title"
          required
          className="rounded border border-border bg-background px-3 py-3"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          required
          className="min-h-[100px] rounded border border-border bg-background px-3 py-3"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-border px-8 py-3 font-bold"
        >
          {isPending ? 'Creating...' : 'Create Thread'}
        </button>
      </form>
    </section>
  );
};

// --- Comment Form ---
export const CommentForm = ({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: CreateCommentInput) => void;
  isPending: boolean;
}) => {
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim()) {
      onSubmit({ content });
      setContent('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write a comment..."
        required
        className="min-h-20 rounded border border-border bg-background px-2 py-2"
      />
      <button
        type="submit"
        disabled={isPending}
        className="self-end rounded border border-border px-3 py-2"
      >
        {isPending ? 'Posting...' : 'Post Comment'}
      </button>
    </form>
  );
};

// --- Thread Detail View ---
export const ThreadDetailView = ({ thread }: { thread: Thread }) => {
  return (
    <article className="mb-8 border-b-2 border-border pb-4">
      <h1>{thread.title}</h1>
      <p className="whitespace-pre-wrap">{thread.content}</p>
      <small>
        Posted by: {thread.authorId} at {new Date(thread.createdAt).toLocaleString()}
      </small>
    </article>
  );
};

// --- Comment List ---
export const CommentList = ({ comments }: { comments: Comment[] | undefined }) => {
  return (
    <section>
      <h3>Comments ({comments?.length || 0})</h3>
      <div className="mb-8 flex flex-col gap-4">
        {comments?.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="mb-2">{comment.content}</p>
            <small>
              By: {comment.authorId} at {new Date(comment.createdAt).toLocaleString()}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
};
