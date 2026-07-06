export function normalizeVerificationCommand(
	command: string | null,
): string | null {
	if (!command) return null;
	const unwrapped = unwrapShellCommand(command.trim());
	const normalized = unwrapped.replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized : null;
}

export function verificationCommandsMatch(
	actual: string | null,
	recommended: string | null,
) {
	const normalizedActual = normalizeVerificationCommand(actual);
	const normalizedRecommended = normalizeVerificationCommand(recommended);
	if (!normalizedActual || !normalizedRecommended) return false;
	if (normalizedActual === normalizedRecommended) return true;
	return (
		verificationCommandEquivalentKey(normalizedActual) ===
		verificationCommandEquivalentKey(normalizedRecommended)
	);
}

function unwrapShellCommand(command: string) {
	const shellMatch =
		/^(?:\/(?:usr\/)?bin\/)?(?:bash|sh|zsh)\s+-(?:c|lc)\s+(.+)$/.exec(command);
	if (!shellMatch) return command;
	return stripBalancedQuotes(shellMatch[1].trim());
}

function stripBalancedQuotes(value: string) {
	if (value.length < 2) return value;
	const first = value[0];
	const last = value[value.length - 1];
	if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
		return value.slice(1, -1);
	}
	return value;
}

function verificationCommandEquivalentKey(command: string): string {
	const parts = command.split(" ");
	const runner = parts[0];
	if (
		(runner === "bun" || runner === "pnpm" || runner === "yarn") &&
		parts[1] === "run" &&
		parts[2]
	) {
		return [runner, ...parts.slice(2)].join(" ");
	}
	return command;
}
