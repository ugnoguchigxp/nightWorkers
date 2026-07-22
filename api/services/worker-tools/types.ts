export type WorkerToolResult<TPayload> = {
	ok: boolean;
	toolName: string;
	startedAt: string;
	finishedAt: string;
	payload: TPayload;
	error?: {
		code: string;
		message: string;
		retryable?: boolean;
		recoveryAction?: string;
		issues?: Array<{
			path: Array<string | number>;
			message: string;
		}>;
	};
	artifactIds?: string[];
};
