const priorityValues = ["P0", "P1", "P2"];
const gateStatusValues = ["required", "planned", "observational"];
const suiteValues = ["smoke", "regression", "accessibility", "live"];

const asObject = (value) =>
	value && typeof value === "object" && !Array.isArray(value) ? value : null;

const roundPercent = (value) => Math.round(value * 100) / 100;

const percentage = (numerator, denominator) =>
	denominator > 0 ? roundPercent((numerator / denominator) * 100) : 0;

const normalizeTag = (tag) =>
	typeof tag === "string" ? tag.replace(/^@/, "") : "";

function collectSpecs(suites, output = []) {
	for (const suite of Array.isArray(suites) ? suites : []) {
		if (Array.isArray(suite.specs)) output.push(...suite.specs);
		collectSpecs(suite.suites, output);
	}
	return output;
}

function testOutcome(test) {
	const results = Array.isArray(test?.results) ? test.results : [];
	const resultStatuses = results.map((result) => result?.status).filter(Boolean);
	const lastStatus = resultStatuses.at(-1);
	const flaky = test?.status === "flaky" || results.length > 1;
	const skipped =
		test?.status === "skipped" ||
		resultStatuses.length === 0 ||
		resultStatuses.every((status) => status === "skipped");
	const passed =
		!skipped &&
		(test?.status === "expected" || test?.status === "flaky") &&
		lastStatus === "passed";
	return {
		passed,
		flaky,
		skipped,
		failed: !passed && !skipped,
	};
}

export function validateE2eScenarioCatalog(catalog) {
	const errors = [];
	const root = asObject(catalog);
	if (!root) return { errors: ["catalog must be an object"], scenarios: [] };
	if (root.version !== 1) errors.push("catalog.version must be 1");

	const thresholds = asObject(root.thresholds);
	for (const key of [
		"p0CoverageMinimum",
		"weightedCoverageMinimum",
		"executedPassRateMinimum",
		"p0FlakeMaximum",
	]) {
		if (typeof thresholds?.[key] !== "number") {
			errors.push(`catalog.thresholds.${key} must be a number`);
		}
	}

	const weights = asObject(root.weights);
	for (const priority of priorityValues) {
		if (typeof weights?.[priority] !== "number" || weights[priority] <= 0) {
			errors.push(`catalog.weights.${priority} must be a positive number`);
		}
	}

	const scenarios = Array.isArray(root.scenarios) ? root.scenarios : [];
	if (!Array.isArray(root.scenarios)) errors.push("catalog.scenarios must be an array");
	const ids = new Set();
	for (const [index, value] of scenarios.entries()) {
		const scenario = asObject(value);
		const prefix = `catalog.scenarios[${index}]`;
		if (!scenario) {
			errors.push(`${prefix} must be an object`);
			continue;
		}
		if (typeof scenario.id !== "string" || !/^NW-E2E-[A-Z0-9-]+$/.test(scenario.id)) {
			errors.push(`${prefix}.id must use the NW-E2E-* format`);
		} else if (ids.has(scenario.id)) {
			errors.push(`${prefix}.id is duplicated: ${scenario.id}`);
		} else {
			ids.add(scenario.id);
		}
		if (typeof scenario.title !== "string" || !scenario.title.trim()) {
			errors.push(`${prefix}.title must be a non-empty string`);
		}
		if (!priorityValues.includes(scenario.priority)) {
			errors.push(`${prefix}.priority must be P0, P1, or P2`);
		}
		if (!suiteValues.includes(scenario.suite)) {
			errors.push(`${prefix}.suite is invalid`);
		}
		if (!gateStatusValues.includes(scenario.gateStatus)) {
			errors.push(`${prefix}.gateStatus is invalid`);
		}
		if (
			!Array.isArray(scenario.requiredEvidence) ||
			scenario.requiredEvidence.length === 0
		) {
			errors.push(`${prefix}.requiredEvidence must be a non-empty array`);
		}
	}

	return { errors, scenarios };
}

