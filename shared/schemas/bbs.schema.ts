import { z } from '@hono/zod-openapi';
import sanitizeHtml from 'sanitize-html';

const sanitize = (val: string) => sanitizeHtml(val);

// --- Shared Response Schemas ---

export const commentSchema = z
  .object({
    id: z.string().openapi({ example: 'comment-uuid' }),
    threadId: z.string().openapi({ example: 'thread-uuid' }),
    parentId: z.string().nullable().openapi({ example: null }),
    content: z.string().openapi({ example: 'My comment' }),
    authorId: z.string().openapi({ example: 'user-uuid' }),
    createdAt: z.string().openapi({ example: '2026-04-02T11:47:06.000Z' }),
    updatedAt: z.string().openapi({ example: '2026-04-02T11:47:06.000Z' }),
  })
  .openapi('Comment');

export const threadSchema = z
  .object({
    id: z.string().openapi({ example: 'thread-uuid' }),
    title: z.string().openapi({ example: 'My Thread' }),
    content: z.string().openapi({ example: 'Thread content' }),
    authorId: z.string().openapi({ example: 'user-uuid' }),
    createdAt: z.string().openapi({ example: '2026-04-02T11:47:06.000Z' }),
    updatedAt: z.string().openapi({ example: '2026-04-02T11:47:06.000Z' }),
    comments: z.array(commentSchema).optional(),
  })
  .openapi('Thread');

// --- Shared Input Schemas ---

export const createThreadSchema = z
  .object({
    title: z.string().min(1).transform(sanitize).openapi({ example: 'My First Thread' }),
    content: z
      .string()
      .min(1)
      .transform(sanitize)
      .openapi({ example: 'Hello, this is the content of my first thread.' }),
  })
  .openapi('CreateThreadInput');

export const createCommentSchema = z
  .object({
    content: z.string().min(1).transform(sanitize).openapi({ example: 'Great thread!' }),
    parentId: z.string().uuid().optional().openapi({ example: 'uuid-of-parent-comment' }),
  })
  .openapi('CreateCommentInput');

// --- Shared Wrapper Schemas (Responses) ---

export const listThreadsResponseSchema = z.object({
  threads: z.array(threadSchema),
});

export const threadResponseSchema = z.object({
  thread: threadSchema,
});

export type Comment = z.infer<typeof commentSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type CreateThreadInput = z.infer<typeof createThreadSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type ListThreadsResponse = z.infer<typeof listThreadsResponseSchema>;
export type ThreadResponse = z.infer<typeof threadResponseSchema>;
