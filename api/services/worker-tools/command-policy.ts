/**
 * Command safety policy helper.
 *
 * The tool API keeps `command` as a string for compatibility, but execution
 * only receives a parsed single command. Shell syntax is deliberately not a
 * supported command language.
 */

export type CommandClassification =
	| "read_only"
	| "build_test"
	| "background"
	| "format"
	| "package_install_if_explicit"
	| "destructive"
	| "unknown";

export type CommandParseFailureKind =
	| "empty_command"
	| "invalid_character"
	| "shell_control"
	| "command_substitution"
	| "subshell"
	| "environment_assignment"
	| "parse_error";

export interface ParsedSingleCommand {
	program: string;
	args: string[];
}

export type ParsedSingleCommandResult =
	| { ok: true; command: ParsedSingleCommand }
	| {
			ok: false;
			kind: CommandParseFailureKind;
			reason: string;
	  };

export interface CommandSafetyResult {
	allowed: boolean;
	classification: CommandClassification;
	reason?: string;
	rejectionKind?: CommandParseFailureKind | "blocklist" | "destructive";
	parsed?: ParsedSingleCommand;
}

const DESTRUCTIVE_KEYWORDS = [
	"rm -rf /",
	"rm -rf *",
	"npm publish",
	"pnpm publish",
	"yarn publish",
	"gh pr merge",
	"git push",
	"git reset --hard",
	"git checkout --",
	"git clean -fd",
	"dd if=",
	":(){:|:&};:", // fork bomb
	"mkfs",
	"reboot",
	"shutdown",
];

const READ_ONLY_PROGRAMS = new Set([
	"ls",
	"pwd",
	"echo",
	"cat",
	"grep",
	"find",
	"rg",
]);
const READ_ONLY_COMMANDS = [
	["git", "status"],
	["git", "diff"],
	["git", "log"],
	["git", "show"],
];

const BUILD_TEST_COMMANDS = [
	["bun", "test"],
	["bun", "run", "test"],
	["bun", "run", "typecheck"],
	["bun", "run", "lint"],
	["bun", "run", "build"],
	["pnpm", "test"],
	["pnpm", "typecheck"],
	["pnpm", "lint"],
	["pnpm", "build"],
	["pnpm", "test", "run"],
	["npm", "test"],
	["npm", "run", "test"],
	["npm", "run", "typecheck"],
	["npm", "run", "lint"],
	["npm", "run", "build"],
	["yarn", "test"],
	["yarn", "typecheck"],
	["yarn", "lint"],
	["yarn", "build"],
	["bunx", "--no-install", "vitest", "list"],
	["cargo", "test"],
	["cargo", "nextest", "list"],
	["go", "test"],
	["./gradlew", "test"],
	["gradle", "test"],
	["mvn", "test"],
];

const BACKGROUND_COMMANDS = [
	["pnpm", "dev"],
	["pnpm", "dev:api"],
	["pnpm", "dev:web"],
	["pnpm", "start"],
	["npm", "run", "dev"],
	["npm", "run", "start"],
	["yarn", "dev"],
	["yarn", "start"],
	["vite"],
	["tsx", "watch"],
	["tail", "-f"],
];

const FORMAT_COMMANDS = [
	["pnpm", "format"],
	["pnpm", "biome", "format"],
];
const EXPLICIT_INSTALL_COMMANDS = [
	["pnpm", "add"],
	["pnpm", "install"],
];

const UNSAFE_FIND_ARGUMENTS = new Set([
	"-delete",
	"-exec",
	"-execdir",
	"-ok",
	"-okdir",
	"-fprint",
	"-fprint0",
	"-fprintf",
]);

function parseFailure(
	kind: CommandParseFailureKind,
	reason: string,
): ParsedSingleCommandResult {
	return { ok: false, kind, reason };
}

/**
 * Parses exactly one simple command. Quotes and escapes are resolved into the
 * argv that the process launcher receives; shell operators are rejected.
 */