export function evaluateE2eScenarioCoverage({
	catalog,
	report,
	playwrightExitCode = 0,
	now = new Date(),
}) {
	const catalogValidation = validateE2eScenarioCatalog(catalog);
	const root = asObject(catalog) ?? {};
	const reportRoot = asObject(report) ?? {};
	const scenarios = catalogValidation.scenarios;
	const scenarioById = new Map(
		scenarios
			.filter((scenario) => typeof scenario?.id === "string")
			.map((scenario) => [scenario.id, scenario]),
	);
	const mappedSpecs = new Map();
	const issues = catalogValidation.errors.map((message) => ({
		code: "invalid_catalog",
		message,
	}));

	if (!asObject(report)) {
		issues.push({ code: "report_missing", message: "Playwright JSON report is missing." });
	}
	if (playwrightExitCode !== 0) {
		issues.push({
			code: "playwright_failed",
			message: `Playwright exited with code ${playwrightExitCode}.`,
		});
	}

	for (const spec of collectSpecs(reportRoot.suites)) {
		const tags = new Set((spec.tags ?? []).map(normalizeTag).filter(Boolean));
		const scenarioIds = [...tags]
			.filter((tag) => tag.startsWith("scenario:"))
			.map((tag) => tag.slice("scenario:".length));
		if (scenarioIds.length === 0) {
			issues.push({
				code: "scenario_tag_missing",
				message: `${spec.file}:${spec.line} ${spec.title} has no scenario tag.`,
			});
			continue;
		}
		if (scenarioIds.length > 1) {
			issues.push({
				code: "multiple_scenario_tags",
				message: `${spec.file}:${spec.line} ${spec.title} has multiple scenario tags.`,
			});
		}
		for (const scenarioId of scenarioIds) {
			const scenario = scenarioById.get(scenarioId);
			if (!scenario) {
				issues.push({
					code: "unknown_scenario",
					message: `${spec.file}:${spec.line} references unknown scenario ${scenarioId}.`,
				});
				continue;
			}
			const priorityTag = scenario.priority.toLowerCase();
			if (!tags.has(priorityTag)) {
				issues.push({
					code: "priority_tag_mismatch",
					message: `${scenarioId} requires @${priorityTag}.`,
				});
			}
			const expectedExecutionTag = scenario.suite === "live" ? "live" : "deterministic";
			if (!tags.has(expectedExecutionTag)) {
				issues.push({
					code: "execution_tag_mismatch",
					message: `${scenarioId} requires @${expectedExecutionTag}.`,
				});
			}
			const entries = mappedSpecs.get(scenarioId) ?? [];
			entries.push({
				file: spec.file,
				line: spec.line,
				title: spec.title,
				tests: Array.isArray(spec.tests) ? spec.tests : [],
			});
			mappedSpecs.set(scenarioId, entries);
		}
	}

	const requiredScenarios = scenarios.filter(
		(scenario) => scenario?.gateStatus === "required",
	);
	const weights = asObject(root.weights) ?? {};
	const thresholds = asObject(root.thresholds) ?? {};
	const requiredWeight = requiredScenarios.reduce(
		(total, scenario) => total + (weights[scenario.priority] ?? 0),
		0,
	);
	const automatedScenarios = requiredScenarios.filter((scenario) =>
		mappedSpecs.has(scenario.id),
	);
	const automatedWeight = automatedScenarios.reduce(
		(total, scenario) => total + (weights[scenario.priority] ?? 0),
		0,
	);
	const p0Scenarios = requiredScenarios.filter(
		(scenario) => scenario.priority === "P0",
	);
	const automatedP0 = p0Scenarios.filter((scenario) =>
		mappedSpecs.has(scenario.id),
	);

	const scenarioResults = requiredScenarios.map((scenario) => {
		const specs = mappedSpecs.get(scenario.id) ?? [];
		const outcomes = specs.flatMap((spec) => spec.tests.map(testOutcome));
		const automated = specs.length > 0;
		const skipped = automated && (outcomes.length === 0 || outcomes.some((outcome) => outcome.skipped));
		const failed = automated && outcomes.some((outcome) => outcome.failed);
		const flaky = automated && outcomes.some((outcome) => outcome.flaky);
		const passed = automated && outcomes.length > 0 && outcomes.every((outcome) => outcome.passed);
		return {
			id: scenario.id,
			title: scenario.title,
			priority: scenario.priority,
			suite: scenario.suite,
			automated,
			passed,
			failed,
			skipped,
			flaky,
			specs: specs.map(({ file, line, title }) => ({ file, line, title })),
		};
	});
	const executedScenarios = scenarioResults.filter((scenario) => scenario.automated);
	const passedScenarios = executedScenarios.filter((scenario) => scenario.passed);
	const p0Flakes = scenarioResults.filter(
		(scenario) => scenario.priority === "P0" && scenario.flaky,
	);
	for (const scenario of scenarioResults) {
		if (!scenario.automated) {
			issues.push({
				code: "required_scenario_unmapped",
				message: `${scenario.id} is required but has no mapped Playwright test.`,
			});
		} else if (scenario.skipped) {
			issues.push({
				code: "required_scenario_skipped",
				message: `${scenario.id} was skipped or did not run.`,
			});
		} else if (scenario.failed) {
			issues.push({
				code: "required_scenario_failed",
				message: `${scenario.id} failed.`,
			});
		}
	}
	const weightedCoverage = percentage(automatedWeight, requiredWeight);
	const p0Coverage = percentage(automatedP0.length, p0Scenarios.length);
	const executedPassRate = percentage(passedScenarios.length, executedScenarios.length);

	const thresholdResults = {
		p0Coverage: p0Coverage >= (thresholds.p0CoverageMinimum ?? Number.POSITIVE_INFINITY),
		weightedCoverage:
			weightedCoverage >=
			(thresholds.weightedCoverageMinimum ?? Number.POSITIVE_INFINITY),
		executedPassRate:
			executedPassRate >=
			(thresholds.executedPassRateMinimum ?? Number.POSITIVE_INFINITY),
		p0Flake:
			p0Flakes.length <= (thresholds.p0FlakeMaximum ?? Number.NEGATIVE_INFINITY),
	};
	const passed =
		issues.length === 0 && Object.values(thresholdResults).every(Boolean);

	return {
		version: 1,
		generatedAt: now.toISOString(),
		catalogVersion: root.version ?? null,
		playwrightExitCode,
		passed,
		thresholds,
		thresholdResults,
		summary: {
			requiredScenarios: requiredScenarios.length,
			automatedScenarios: automatedScenarios.length,
			passedScenarios: passedScenarios.length,
			p0Coverage,
			weightedCoverage,
			executedPassRate,
			p0Flakes: p0Flakes.length,
			plannedScenarios: scenarios.filter(
				(scenario) => scenario?.gateStatus === "planned",
			).length,
		},
		scenarios: scenarioResults,
		uncovered: scenarioResults
			.filter((scenario) => !scenario.automated)
			.map((scenario) => scenario.id),
		planned: scenarios
			.filter((scenario) => scenario?.gateStatus === "planned")
			.map((scenario) => ({
				id: scenario.id,
				title: scenario.title,
				priority: scenario.priority,
			})),
		issues,
	};
}
