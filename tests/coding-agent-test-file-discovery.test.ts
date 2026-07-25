import { describe, expect, it } from "vitest";
import { classifyTestFile } from "../api/modules/codingAgent/verification/test-file-discovery";

describe("technology-specific test file discovery", () => {
	it.each([
		["src/todo.test.ts", "javascript-typescript", "unknown", true],
		["src/todo.test.mts", "javascript-typescript", "unknown", true],
		["src/__tests__/todo.tsx", "javascript-typescript", "unknown", true],
		["tests/test_todo.py", "python", "pytest", true],
		["tests/todo_test.py", "python", "pytest", true],
		["crates/core/tests/todo.rs", "rust", "cargo-test", true],
		["crates/core/src/todo.rs", "rust", "cargo-test", false],
		["internal/todo_service_test.go", "go", "go-test", true],
		["src/test/java/TodoServiceTest.java", "jvm", "junit", true],
		["TodoService.Tests/TodoServiceTests.cs", "dotnet", "unknown", true],
		["spec/todo_service_spec.rb", "ruby", "unknown", true],
		["test/todo_service_test.rb", "ruby", "unknown", true],
		["tests/TodoServiceTest.php", "php", "unknown", true],
	] as const)("classifies %s as %s", (filePath, technology, runner, testFileByConvention) => {
		expect(classifyTestFile(filePath)).toEqual({
			technology,
			runner,
			testFileByConvention,
		});
	});

	it.each([
		"src/todo.ts",
		"src/contest.ts",
		"src/latest.js",
		"src/main.py",
		"src/main.go",
	])("does not classify a production file as a test: %s", (filePath) => {
		expect(classifyTestFile(filePath)).toBeNull();
	});
});
