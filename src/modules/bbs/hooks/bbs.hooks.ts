import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCommentInput, CreateThreadInput } from '../repositories/bbs.repository';
import { bbsRepository } from '../repositories/bbs.repository';

export const useThreads = () => {
  const queryClient = useQueryClient();

  const threadsQuery = useQuery({
    queryKey: ['threads'],
    queryFn: bbsRepository.listThreads,
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateThreadInput) => bbsRepository.createThread(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  return {
    threads: threadsQuery.data,
    isLoading: threadsQuery.isLoading,
    isError: threadsQuery.isError,
    createThread: createMutation.mutate,
    isCreating: createMutation.isPending,
  };
};

export const useThreadDetail = (id: string) => {
  const queryClient = useQueryClient();

  const threadQuery = useQuery({
    queryKey: ['thread', id],
    queryFn: () => bbsRepository.getThread(id),
  });

  const commentMutation = useMutation({
    mutationFn: (data: CreateCommentInput) => bbsRepository.createComment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['thread', id] });
    },
  });

  return {
    thread: threadQuery.data,
    isLoading: threadQuery.isLoading,
    error: threadQuery.error,
    postComment: commentMutation.mutate,
    isPosting: commentMutation.isPending,
  };
};
