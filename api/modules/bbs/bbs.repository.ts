import { desc, eq } from 'drizzle-orm';
import type { CreateCommentInput, CreateThreadInput } from '../../../shared/schemas/bbs.schema';
import { db } from '../../db/client';
import { comments, threads } from '../../db/schema';

export const findAllThreads = async () => {
  return db
    .select({
      id: threads.id,
      title: threads.title,
      content: threads.content,
      authorId: threads.authorId,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
    })
    .from(threads)
    .orderBy(desc(threads.createdAt));
};

export const findThreadById = async (id: string) => {
  const [thread] = await db.select().from(threads).where(eq(threads.id, id));
  return thread || null;
};

export const findCommentsByThreadId = async (threadId: string) => {
  return db
    .select()
    .from(comments)
    .where(eq(comments.threadId, threadId))
    .orderBy(comments.createdAt);
};

export const findCommentById = async (id: string) => {
  const [comment] = await db.select().from(comments).where(eq(comments.id, id));
  return comment || null;
};

export const insertThread = async (data: CreateThreadInput, authorId: string) => {
  const results = await db
    .insert(threads)
    .values({
      title: data.title,
      content: data.content,
      authorId,
    })
    .returning();
  const [thread] = results as any[];
  return thread;
};

export const insertComment = async (
  threadId: string,
  data: CreateCommentInput,
  authorId: string
) => {
  const results = await db
    .insert(comments)
    .values({
      threadId,
      content: data.content,
      parentId: data.parentId || null,
      authorId,
    })
    .returning();
  const [comment] = results as any[];
  return comment;
};
