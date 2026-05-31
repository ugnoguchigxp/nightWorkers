import { HttpResponse, http } from 'msw';
import type { Comment, Thread } from '../../shared/schemas/bbs.schema';

const mockThreads: Thread[] = [
  {
    id: 'thread-1',
    title: 'Welcome to Hono Standard',
    content: 'This is a mock thread from MSW.',
    authorId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
  },
];

const mockComments: Comment[] = [
  {
    id: 'comment-1',
    threadId: 'thread-1',
    parentId: null,
    content: 'First mock comment!',
    authorId: 'user-2',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const bbsHandlers = [
  http.get('/api/bbs/threads', () => {
    return HttpResponse.json({ threads: mockThreads });
  }),

  http.get('/api/bbs/threads/:id', ({ params }) => {
    const { id } = params;
    const thread = mockThreads.find((t) => t.id === id);
    if (!thread) return new HttpResponse(null, { status: 404 });

    return HttpResponse.json({
      thread: {
        ...thread,
        comments: mockComments.filter((c) => c.threadId === id),
      },
    });
  }),

  http.post('/api/bbs/threads', async ({ request }) => {
    const data = (await request.json()) as { title: string; content: string };
    const newThread: Thread = {
      id: `thread-${mockThreads.length + 1}`,
      title: data.title,
      content: data.content,
      authorId: 'user-logged-in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
    };
    mockThreads.push(newThread);
    return HttpResponse.json(newThread, { status: 201 });
  }),

  http.post('/api/bbs/threads/:id/comments', async ({ params, request }) => {
    const { id } = params;
    const data = (await request.json()) as { content: string };
    const newComment: Comment = {
      id: `comment-${mockComments.length + 1}`,
      threadId: id as string,
      parentId: null,
      content: data.content,
      authorId: 'user-logged-in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockComments.push(newComment);
    return HttpResponse.json(newComment, { status: 201 });
  }),
];
