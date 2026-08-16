import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS } from "../../../shared/schemas/security-scan.schema";
import {
	type GenerateSecurityScanTaskCandidatesResponse,
	generateSecurityScanTaskCandidatesResponseSchema,
} from "../../../shared/schemas/security-task-generation.schema";
import { readJsonResponse } from "../../lib/api-error";
import type { Task } from "../nightworkers/types";
import {
	createTasksFromMissionCandidates,
	generateSecurityScanTaskCandidates,
} from "../taskGeneration";

export function useSecurityTaskCandidateController(input: {
	repositoryId: string;
	scanRunRef: string | null;
	onTasksCreated?: (tasks: Task[]) => Promise<void> | void;
}) {
	const { t } = useTranslation();
	const scopeKey = `${input.repositoryId}\u0000${input.scanRunRef ?? ""}`;
	const [selectedFindingRefs, setSelectedFindingRefs] = useState<string[]>([]);
	const [result, setResult] =
		useState<GenerateSecurityScanTaskCandidatesResponse | null>(null);
	const [action, setAction] = useState<"generate" | "create" | null>(null);
	const [error, setError] = useState("");
	const previousScopeKey = useRef(scopeKey);
	const operationIdRef = useRef(0);
	const busyRef = useRef(false);
	useEffect(() => {
		if (previousScopeKey.current === scopeKey) return;
		previousScopeKey.current = scopeKey;
		operationIdRef.current += 1;
		busyRef.current = false;
		setSelectedFindingRefs([]);
		setResult(null);
		setAction(null);
		setError("");
	}, [scopeKey]);

	const toggleFinding = (findingRef: string) => {
		setSelectedFindingRefs((current) =>
			current.includes(findingRef)
				? current.filter((ref) => ref !== findingRef)
				: current.length < SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS
					? [...current, findingRef]
					: current,
		);
	};
	const requestCandidates = async () => {
		if (
			!input.scanRunRef ||
			selectedFindingRefs.length === 0 ||
			busyRef.current
		) {
			return;
		}
		const operationId = ++operationIdRef.current;
		const requestScopeKey = scopeKey;
		busyRef.current = true;
		setAction("generate");
		setError("");
		try {
			const resultPayload = await readJsonResponse<unknown>(
				await generateSecurityScanTaskCandidates(input.repositoryId, {
					scanRunRef: input.scanRunRef,
					findingRefs: selectedFindingRefs,
				}),
			);
			const parsedResult =
				generateSecurityScanTaskCandidatesResponseSchema.safeParse(
					resultPayload,
				);
			if (!parsedResult.success) {
				throw new Error(t("securityScan.taskCandidateResponseInvalid"));
			}
			const nextResult = parsedResult.data;
			if (
				operationIdRef.current === operationId &&
				previousScopeKey.current === requestScopeKey
			) {
				setResult(nextResult);
			}
		} catch (cause) {
			if (
				operationIdRef.current === operationId &&
				previousScopeKey.current === requestScopeKey
			) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (operationIdRef.current === operationId) {
				busyRef.current = false;
				setAction(null);
			}
		}
	};
	const createDraftTasks = async (candidateIds: string[]) => {
		if (candidateIds.length === 0 || busyRef.current) return;
		const operationId = ++operationIdRef.current;
		const requestScopeKey = scopeKey;
		busyRef.current = true;
		setAction("create");
		setError("");
		try {
			const response = await createTasksFromMissionCandidates(
				input.repositoryId,
				{
					candidateIds,
					mode: "draft",
				},
			);
			const payload = await readJsonResponse<{ tasks?: unknown }>(response);
			if (
				operationIdRef.current === operationId &&
				previousScopeKey.current === requestScopeKey
			) {
				setResult(null);
				setSelectedFindingRefs([]);
			}
			if (!payload || !("tasks" in payload) || !Array.isArray(payload.tasks)) {
				if (
					operationIdRef.current === operationId &&
					previousScopeKey.current === requestScopeKey
				) {
					setError(t("securityScan.taskCreationResponseInvalid"));
				}
				return;
			}
			const tasks = payload.tasks as Task[];
			try {
				await input.onTasksCreated?.(tasks);
			} catch (cause) {
				if (
					operationIdRef.current === operationId &&
					previousScopeKey.current === requestScopeKey
				) {
					setError(
						t("securityScan.taskRefreshFailed", {
							message: cause instanceof Error ? cause.message : String(cause),
						}),
					);
				}
			}
		} catch (cause) {
			if (
				operationIdRef.current === operationId &&
				previousScopeKey.current === requestScopeKey
			) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (operationIdRef.current === operationId) {
				busyRef.current = false;
				setAction(null);
			}
		}
	};

	const scopeIsCurrent = previousScopeKey.current === scopeKey;
	return {
		selectedFindingRefs: scopeIsCurrent ? selectedFindingRefs : [],
		result: scopeIsCurrent ? result : null,
		action: scopeIsCurrent ? action : null,
		error: scopeIsCurrent ? error : "",
		selectAll: (findingRefs: string[]) =>
			setSelectedFindingRefs(
				findingRefs.slice(0, SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS),
			),
		clearSelection: () => setSelectedFindingRefs([]),
		toggleFinding,
		requestCandidates,
		createDraftTasks,
		closeDialog: () => setResult(null),
	};
}
