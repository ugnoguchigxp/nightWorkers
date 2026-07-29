import { createHash } from "node:crypto";
import type { ImplementationPlan } from "../../../shared/modules/agentsShare";

export function digestImplementationPlan(plan: ImplementationPlan) {
	return `sha256:${createHash("sha256")
		.update(JSON.stringify(plan))
		.digest("hex")}`;
}

export function renderImplementationPlanMarkdown(plan: ImplementationPlan) {
	return [
		"## 実装計画",
		"",
		...plan.steps.flatMap((step, index) => [
			`${index + 1}. ${step.title}`,
			`   ${step.systemContext}`,
		]),
	].join("\n");
}

export function renderSpecificationWithImplementationPlan(
	markdown: string,
	plan: ImplementationPlan,
) {
	const body = removeImplementationPlanSection(markdown.trim());
	const implementationPlan = renderImplementationPlanMarkdown(plan);
	const insertion = body.search(
		/^## (検証計画|完了条件|トレーサビリティ)\s*$/m,
	);
	if (insertion < 0) return `${body}\n\n${implementationPlan}`;
	return [
		body.slice(0, insertion).trimEnd(),
		implementationPlan,
		body.slice(insertion).trimStart(),
	]
		.filter(Boolean)
		.join("\n\n");
}

function removeImplementationPlanSection(markdown: string) {
	const lines = markdown.split(/\r?\n/);
	const output: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (/^##\s+実装計画\s*$/.test(line)) {
			skipping = true;
			continue;
		}
		if (skipping && /^##\s+/.test(line)) skipping = false;
		if (!skipping) output.push(line);
	}
	return output.join("\n").trim();
}