export function parseSingleCommand(command: string): ParsedSingleCommandResult {
	if (command.length === 0 || command.trim().length === 0) {
		return parseFailure("empty_command", "Command must not be empty.");
	}

	const tokens: string[] = [];
	let current = "";
	let tokenStarted = false;
	let quote: "single" | "double" | null = null;
	let escaped = false;

	const finishToken = () => {
		if (!tokenStarted) return;
		tokens.push(current);
		current = "";
		tokenStarted = false;
	};

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];
		if (character === "\0") {
			return parseFailure(
				"invalid_character",
				"Command contains an unsupported null character.",
			);
		}
		if (character === "\n" || character === "\r") {
			return parseFailure(
				"shell_control",
				"Chained or shell control syntax is blocked by policy.",
			);
		}

		if (quote === "single") {
			if (character === "'") {
				quote = null;
			} else {
				current += character;
			}
			continue;
		}

		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}

		if (character === "\\") {
			tokenStarted = true;
			escaped = true;
			continue;
		}

		if (quote === "double") {
			if (character === '"') {
				quote = null;
				continue;
			}
			if (
				character === "`" ||
				(character === "$" && command[index + 1] === "(")
			) {
				return parseFailure(
					"command_substitution",
					"Command substitution is blocked by policy.",
				);
			}
			current += character;
			continue;
		}

		if (character === "'") {
			tokenStarted = true;
			quote = "single";
			continue;
		}
		if (character === '"') {
			tokenStarted = true;
			quote = "double";
			continue;
		}
		if (/\s/.test(character)) {
			finishToken();
			continue;
		}
		if (
			character === "`" ||
			(character === "$" && command[index + 1] === "(")
		) {
			return parseFailure(
				"command_substitution",
				"Command substitution is blocked by policy.",
			);
		}
		if (character === "(" || character === ")") {
			return parseFailure("subshell", "Subshell syntax is blocked by policy.");
		}
		if (["|", "&", ";", "<", ">"].includes(character)) {
			return parseFailure(
				"shell_control",
				"Chained or shell control syntax is blocked by policy.",
			);
		}

		tokenStarted = true;
		current += character;
	}

	if (escaped || quote !== null) {
		return parseFailure(
			"parse_error",
			"Command contains an incomplete quote or escape sequence.",
		);
	}
	finishToken();

	if (tokens.length === 0 || tokens[0].length === 0) {
		return parseFailure("empty_command", "Command must not be empty.");
	}
	if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
		return parseFailure(
			"environment_assignment",
			"Leading environment assignments are blocked by policy.",
		);
	}

	return { ok: true, command: { program: tokens[0], args: tokens.slice(1) } };
}

function startsWithTokens(
	command: ParsedSingleCommand,
	prefix: readonly string[],
): boolean {
	const tokens = [command.program, ...command.args];
	return prefix.every((value, index) => tokens[index] === value);
}

function hasUnsafeReadOnlyArguments(command: ParsedSingleCommand): boolean {
	if (command.program === "find") {
		return command.args.some((argument) => UNSAFE_FIND_ARGUMENTS.has(argument));
	}
	if (command.program === "rg") {
		return command.args.some(
			(argument) => argument === "--pre" || argument.startsWith("--pre="),
		);
	}
	return false;
}

function isReadOnlyCommand(command: ParsedSingleCommand): boolean {
	if (hasUnsafeReadOnlyArguments(command)) return false;
	return (
		READ_ONLY_PROGRAMS.has(command.program) ||
		READ_ONLY_COMMANDS.some((prefix) => startsWithTokens(command, prefix))
	);
}

function packageScriptName(command: ParsedSingleCommand): string | null {
	const [first, second] = command.args;
	if (command.program === "bun")
		return first === "run" ? (second ?? null) : (first ?? null);
	if (command.program === "pnpm" || command.program === "yarn") {
		return first === "run" ? (second ?? null) : (first ?? null);
	}
	if (command.program === "npm")
		return first === "run"
			? (second ?? null)
			: first === "test"
				? "test"
				: null;
	return null;
}

