export type TestConditionMappingFailureCode =
	| "TEST_MAPPING_AUTHORITY_MISMATCH"
	| "TEST_MAPPING_PRECONDITION_MISSING"
	| "TEST_MAPPING_SOURCE_STALE"
	| "TEST_MAPPING_PERSISTENCE_FAILED"
	| "TEST_INVENTORY_NOT_FOUND"
	| "TEST_CASE_NOT_FOUND"
	| "TEST_CASE_NOT_ACTIVE"
	| "TEST_EVIDENCE_NOT_FOUND"
	| "TEST_EVIDENCE_AMBIGUOUS";

export type TestConditionMappingFailureIssue = {
	path: Array<string | number>;
	message: string;
};

const retryableMappingFailureCodes = new Set<TestConditionMappingFailureCode>([
	"TEST_MAPPING_PRECONDITION_MISSING",
	"TEST_MAPPING_SOURCE_STALE",
	"TEST_INVENTORY_NOT_FOUND",
	"TEST_CASE_NOT_FOUND",
	"TEST_CASE_NOT_ACTIVE",
]);

export class TestConditionMappingFailure extends Error {
	readonly retryable: boolean;

	constructor(
		readonly code: TestConditionMappingFailureCode,
		message: string,
		readonly recoveryAction?: string,
		readonly issues?: TestConditionMappingFailureIssue[],
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "TestConditionMappingFailure";
		this.retryable = retryableMappingFailureCodes.has(code);
	}
}

export type TestInventoryFailureCode =
	| "TEST_INVENTORY_WORKSPACE_DENIED"
	| "TEST_INVENTORY_CWD_NOT_FOUND"
	| "TEST_INVENTORY_CWD_NOT_DIRECTORY"
	| "TEST_INVENTORY_FILE_READ_FAILED"
	| "TEST_INVENTORY_ACTIVE_DISCOVERY_FAILED";

export class TestInventoryFailure extends Error {
	readonly retryable: boolean;

	constructor(
		readonly code: TestInventoryFailureCode,
		message: string,
		readonly recoveryAction?: string,
		options?: ErrorOptions & { retryable?: boolean },
	) {
		super(message, options);
		this.name = "TestInventoryFailure";
		this.retryable = options?.retryable === true;
	}
}
