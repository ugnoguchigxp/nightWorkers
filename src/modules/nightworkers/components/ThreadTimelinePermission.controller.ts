import { useCallback, useState } from "react";
import type { TaskEvent } from "../types";

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function findExternalPathPermissionRequest(
	events: TaskEvent[],
): string | null {
	for (const event of [...events].reverse()) {
		const payload = asRecord(event.payloadJson);
		if (payload.agentEventType !== "run.needs_human") continue;
		const data = asRecord(payload.payload);
		if (data.reason !== "path_access_denied") continue;
		const args = asRecord(data.arguments);
		const candidate =
			typeof args.sourcePath === "string"
				? args.sourcePath
				: typeof args.filePath === "string"
					? args.filePath
					: typeof args.relativePath === "string"
						? args.relativePath
						: null;
		if (candidate && (candidate.startsWith("/") || candidate.startsWith("..")))
			return candidate;
	}
	return null;
}

export function useExternalPathPermissionController(input: {
	events: TaskEvent[];
	onGrant?: (path: string) => Promise<void>;
}) {
	const [isGranting, setIsGranting] = useState(false);
	const [dismissedPath, setDismissedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const path = findExternalPathPermissionRequest(input.events);
	const isOpen = Boolean(path && path !== dismissedPath && input.onGrant);
	const dismiss = useCallback(() => setDismissedPath(path), [path]);
	const grant = useCallback(async () => {
		if (!input.onGrant || !path) return;
		setIsGranting(true);
		setError(null);
		try {
			await input.onGrant(path);
			setDismissedPath(path);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "外部フォルダの許可に失敗しました。",
			);
		} finally {
			setIsGranting(false);
		}
	}, [input.onGrant, path]);
	return { path, isOpen, isGranting, error, dismiss, grant };
}
