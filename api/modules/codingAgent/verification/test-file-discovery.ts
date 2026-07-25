import path from "node:path";
import type { TestInventoryCase } from "../../../../shared/schemas/verification-checklist.schema";

export type TestFileClassification = {
	runner: TestInventoryCase["runner"];
	testFileByConvention: boolean;
	technology:
		| "javascript-typescript"
		| "python"
		| "rust"
		| "go"
		| "jvm"
		| "dotnet"
		| "ruby"
		| "php";
};

export function classifyTestFile(
	filePath: string,
): TestFileClassification | null {
	const normalized = filePath.replaceAll("\\", "/");
	const basename = path.posix.basename(normalized).toLocaleLowerCase("en-US");
	const segments = normalized
		.toLocaleLowerCase("en-US")
		.split("/")
		.filter(Boolean);
	const extension = path.posix.extname(basename);

	if (
		[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(
			extension,
		) &&
		(isDotTestName(basename) || segments.includes("__tests__"))
	) {
		return {
			runner: "unknown",
			technology: "javascript-typescript",
			testFileByConvention: true,
		};
	}
	if (
		extension === ".py" &&
		(basename.startsWith("test_") ||
			basename.endsWith("_test.py") ||
			segments.includes("tests"))
	) {
		return {
			runner: "pytest",
			technology: "python",
			testFileByConvention: true,
		};
	}
	if (extension === ".rs") {
		return {
			runner: "cargo-test",
			technology: "rust",
			testFileByConvention: segments.includes("tests"),
		};
	}
	if (basename.endsWith("_test.go")) {
		return {
			runner: "go-test",
			technology: "go",
			testFileByConvention: true,
		};
	}
	if (
		(extension === ".java" || extension === ".kt") &&
		(segments.includes("test") ||
			/(?:test|tests|testcase)\.(?:java|kt)$/.test(basename))
	) {
		return {
			runner: "junit",
			technology: "jvm",
			testFileByConvention: true,
		};
	}
	if (
		extension === ".cs" &&
		(segments.some((segment) => segment.endsWith("tests")) ||
			basename.endsWith("tests.cs"))
	) {
		return {
			runner: "unknown",
			technology: "dotnet",
			testFileByConvention: true,
		};
	}
	if (
		extension === ".rb" &&
		(basename.endsWith("_spec.rb") ||
			basename.endsWith("_test.rb") ||
			basename.startsWith("test_") ||
			segments.includes("spec"))
	) {
		return {
			runner: "unknown",
			technology: "ruby",
			testFileByConvention: true,
		};
	}
	if (
		extension === ".php" &&
		(basename.endsWith("test.php") || segments.includes("tests"))
	) {
		return {
			runner: "unknown",
			technology: "php",
			testFileByConvention: true,
		};
	}
	return null;
}

function isDotTestName(basename: string) {
	const parts = basename.split(".");
	return parts.slice(0, -1).some((part) => part === "test" || part === "spec");
}
