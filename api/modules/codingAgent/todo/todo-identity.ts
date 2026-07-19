import { createHash } from "node:crypto";

const CANONICAL_TODO_ID_PREFIX = "todo_";
const CANONICAL_TODO_ID_DIGEST_LENGTH = 48;

export function buildCanonicalTodoId(runId: string, todoKey: string) {
	const digest = createHash("sha256")
		.update(runId)
		.update("\0")
		.update(todoKey)
		.digest("hex")
		.slice(0, CANONICAL_TODO_ID_DIGEST_LENGTH);
	return `${CANONICAL_TODO_ID_PREFIX}${digest}`;
}
