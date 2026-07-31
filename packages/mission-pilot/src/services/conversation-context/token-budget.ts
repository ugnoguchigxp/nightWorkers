export function estimateTokens(value: string) {
	return Math.ceil(value.length / 4);
}
