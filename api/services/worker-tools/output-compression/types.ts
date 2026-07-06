export type ToolOutputCompressionStrategy =
	| "passthrough"
	| "read_cache_marker"
	| "read_file_summary"
	| "log_error_tail";

export interface ToolOutputCompressionMetadata {
	compressed: boolean;
	strategy: ToolOutputCompressionStrategy;
	originalChars: number;
	returnedChars: number;
	originalLines?: number;
	returnedLines?: number;
	artifactPath?: string;
	contentHash?: string;
	omittedReason?: string;
}

export interface ReadFileCacheEntry {
	absolutePath: string;
	contentHash: string;
	totalLines: number;
	tokenEstimate: number;
	firstReadAt: string;
	lastReadAt: string;
}

export interface WorkerToolExecutionContext {
	readFileCache?: Map<string, ReadFileCacheEntry>;
}
