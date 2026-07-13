import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createStructuredLlmAbortSignal,
	jsonFixWrapper,
	parseRepairedJsonWithSchema,
} from "../../api/services/structured-llm/json";
import { questionnaireChoiceFormSchema } from "../../shared/schemas/design-questionnaire.schema";

describe("structured LLM JSON helpers", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("extracts fenced JSON with jsonFixWrapper", () => {
		const fixed = jsonFixWrapper('```json\n{"ok":true}\n```');

		expect(fixed).toMatchObject({
			parsedJson: { ok: true },
			repaired: true,
			repairKind: "extracted_candidate",
		});
	});

	it("repairs truncated JSON before Zod schema validation", () => {
		const parsed = parseRepairedJsonWithSchema(
			'{"title":"実装前に決めたいこと","questions":[{"text":"範囲は？","type":"radio","options":["A","B"]}',
			questionnaireChoiceFormSchema,
		);

		expect(parsed).toMatchObject({
			ok: true,
			repaired: true,
			repairKind: "balanced_json",
		});
		if (parsed.ok)
			expect(parsed.value.questions[0]?.options).toEqual(["A", "B"]);
	});

	it("repairs common LLM JSON syntax drift before Zod schema validation", () => {
		const parsed = parseRepairedJsonWithSchema(
			`{
        title: '実装前に決めたいこと',
        questions: [
          { text: '範囲は？', type: 'radio', options: ['A', 'B',], },
        ],
      }`,
			questionnaireChoiceFormSchema,
		);

		expect(parsed).toMatchObject({
			ok: true,
			repaired: true,
			repairKind: "jsonrepair",
		});
		if (parsed.ok) {
			expect(parsed.value.title).toBe("実装前に決めたいこと");
			expect(parsed.value.questions[0]?.options).toEqual(["A", "B"]);
		}
	});

	it("keeps raw output when repaired JSON fails schema validation", () => {
		const parsed = parseRepairedJsonWithSchema(
			'{"title":"x","questions":[]}',
			questionnaireChoiceFormSchema,
		);

		expect(parsed.ok).toBe(false);
		if (!parsed.ok)
			expect(parsed.rawOutput).toBe('{"title":"x","questions":[]}');
	});

	it("disposes structured LLM timeout signals after use", async () => {
		const handle = createStructuredLlmAbortSignal({ timeoutMs: 20 });
		handle.dispose();

		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(handle.signal.aborted).toBe(false);
	});

	it("uses 180 seconds as the default structured LLM timeout", () => {
		vi.useFakeTimers();
		const originalTimeout = process.env.SUPERVISOR_LLM_TIMEOUT_MS;
		delete process.env.SUPERVISOR_LLM_TIMEOUT_MS;
		try {
			const handle = createStructuredLlmAbortSignal({});

			vi.advanceTimersByTime(179_999);
			expect(handle.signal.aborted).toBe(false);
			vi.advanceTimersByTime(1);
			expect(handle.signal.aborted).toBe(true);
		} finally {
			if (originalTimeout === undefined)
				delete process.env.SUPERVISOR_LLM_TIMEOUT_MS;
			else process.env.SUPERVISOR_LLM_TIMEOUT_MS = originalTimeout;
		}
	});
});
