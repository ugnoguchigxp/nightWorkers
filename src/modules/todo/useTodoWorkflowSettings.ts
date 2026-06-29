import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TodoWorkflowSettings } from '../nightworkers/types';
import { fetchTodoWorkflowSettings, updateTodoWorkflowSettings } from './todoCommands';

export function useTodoWorkflowSettings() {
  const queryClient = useQueryClient();
  const { data: todoWorkflowSettings = null } = useQuery({
    queryKey: ['todoWorkflowSettings'],
    queryFn: async () => {
      const res = await fetchTodoWorkflowSettings();
      if (!res.ok) throw new Error('Failed to fetch Todo Workflow settings');
      return (await res.json()) as TodoWorkflowSettings;
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const updateTodoWorkflowSettingsMutation = useMutation({
    mutationFn: async (input: Partial<TodoWorkflowSettings>) => {
      const res = await updateTodoWorkflowSettings(input);
      if (!res.ok) throw new Error(await res.text());
      return (await res.json()) as TodoWorkflowSettings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(['todoWorkflowSettings'], settings);
      queryClient.invalidateQueries({ queryKey: ['todoWorkflowSettings'] });
    },
  });

  return {
    todoWorkflowSettings,
    updateTodoWorkflowSettings: (input: Partial<TodoWorkflowSettings>) =>
      updateTodoWorkflowSettingsMutation.mutateAsync(input),
  };
}
