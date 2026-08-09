import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SECURITY_SCAN_TASK_GENERATION_MAX_FINDINGS } from "../../../shared/schemas/security-scan.schema";
import {
	type GenerateSecurityScanTaskCandidatesResponse,
	generateSecurityScanTaskCandidatesResponseSchema,
} from "../../../shared/schemas/security-task-generation.schema";
import type { Task } from "../nightworkers/types";
import {
	createTasksFromMissionCandidates,
	generateSecurityScanTaskCandidates,
} from "../taskGeneration";

async function readJsonResponse<T>(
	responseInput: Response | Promise<Response>,
) {
	const response = await responseInput;
	const payload = (await response.json().catch(() => null)) as
		| T
		| { error?: { message?: string } }
		| null;
	if (!response.ok) {
		throw new Error(
			payload &&
				typeof payload === "object" &&
				"error" in payload &&
				payload.error?.message
				? payload.error.message
				: `Request failed (${response.status})`,
		);
	}
	return payload as T;
}

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
				generateSecurityScanTaskCandidates(input.repositoryId, {
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
			const payload = (await response.json().catch(() => null)) as
				| { tasks?: unknown }
				| { error?: { message?: string } }
				| null;
			if (!response.ok) {
				const responseMessage =
					payload && "error" in payload ? payload.error?.message : undefined;
				throw new Error(
					responseMessage ?? `Request failed (${response.status})`,
				);
			}
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
