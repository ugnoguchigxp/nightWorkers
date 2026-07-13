import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	CreateWorktreeRequest,
	WorktreeListResponse,
} from "../../../../shared/schemas/gitworktree.schema";
import {
	fetchRepositoryWorktrees,
	readGitworktreeResponse,
} from "../api/gitworktreeCommands";
import {
	defaultCreateDraft,
	type WorktreeDiff,
} from "../model/gitworktreeViewModel";

export function useGitworktreeController(repositoryId: string) {
	const [snapshot, setSnapshot] = useState<{
		repositoryId: string;
		data: WorktreeListResponse;
	} | null>(null);
	const requestGeneration = useRef(0);
	const data = snapshot?.repositoryId === repositoryId ? snapshot.data : null;
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [createDraft, setCreateDraft] =
		useState<CreateWorktreeRequest>(defaultCreateDraft);
	const [showTask, setShowTask] = useState(false);
	const [taskTitle, setTaskTitle] = useState("");
	const [diff, setDiff] = useState<WorktreeDiff | null>(null);

	const load = useCallback(async () => {
		const generation = ++requestGeneration.current;
		setError("");
		setLoading(true);
		setDiff(null);
		setShowTask(false);
		setTaskTitle("");
		try {
			const next = await readGitworktreeResponse<WorktreeListResponse>(
				await fetchRepositoryWorktrees(repositoryId),
			);
			if (generation !== requestGeneration.current) return;
			setSnapshot({ repositoryId, data: next });
			setSelectedId((current) => {
				if (current && next.worktrees.some((item) => item.id === current))
					return current;
				return (
					next.worktrees.find((item) => item.isBase)?.id ||
					next.worktrees[0]?.id ||
					null
				);
			});
		} catch (loadError) {
			if (generation !== requestGeneration.current) return;
			setError(
				loadError instanceof Error ? loadError.message : String(loadError),
			);
		} finally {
			if (generation === requestGeneration.current) setLoading(false);
		}
	}, [repositoryId]);

	useEffect(() => {
		setShowCreate(false);
		setCreateDraft(defaultCreateDraft());
		void load();
		return () => {
			requestGeneration.current += 1;
		};
	}, [load]);

	const selected = useMemo(
		() => data?.worktrees.find((item) => item.id === selectedId) || null,
		[data, selectedId],
	);
	const runningCount =
		data?.worktrees.filter(
			(item) => item.usage.activeTaskCount + item.usage.activeRunCount > 0,
		).length || 0;
	const attentionCount =
		data?.worktrees.filter(
			(item) => item.removeBlockers.length > 0 && !item.isBase,
		).length || 0;

	const runAction = async (name: string, action: () => Promise<void>) => {
		setBusy(name);
		setError("");
		try {
			await action();
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: String(actionError),
			);
		} finally {
			setBusy(null);
		}
	};

	return {
		data,
		loading,
		error,
		selectedId,
		setSelectedId,
		busy,
		showCreate,
		setShowCreate,
		createDraft,
		setCreateDraft,
		showTask,
		setShowTask,
		taskTitle,
		setTaskTitle,
		diff,
		setDiff,
		load,
		selected,
		runningCount,
		attentionCount,
		runAction,
	};
}
