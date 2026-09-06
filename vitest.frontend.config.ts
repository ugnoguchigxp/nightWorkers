import { frontendCoverage } from "./vitest.coverage";
import { createTestConfig } from "./vitest.shared";

export default createTestConfig(frontendCoverage, true);
