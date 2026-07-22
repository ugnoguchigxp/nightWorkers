export type TestConditionMappingFailureCode =
	| "TEST_MAPPING_AUTHORITY_MISMATCH"
	| "TEST_MAPPING_PRECONDITION_MISSING"
	| "TEST_MAPPING_SOURCE_STALE"
	| "TEST_MAPPING_DECLARATION_MISMATCH"
	| "TEST_MAPPING_PERSISTENCE_FAILED";

export class TestConditionMappingFailure extends Error {
	readonly retryable = false;

	constructor(
		readonly code: TestConditionMappingFailureCode,
		message: string,
		readonly recoveryAction?: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "TestConditionMappingFailure";
	}
}