function isPackageVerifyCommand(command: ParsedSingleCommand): boolean {
	const scriptName = packageScriptName(command);
	return (
		(scriptName !== null && /^verify(?::[\w-]+)?$/.test(scriptName)) ||
		(command.program === "bun" &&
			/^scripts\/verify\.(?:ts|js|mjs)$/.test(command.args[0] ?? ""))
	);
}

function isPackageQualityCommand(command: ParsedSingleCommand): boolean {
	const scriptName = packageScriptName(command);
	return (
		scriptName !== null &&
		/^(?:test|typecheck|lint|build|coverage)(?::[\w-]+)?$/.test(scriptName)
	);
}

function isMutatingGitCommand(command: ParsedSingleCommand): boolean {
	if (command.program !== "git") return false;
	return command.args.some((argument) =>
		["push", "checkout", "reset", "commit", "clean"].includes(argument),
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function analyzeCommand(
	command: string,
	blockedCommands?: string[],
): CommandSafetyResult {
	const parsed = parseSingleCommand(command);
	if (!parsed.ok) {
		return {
			allowed: false,
			classification: "destructive",
			reason: parsed.reason,
			rejectionKind: parsed.kind,
		};
	}

	// Blocklist entries are policy values, so preserve their exact compatibility
	// semantics while all command structure comes from the parsed representation.
	if (blockedCommands && blockedCommands.length > 0) {
		const isBlocked = blockedCommands.some(
			(blocked) =>
				command.includes(blocked) ||
				new RegExp(`\\b${escapeRegExp(blocked)}\\b`).test(command),
		);
		if (isBlocked) {
			return {
				allowed: false,
				classification: "destructive",
				reason: "Command matches blocklist entry.",
				rejectionKind: "blocklist",
			};
		}
	}

	if (DESTRUCTIVE_KEYWORDS.some((keyword) => command.includes(keyword))) {
		return {
			allowed: false,
			classification: "destructive",
			reason:
				"Command is classified as destructive and violates safety policy.",
			rejectionKind: "destructive",
		};
	}

	if (isMutatingGitCommand(parsed.command)) {
		return {
			allowed: false,
			classification: "destructive",
			reason: "Mutating git command is blocked by policy.",
			rejectionKind: "destructive",
		};
	}

	let classification: CommandClassification = "unknown";
	if (isReadOnlyCommand(parsed.command)) {
		classification = "read_only";
	} else if (
		BUILD_TEST_COMMANDS.some((prefix) =>
			startsWithTokens(parsed.command, prefix),
		) ||
		isPackageQualityCommand(parsed.command) ||
		isPackageVerifyCommand(parsed.command)
	) {
		classification = "build_test";
	} else if (isBackgroundCommand(parsed.command)) {
		classification = "background";
	} else if (
		FORMAT_COMMANDS.some((prefix) => startsWithTokens(parsed.command, prefix))
	) {
		classification = "format";
	} else if (
		EXPLICIT_INSTALL_COMMANDS.some((prefix) =>
			startsWithTokens(parsed.command, prefix),
		)
	) {
		classification = "package_install_if_explicit";
	}

	return {
		allowed: classification !== "unknown",
		classification,
		reason:
			classification === "unknown"
				? "Unknown command is denied by default."
				: undefined,
		parsed: parsed.command,
	};
}

export function isBackgroundCommand(
	command: string | ParsedSingleCommand,
): boolean {
	if (typeof command !== "string") {
		return BACKGROUND_COMMANDS.some((prefix) =>
			startsWithTokens(command, prefix),
		);
	}
	const parsed = parseSingleCommand(command);
	if (!parsed.ok) return false;
	return BACKGROUND_COMMANDS.some((prefix) =>
		startsWithTokens(parsed.command, prefix),
	);
}
