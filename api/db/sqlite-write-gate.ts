export type StatementLike = string | { sql?: string } | [string, unknown?];

const READ_ONLY_SQL_PREFIXES = ["select", "explain"] as const;
const READ_ONLY_PRAGMAS = new Set([
	"application_id",
	"collation_list",
	"compile_options",
	"database_list",
	"encoding",
	"foreign_key_check",
	"foreign_key_list",
	"function_list",
	"index_info",
	"index_list",
	"index_xinfo",
	"integrity_check",
	"module_list",
	"pragma_list",
	"quick_check",
	"schema_version",
	"table_info",
	"table_list",
	"table_xinfo",
	"user_version",
]);

export function createWriteSerialGate() {
	let tail = Promise.resolve();

	return {
		async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
			const previous = tail;
			let release!: () => void;
			tail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			try {
				return await operation();
			} finally {
				release();
			}
		},
		async acquire() {
			const previous = tail;
			let release!: () => void;
			tail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				release();
			};
		},
	};
}

function statementSql(statement: StatementLike | undefined): string | null {
	if (!statement) return null;
	if (typeof statement === "string") return statement;
	if (Array.isArray(statement))
		return typeof statement[0] === "string" ? statement[0] : null;
	return typeof statement.sql === "string" ? statement.sql : null;
}

function isReadOnlyPragma(sqlText: string) {
	const firstStatement = sqlText.split(";", 1)[0] ?? sqlText;
	if (!/^\s*pragma\b/i.test(firstStatement) || firstStatement.includes("=")) {
		return false;
	}
	const match = /^\s*pragma\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/i.exec(
		firstStatement,
	);
	const pragmaName = match?.[1]?.toLowerCase();
	return Boolean(pragmaName && READ_ONLY_PRAGMAS.has(pragmaName));
}

export function isWriteStatement(statement: StatementLike | undefined) {
	const sqlText = statementSql(statement);
	if (!sqlText) return true;
	const normalized = sqlText.trim().toLowerCase();
	if (!normalized) return true;
	if (isReadOnlyPragma(normalized)) return false;
	if (/^\s*pragma\b/i.test(normalized)) return true;
	return !READ_ONLY_SQL_PREFIXES.some((prefix) =>
		normalized.startsWith(prefix),
	);
}

export function batchContainsWrite(statements: unknown[]) {
	return statements.some((statement) =>
		isWriteStatement(statement as StatementLike),
	);
}
