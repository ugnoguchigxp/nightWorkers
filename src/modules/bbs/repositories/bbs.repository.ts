import type {
  Comment,
  CreateCommentInput,
  CreateThreadInput,
  ListThreadsResponse,
  Thread,
  ThreadResponse,
} from '../../../../shared/schemas/bbs.schema';
import { client } from '../../../lib/api';

export type {
  Comment,
  CreateCommentInput,
  CreateThreadInput,
  ListThreadsResponse,
  Thread,
  ThreadResponse,
};

// --- Repository (API Calls) ---
export const bbsRepository = {
  listThreads: async (): Promise<Thread[]> => {
    const res = await client.bbs.threads.$get({});
    if (!res.ok) throw new Error('Failed to fetch threads');
    const json = (await res.json()) as ListThreadsResponse;
    return json.threads;
  },

  getThread: async (id: string): Promise<Thread> => {
    const res = await client.bbs.threads[':id'].$get({
      param: { id },
    });
    if (!res.ok) throw new Error('Thread not found');
    const json = (await res.json()) as ThreadResponse;
    return json.thread;
  },

  createThread: async (data: CreateThreadInput): Promise<Thread> => {
    const res = await client.bbs.threads.$post({ json: data });
    if (!res.ok) throw new Error('Failed to create thread');
    return (await res.json()) as Thread;
  },

  createComment: async (threadId: string, data: CreateCommentInput): Promise<Comment> => {
    const res = await client.bbs.threads[':id'].comments.$post({
      param: { id: threadId },
      json: data,
    });
    if (!res.ok) throw new Error('Failed to post comment');
    return (await res.json()) as unknown as Comment;
  },
};
