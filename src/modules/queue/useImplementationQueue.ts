import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type {
	ImplementationQueueDashboard,
	ImplementationQueueHealth,
} from "../nightworkers/types";
import {
	archiveImplementationQueueEntry,
	cancelImplementationQueueEntry,
	createImplementationQueueEntry,
	fetchImplementationQueue,
	fetchImplementationQueueHealth,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
	updateImplementationQueueEntry,
	updateImplementationQueueSettings,
} from "./queueCommands";

function invalidateQueueState(queryClient: ReturnType<typeof useQueryClient>) {
	queryClient.invalidateQueries({ queryKey: ["implementationQueue"] });
	queryClient.invalidateQueries({ queryKey: ["implementationQueueHealth"] });
}

export function useImplementationQueue() {
	const queryClient = useQueryClient();
	const {
		data: implementationQueue = null,
		isLoading: isImplementationQueueLoading,
	} = useQuery({
		queryKey: ["implementationQueue"],
		queryFn: async () => {
			return readJsonResponse<ImplementationQueueDashboard>(
				await fetchImplementationQueue(),
			);
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const {
		data: implementationQueueHealth = null,
		isLoading: isImplementationQueueHealthLoading,
	} = useQuery({
		queryKey: ["implementationQueueHealth"],
		queryFn: async () => {
			return readJsonResponse<ImplementationQueueHealth>(
				await fetchImplementationQueueHealth(),
			);
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const createImplementationQueueEntryMutation = useMutation({
		mutationFn: async (input: {
			sessionId: string;
			approveMissionProposal?: boolean;
		}) => {
			return readJsonResponse(
				await createImplementationQueueEntry(input.sessionId, {
					approveMissionProposal: input.approveMissionProposal,
				}),
			);
		},
		onSuccess: () => {
			invalidateQueueState(queryClient);
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
	});

	const archiveImplementationQueueEntryMutation = useMutation({
		mutationFn: async (entryId: string) => {
			return readJsonResponse(await archiveImplementationQueueEntry(entryId));
		},
		onSuccess: () => invalidateQueueState(queryClient),
	});

	const removeImplementationQueueEntryMutation = useMutation({
		mutationFn: async (entryId: string) => {
			await readJsonResponse(await cancelImplementationQueueEntry(entryId));
			return readJsonResponse(await archiveImplementationQueueEntry(entryId));
		},
		onSuccess: () => {
			invalidateQueueState(queryClient);
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
		},
	});

	const requeueImplementationQueueEntryMutation = useMutation({
		mutationFn: async (input: { entryId: string; note?: string }) => {
			return readJsonResponse(
				await requeueImplementationQueueEntry(input.entryId, {
					note: input.note,
				}),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			invalidateQueueState(queryClient);
			queryClient.invalidateQueries({ queryKey: ["sessionRuns"] });
		},
	});

	const updateImplementationQueueEntryMutation = useMutation({
		mutationFn: async (input: {
			entryId: string;
			data: { queuePosition?: number | null; priority?: number };
		}) => {
			return readJsonResponse(
				await updateImplementationQueueEntry(input.entryId, input.data),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			invalidateQueueState(queryClient);
		},
	});

	const updateImplementationQueueProcessorCountMutation = useMutation({
		mutationFn: async (processorCount: number) => {
			return readJsonResponse(
				await updateImplementationQueueSettings({ processorCount }),
			);
		},
		onSuccess: () => invalidateQueueState(queryClient),
	});

	const recoverImplementationQueueEntryMutation = useMutation({
		mutationFn: async (input: {
			entryId: string;
			action: "retry" | "mark_needs_human" | "cancel" | "archive" | "complete";
			note?: string;
		}) => {
			return readJsonResponse(
				await recoverImplementationQueueEntry(input.entryId, {
					action: input.action,
					note: input.note,
				}),
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["sessions"] });
			queryClient.invalidateQueries({ queryKey: ["sessionRuns"] });
			invalidateQueueState(queryClient);
		},
	});

	return {
		implementationQueue,
		implementationQueueHealth,
		isImplementationQueueLoading,
		isImplementationQueueHealthLoading,
		createImplementationQueueEntry: async (
			sessionId: string,
			input: { approveMissionProposal?: boolean } = {},
		) => {
			await createImplementationQueueEntryMutation.mutateAsync({
				sessionId,
				...input,
			});
		},
		archiveImplementationQueueEntry: async (entryId: string) => {
			await archiveImplementationQueueEntryMutation.mutateAsync(entryId);
		},
		removeImplementationQueueEntry: async (entryId: string) => {
			await removeImplementationQueueEntryMutation.mutateAsync(entryId);
		},
		requeueImplementationQueueEntry: async (entryId: string, note?: string) => {
			await requeueImplementationQueueEntryMutation.mutateAsync({
				entryId,
				note,
			});
		},
		updateImplementationQueueEntry: async (
			entryId: string,
			input: { queuePosition?: number | null; priority?: number },
		) => {
			await updateImplementationQueueEntryMutation.mutateAsync({
				entryId,
				data: input,
			});
		},
		updateImplementationQueueProcessorCount: async (processorCount: number) => {
			await updateImplementationQueueProcessorCountMutation.mutateAsync(
				processorCount,
			);
		},
		recoverImplementationQueueEntry: async (
			entryId: string,
			action: "retry" | "mark_needs_human" | "cancel" | "archive" | "complete",
			note?: string,
		) => {
			await recoverImplementationQueueEntryMutation.mutateAsync({
				entryId,
				action,
				note,
			});
		},
	};
}
