import type {
	ToolOutputCompressionMetadata,
	ToolOutputCompressionStrategy,
} from "./types";

export function countLines(value: string): number {
	if (!value) return 0;
	return value.split(/\r?\n/).length;
}

export function estimateTokens(value: string): number {
	return Math.max(1, Math.ceil(value.length / 4));
}

export function buildCompressionMetadata(input: {
	strategy: ToolOutputCompressionStrategy;
	original: string;
	returned: string;
	compressed: boolean;
	artifactPath?: string;
	contentHash?: string;
	omittedReason?: string;
}): ToolOutputCompressionMetadata {
	return {
		compressed: input.compressed,
		strategy: input.strategy,
		originalChars: input.original.length,
		returnedChars: input.returned.length,
		originalLines: countLines(input.original),
		returnedLines: countLines(input.returned),
		artifactPath: input.artifactPath,
		contentHash: input.contentHash,
		omittedReason: input.omittedReason,
	};
}
