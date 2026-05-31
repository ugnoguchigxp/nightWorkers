import type { CreateCommentInput, CreateThreadInput } from '../../../shared/schemas/bbs.schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import * as BBSository from './bbs.repository';

export const listThreads = async () => {
  return BBSository.findAllThreads();
};

export const getThread = async (id: string) => {
  const thread = await BBSository.findThreadById(id);
  if (!thread) throw new NotFoundError('Thread not found');

  const threadComments = await BBSository.findCommentsByThreadId(id);

  return {
    ...thread,
    comments: threadComments,
  };
};

export const createThread = async (data: CreateThreadInput, authorId: string) => {
  return BBSository.insertThread(data, authorId);
};

export const createComment = async (
  threadId: string,
  data: CreateCommentInput,
  authorId: string
) => {
  const thread = await BBSository.findThreadById(threadId);
  if (!thread) throw new NotFoundError('Thread not found');

  if (data.parentId) {
    const parentComment = await BBSository.findCommentById(data.parentId);
    if (!parentComment) throw new NotFoundError('Parent comment not found');
    if (parentComment.threadId !== threadId) {
      throw new ValidationError('Parent comment must belong to the same thread');
    }
  }

  return BBSository.insertComment(threadId, data, authorId);
};
