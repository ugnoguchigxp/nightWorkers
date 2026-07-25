export type TestConditionMappingFailureCode =
	| "TEST_MAPPING_AUTHORITY_MISMATCH"
	| "TEST_MAPPING_PRECONDITION_MISSING"
	| "TEST_MAPPING_SOURCE_STALE"
	| "TEST_MAPPING_PERSISTENCE_FAILED"
	| "TEST_EVIDENCE_NOT_FOUND"
	| "TEST_EVIDENCE_AMBIGUOUS";

export type TestConditionMappingFailureIssue = {
	path: Array<string | number>;
	message: string;
};

export class TestConditionMappingFailure extends Error {
	readonly retryable = false;

	constructor(
		readonly code: TestConditionMappingFailureCode,
		message: string,
		readonly recoveryAction?: string,
		readonly issues?: TestConditionMappingFailureIssue[],
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "TestConditionMappingFailure";
	}
}

export type TestInventoryFailureCode =
	| "TEST_INVENTORY_WORKSPACE_DENIED"
	| "TEST_INVENTORY_CWD_NOT_FOUND"
	| "TEST_INVENTORY_CWD_NOT_DIRECTORY"
	| "TEST_INVENTORY_FILE_READ_FAILED";

export class TestInventoryFailure extends Error {
	readonly retryable = false;

	constructor(
		readonly code: TestInventoryFailureCode,
		message: string,
		readonly recoveryAction?: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "TestInventoryFailure";
	}
}
