import { describe, expect, it } from "vitest";
import { parseJUnitXmlCases } from "../../api/services/verification/adapters/junit";

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
});
