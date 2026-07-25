import { describe, expect, it } from "vitest";
import { extractStaticTestNames } from "../api/modules/codingAgent/verification/static-test-case-discovery";
import type { TestFileClassification } from "../api/modules/codingAgent/verification/test-file-discovery";

function names(
	technology: TestFileClassification["technology"],
	source: string,
) {
	return extractStaticTestNames({
		source,
		classification: {
			technology,
			runner: "unknown",
			testFileByConvention: true,
		},
	});
}

describe("pure TypeScript static test declaration discovery", () => {
	it("extracts JavaScript and TypeScript it/test declarations", () => {
		expect(
			names(
				"javascript-typescript",
				`
					describe("todos", () => {
						it("creates a todo", () => {});
						test.only('rejects invalid input', () => {});
						test.concurrent("runs concurrently", () => {});
					});
				`,
			),
		).toEqual(["creates a todo", "rejects invalid input", "runs concurrently"]);
	});

	it.each([
		["python", "def test_creates_todo():\n    pass", ["test_creates_todo"]],
		["rust", "#[test]\nfn creates_todo() {}", ["creates_todo"]],
		["go", "func TestCreatesTodo(t *testing.T) {}", ["TestCreatesTodo"]],
		["jvm", "@Test\nvoid createsTodo() {}", ["createsTodo"]],
		["dotnet", "[Fact]\npublic void CreatesTodo() {}", ["CreatesTodo"]],
		["ruby", 'it "creates a todo" do\nend', ["creates a todo"]],
		["php", "public function testCreatesTodo() {}", ["testCreatesTodo"]],
	] as const)("extracts %s test declarations", (technology, source, expected) => {
		expect(names(technology, source)).toEqual(expected);
	});

	it("does not treat describe blocks or helper functions as test cases", () => {
		expect(
			names(
				"javascript-typescript",
				`
					describe("todos", () => {});
					function testHelper() {}
					api.test("helper method", () => {});
				`,
			),
		).toEqual([]);
	});

	it("does not treat test-like text inside a source string as a declaration", () => {
		expect(
			names(
				"javascript-typescript",
				`
					const fixture = 'test("not a declaration", () => {})';
					test("real declaration", () => {});
				`,
			),
		).toEqual(["real declaration"]);
	});

	it.each([
		[
			"javascript-typescript",
			'// test("disabled", () => {});\n/* it("also disabled", () => {}); */',
		],
		["python", '"""\ndef test_documentation_only():\n    pass\n"""'],
		["rust", "// #[test]\n// fn disabled() {}\n/* #[test] fn hidden() {} */"],
		["ruby", '# it "disabled" do\n# end'],
	] as const)("does not promote commented-out %s declarations", (technology, source) => {
		expect(names(technology, source)).toEqual([]);
	});

	it("preserves duplicate names so ambiguous evidence cannot be silently collapsed", () => {
		expect(
			names(
				"javascript-typescript",
				'test("same name", () => {});\ntest("same name", () => {});',
			),
		).toEqual(["same name", "same name"]);
	});

	it("extracts common JUnit 5 test annotations", () => {
		expect(
			names(
				"jvm",
				"@ParameterizedTest\nvoid acceptsCases() {}\n@RepeatedTest(2)\nvoid retries() {}",
			),
		).toEqual(["acceptsCases", "retries"]);
	});

	it.each([
		[
			"javascript-typescript",
			'test.skip("disabled", () => {});\ntest.todo("planned");',
		],
		["python", "@pytest.mark.skip\ndef test_disabled():\n    pass"],
		["rust", "#[ignore]\n#[test]\nfn disabled() {}"],
		["jvm", "@Disabled\n@Test\nvoid disabled() {}"],
		["dotnet", '[Fact(Skip = "later")]\npublic void Disabled() {}'],
	] as const)("does not promote disabled %s tests as active", (technology, source) => {
		expect(names(technology, source)).toEqual([]);
	});

	it("does not let a previous skip decorator hide the next active Python test", () => {
		expect(
			names(
				"python",
				"@pytest.mark.skip\ndef test_disabled():\n    pass\ndef test_active():\n    pass",
			),
		).toEqual(["test_active"]);
	});
});
