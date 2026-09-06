import { allCoverage } from "./vitest.coverage";
import { createTestConfig } from "./vitest.shared";

export default createTestConfig(
	allCoverage,
	Boolean(process.env.NIGHTWORKERS_COVERAGE_SHARD_REPORTS_DIR),
);
