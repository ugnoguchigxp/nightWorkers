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

export function serializePersistenceOwnerResult(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(serializePersistenceOwnerResult);
	if (!value || typeof value !== "object") return value;
	if (
		value instanceof Date ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value)
	)
		return value;
	const toJson = (value as { toJSON?: () => unknown }).toJSON;
	if (typeof toJson === "function")
		return serializePersistenceOwnerResult(toJson.call(value));
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			serializePersistenceOwnerResult(entry),
		]),
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
