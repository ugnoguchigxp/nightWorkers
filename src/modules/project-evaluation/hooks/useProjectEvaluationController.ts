import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createProjectEvaluationTasks,
  fetchProjectEvaluationDetail,
  fetchProjectEvaluationHistory,
  generateProjectImprovements,
  runProjectEvaluation,
} from '../api/projectEvaluationCommands';
import type {
  ProjectEvaluationDetail,
  ProjectEvaluationDimensionKey,
  ProjectEvaluationRun,
  ProjectEvaluationTaskLink,
} from '../model/projectEvaluationTypes';

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.error || body.message || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function useProjectEvaluationController(repositoryId: string) {
  const [history, setHistory] = useState<ProjectEvaluationRun[]>([]);
  const [detail, setDetail] = useState<ProjectEvaluationDetail | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<ProjectEvaluationDimensionKey>>(
    () => new Set()
  );
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreatingTasks, setIsCreatingTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDetail = useCallback(async (evaluationId: string) => {
    const nextDetail = await parseJsonResponse<ProjectEvaluationDetail>(
      await fetchProjectEvaluationDetail(evaluationId)
    );
    setDetail(nextDetail);
    setSelectedKeys(new Set(nextDetail.evaluation.dimensions.slice(0, 3).map((item) => item.key)));
    setSelectedIdeaIds(new Set());
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const evaluations = await parseJsonResponse<ProjectEvaluationRun[]>(
        await fetchProjectEvaluationHistory(repositoryId)
      );
      setHistory(evaluations);
      if (evaluations[0]) await loadDetail(evaluations[0].id);
      else setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [loadDetail, repositoryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runEvaluation = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const nextDetail = await parseJsonResponse<ProjectEvaluationDetail>(
        await runProjectEvaluation(repositoryId)
      );
      setDetail(nextDetail);
      const evaluations = await parseJsonResponse<ProjectEvaluationRun[]>(
        await fetchProjectEvaluationHistory(repositoryId)
      );
      setHistory(evaluations);
      setSelectedKeys(
        new Set(nextDetail.evaluation.dimensions.slice(0, 3).map((item) => item.key))
      );
      setSelectedIdeaIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [repositoryId]);

  const selectEvaluation = useCallback(
    async (evaluationId: string) => {
      setError(null);
      try {
        await loadDetail(evaluationId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadDetail]
  );

  const generateIdeas = useCallback(async () => {
    if (!detail || selectedKeys.size === 0) return;
    setIsGenerating(true);
    setError(null);
    try {
      const result = await parseJsonResponse<{ ideas: ProjectEvaluationDetail['improvements'] }>(
        await generateProjectImprovements(detail.evaluation.id, {
          dimensionKeys: [...selectedKeys],
        })
      );
      setDetail({ ...detail, improvements: result.ideas });
      setSelectedIdeaIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  }, [detail, selectedKeys]);

  const createTasks = useCallback(async () => {
    if (!detail || selectedIdeaIds.size === 0) return;
    setIsCreatingTasks(true);
    setError(null);
    try {
      const result = await parseJsonResponse<{ taskLinks: ProjectEvaluationTaskLink[] }>(
        await createProjectEvaluationTasks(detail.evaluation.id, {
          ideaIds: [...selectedIdeaIds],
          mode: 'ready',
        })
      );
      setDetail({ ...detail, taskLinks: result.taskLinks });
      setSelectedIdeaIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingTasks(false);
    }
  }, [detail, selectedIdeaIds]);

  const previousEvaluation = useMemo(() => {
    if (!detail) return null;
    const index = history.findIndex((item) => item.id === detail.evaluation.id);
    return index >= 0 ? (history[index + 1] ?? null) : null;
  }, [detail, history]);

  return {
    history,
    detail,
    previousEvaluation,
    selectedKeys,
    selectedIdeaIds,
    isLoading,
    isRunning,
    isGenerating,
    isCreatingTasks,
    error,
    setSelectedKeys,
    runEvaluation,
    selectEvaluation,
    generateIdeas,
    createTasks,
    toggleIdea(id: string) {
      setSelectedIdeaIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
  };
}
