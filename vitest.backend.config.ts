import { backendCoverage } from "./vitest.coverage";
import { createTestConfig } from "./vitest.shared";

export default createTestConfig(backendCoverage, true);
