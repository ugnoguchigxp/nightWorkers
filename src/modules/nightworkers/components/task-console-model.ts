export function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getTaskConsoleStatusColor(status?: string) {
	switch (status) {
		case "completed":
			return "text-emerald-400 bg-emerald-400/10 border border-emerald-400/20";
		case "failed":
			return "text-rose-400 bg-rose-400/10 border border-rose-400/20";
		case "running":
		case "compiling_context":
		case "context_compiling":
		case "finalizing":
			return "text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 animate-pulse";
		case "needs_review":
			return "text-amber-400 bg-amber-400/10 border border-amber-400/20";
		default:
			return "text-muted-foreground bg-muted/20 border border-border";
	}
}

export function getTaskConsoleStatusLabel(status?: string) {
	return status === "context_compiling" || status === "compiling_context"
		? "prompt_preparing"
		: status;
}
