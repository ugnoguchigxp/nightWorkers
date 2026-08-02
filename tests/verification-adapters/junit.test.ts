import { describe, expect, it } from "vitest";
import {
	parseJUnitXmlArtifact,
	parseJUnitXmlCases,
} from "../../api/services/verification/adapters/junit";

describe("JUnit verification adapter", () => {
	it("extracts AC markers and failed cases", () => {
		const cases = parseJUnitXmlCases(`
			<testsuite>
				<testcase classname="todo" name="[AC-001] creates task" time="0.015" />
				<testcase classname="todo" name="AC-002 deletes task">
					<failure message="expected delete" />
				</testcase>
			</testsuite>
		`);

		expect(cases).toHaveLength(2);
		expect(cases[0]).toMatchObject({
			name: "todo [AC-001] creates task",
			status: "passed",
			conditionIds: ["AC-001"],
			durationMs: 15,
		});
		expect(cases[1]).toMatchObject({
			status: "failed",
			conditionIds: ["AC-002"],
			failureMessage: "expected delete",
		});
	});

	it("recognizes an empty JUnit report without treating junit as a runner", () => {
		expect(parseJUnitXmlArtifact('<testsuite tests="0"></testsuite>')).toEqual({
			recognized: true,
			cases: [],
		});
		expect(
			parseJUnitXmlArtifact('<testsuite><testcase name="truncated" />'),
		).toEqual({ recognized: false, cases: [] });
		expect(parseJUnitXmlArtifact("plain output")).toEqual({
			recognized: false,
			cases: [],
		});
	});

	it("accepts single-quoted attributes and numeric XML entities", () => {
		expect(
			parseJUnitXmlArtifact(
				"<testsuite><testcase classname='todo' name='creates &#x3E; item' /></testsuite>",
			).cases[0],
		).toMatchObject({ name: "todo creates > item", status: "passed" });
	});

	it("ignores testcase-like logs outside the recognized JUnit root", () => {
		expect(
			parseJUnitXmlArtifact(
				'<testcase name="log-only" /><testsuite tests="0"></testsuite>',
			),
		).toEqual({ recognized: true, cases: [] });
	});
});
