export type ActivitySource =
	| "user"
	| "assistant"
	| "supervisor"
	| "worker"
	| "tool"
	| "system"
	| "provider"
	| "runtime"
	| "transport"
	| "ui";

export type ActivityStatus =
	| "started"
	| "delta"
	| "completed"
	| "failed"
	| "paused"
	| "resumed"
	| "info"
	| "unknown";
