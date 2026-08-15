export const COVERAGE_METRICS = [
	"statements",
	"branches",
	"functions",
	"lines",
] as const;

export type CoverageMetricName = (typeof COVERAGE_METRICS)[number];

export type CoverageMetric = {
	total: number;
	covered: number;
	skipped: number;
	pct: number;
};

export const globalCoverageThresholds = {
	statements: 80,
	branches: 75,
	functions: 80,
	lines: 80,
} as const satisfies Record<CoverageMetricName, number>;

// Bind critical gates to executable implementations. Re-export-only facades have
// no measurable branches and cannot prove the underlying behavior was exercised.
export const criticalBranchAreas = {
	queue: {
		file: "api/modules/queue/queue-repository-commands.ts",
		threshold: 80,
	},
	runStatus: {
		file: "api/modules/nightworkers/run-orchestration/status.ts",
		threshold: 80,
	},
	todoCloseout: {
		file: "api/modules/nightworkers/run-orchestration/todo-closeout.ts",
		threshold: 80,
	},
	review: {
		file: "api/modules/review/rubrics/deterministic-evaluator.ts",
		threshold: 80,
	},
	gitCloseout: {
		file: "api/modules/gitCloseout/closeout-admission.service.ts",
		threshold: 80,
	},
	secretPersistence: {
		file: "api/services/security/secret-persistence-firewall.ts",
		threshold: 80,
	},
	desktopBootstrap: {
		file: "api/runtime/bootstrap.ts",
		threshold: 80,
	},
	toolPolicy: {
		file: "api/services/worker-tools/command-policy.ts",
		threshold: 80,
	},
} as const;

export type GlobalCoverageResult = {
	metric: CoverageMetricName;
	threshold: number;
	actual: number;
	passed: boolean;
};

export type GlobalCoverageReport = {
	schemaVersion: 1;
	passed: boolean;
	thresholds: typeof globalCoverageThresholds;
	results: GlobalCoverageResult[];
	failures: string[];
};

export type CriticalBranchResult = {
	area: keyof typeof criticalBranchAreas;
	file: string;
	threshold: number;
	status: "passed" | "below_threshold" | "missing" | "unmeasured";
	passed: boolean;
	metric: CoverageMetric | null;
};

export type CriticalBranchCoverageReport = {
	schemaVersion: 1;
	passed: boolean;
	results: CriticalBranchResult[];
	failures: string[];
};

export function evaluateGlobalCoverage(summary: unknown): GlobalCoverageReport {
	const summaryRecord = requireRecord(summary, "coverage summary");
	const total = requireRecord(summaryRecord.total, "coverage summary total");
	const results = COVERAGE_METRICS.map((metric) => {
		const actual = requireCoverageMetric(total[metric], `total.${metric}`).pct;
		const threshold = globalCoverageThresholds[metric];
		return { metric, threshold, actual, passed: actual >= threshold };
	});
	const failures = results
		.filter((result) => !result.passed)
		.map(
			(result) => `${result.metric}=${result.actual}% < ${result.threshold}%`,
		);
	return {
		schemaVersion: 1,
		passed: failures.length === 0,
		thresholds: globalCoverageThresholds,
		results,
		failures,
	};
}

export function evaluateCriticalBranchCoverage(
	summary: unknown,
): CriticalBranchCoverageReport {
	const summaryRecord = requireRecord(summary, "backend coverage summary");
	const entries = Object.entries(summaryRecord).filter(
		([file]) => file !== "total",
	);
	const results = Object.entries(criticalBranchAreas).map(
		([area, definition]): CriticalBranchResult => {
			const entry = entries.find(([file]) =>
				matchesRelativePath(file, definition.file),
			);
			if (!entry) {
				return {
					area: area as keyof typeof criticalBranchAreas,
					file: definition.file,
					threshold: definition.threshold,
					status: "missing",
					passed: false,
					metric: null,
				};
			}
			const fileSummary = isRecord(entry[1]) ? entry[1] : null;
			const metric = parseCoverageMetric(fileSummary?.branches);
			if (!metric || metric.total <= 0) {
				return {
					area: area as keyof typeof criticalBranchAreas,
					file: definition.file,
					threshold: definition.threshold,
					status: "unmeasured",
					passed: false,
					metric,
				};
			}
			const passed = metric.pct >= definition.threshold;
			return {
				area: area as keyof typeof criticalBranchAreas,
				file: definition.file,
				threshold: definition.threshold,
				status: passed ? "passed" : "below_threshold",
				passed,
				metric,
			};
		},
	);
	const failures = results
		.filter((result) => !result.passed)
		.map((result) => {
			if (result.status === "missing")
				return `${result.area}: file missing (${result.file})`;
			if (result.status === "unmeasured")
				return `${result.area}: branches unmeasured (${result.file})`;
			return `${result.area}=${result.metric?.pct}% < ${result.threshold}%`;
		});
	return {
		schemaVersion: 1,
		passed: failures.length === 0,
		results,
		failures,
	};
}

function matchesRelativePath(file: string, relativePath: string): boolean {
	const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
	return normalized === relativePath || normalized.endsWith(`/${relativePath}`);
}

function requireCoverageMetric(input: unknown, label: string): CoverageMetric {
	const metric = parseCoverageMetric(input);
	if (!metric) throw new Error(`${label} must be a coverage metric`);
	return metric;
}

function parseCoverageMetric(input: unknown): CoverageMetric | null {
	if (!isRecord(input)) return null;
	const values = [input.total, input.covered, input.skipped, input.pct];
	if (
		!values.every(
			(value) => typeof value === "number" && Number.isFinite(value),
		)
	)
		return null;
	return {
		total: input.total as number,
		covered: input.covered as number,
		skipped: input.skipped as number,
		pct: input.pct as number,
	};
}

function requireRecord(input: unknown, label: string): Record<string, unknown> {
	if (!isRecord(input)) throw new Error(`${label} must be an object`);
	return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}
