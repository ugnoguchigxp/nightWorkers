export const PERSISTENCE_OWNER_REQUEST_TYPE =
	"persistence_owner.request" as const;
export const PERSISTENCE_OWNER_RESPONSE_TYPE =
	"persistence_owner.response" as const;
export const PERSISTENCE_OWNER_PROTOCOL_VERSION = 1 as const;

export const persistenceOwnerOperations = [
	"client.execute",
	"client.batch",
	"client.execute_multiple",
	"client.migrate",
	"transaction.open",
	"transaction.execute",
	"transaction.batch",
	"transaction.execute_multiple",
	"transaction.commit",
	"transaction.rollback",
	"transaction.close",
] as const;

export type PersistenceOwnerOperation =
	(typeof persistenceOwnerOperations)[number];

export type PersistenceOwnerRequest = {
	type: typeof PERSISTENCE_OWNER_REQUEST_TYPE;
	version: typeof PERSISTENCE_OWNER_PROTOCOL_VERSION;
	requestId: string;
	operation: PersistenceOwnerOperation;
	transactionId?: string;
	arguments: unknown[];
};

export type PersistenceOwnerRemoteError = {
	name: string;
	message: string;
	code?: string;
	stack?: string;
	cause?: PersistenceOwnerRemoteError;
};

export type PersistenceOwnerResponse = {
	type: typeof PERSISTENCE_OWNER_RESPONSE_TYPE;
	version: typeof PERSISTENCE_OWNER_PROTOCOL_VERSION;
	requestId: string;
	ok: boolean;
	result?: unknown;
	error?: PersistenceOwnerRemoteError;
};

const operationSet = new Set<string>(persistenceOwnerOperations);
const PERSISTENCE_OWNER_WIRE_VALUE = "__nightworkers_persistence_owner_value__";

type PersistenceOwnerWireValue = {
	[PERSISTENCE_OWNER_WIRE_VALUE]:
		| "array_buffer"
		| "bigint"
		| "date"
		| "uint8_array";
	value: string;
};

export function isPersistenceOwnerRequest(
	value: unknown,
): value is PersistenceOwnerRequest {
	const record = asRecord(value);
	return Boolean(
		record &&
			record.type === PERSISTENCE_OWNER_REQUEST_TYPE &&
			record.version === PERSISTENCE_OWNER_PROTOCOL_VERSION &&
			typeof record.requestId === "string" &&
			typeof record.operation === "string" &&
			operationSet.has(record.operation) &&
			Array.isArray(record.arguments) &&
			(record.transactionId === undefined ||
				typeof record.transactionId === "string"),
	);
}

export function isPersistenceOwnerResponse(
	value: unknown,
): value is PersistenceOwnerResponse {
	const record = asRecord(value);
	return Boolean(
		record &&
			record.type === PERSISTENCE_OWNER_RESPONSE_TYPE &&
			record.version === PERSISTENCE_OWNER_PROTOCOL_VERSION &&
			typeof record.requestId === "string" &&
			typeof record.ok === "boolean",
	);
}

export function encodePersistenceOwnerValue(value: unknown): unknown {
	if (typeof value === "bigint") return wireValue("bigint", String(value));
	if (value instanceof Date) return wireValue("date", value.toISOString());
	if (value instanceof ArrayBuffer)
		return wireValue("array_buffer", Buffer.from(value).toString("base64"));
	if (ArrayBuffer.isView(value)) {
		const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
		return wireValue("uint8_array", bytes.toString("base64"));
	}
	if (Array.isArray(value)) return value.map(encodePersistenceOwnerValue);
	if (!value || typeof value !== "object") return value;
	const resultSet = asResultSet(value);
	if (resultSet) {
		const normalizedRows = resultSet.rows.map((row) =>
			Array.isArray(row)
				? row
				: resultSet.columns.map((column, index) => row[index] ?? row[column]),
		);
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
				key,
				encodePersistenceOwnerValue(key === "rows" ? normalizedRows : entry),
			]),
		);
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			encodePersistenceOwnerValue(entry),
		]),
	);
}

export function decodePersistenceOwnerValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decodePersistenceOwnerValue);
	const record = asRecord(value);
	if (!record) return value;
	const kind = record[PERSISTENCE_OWNER_WIRE_VALUE];
	if (
		typeof kind === "string" &&
		typeof record.value === "string" &&
		Object.keys(record).length === 2
	) {
		switch (kind) {
			case "bigint":
				return BigInt(record.value);
			case "date":
				return new Date(record.value);
			case "array_buffer": {
				const bytes = Buffer.from(record.value, "base64");
				return bytes.buffer.slice(
					bytes.byteOffset,
					bytes.byteOffset + bytes.byteLength,
				);
			}
			case "uint8_array":
				return new Uint8Array(Buffer.from(record.value, "base64"));
		}
	}
	return Object.fromEntries(
		Object.entries(record).map(([key, entry]) => [
			key,
			decodePersistenceOwnerValue(entry),
		]),
	);
}

function wireValue(
	kind: PersistenceOwnerWireValue[typeof PERSISTENCE_OWNER_WIRE_VALUE],
	value: string,
): PersistenceOwnerWireValue {
	return { [PERSISTENCE_OWNER_WIRE_VALUE]: kind, value };
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asResultSet(value: object): {
	columns: string[];
	rows: Array<Record<string | number, unknown> | unknown[]>;
} | null {
	const record = value as Record<string, unknown>;
	if (
		!Array.isArray(record.columns) ||
		!record.columns.every((column) => typeof column === "string") ||
		!Array.isArray(record.rows) ||
		!record.rows.every((row) => row && typeof row === "object")
	)
		return null;
	return record as {
		columns: string[];
		rows: Array<Record<string | number, unknown> | unknown[]>;
	};
}
