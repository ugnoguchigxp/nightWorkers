import { describe, expect, it } from 'vitest';
import {
  buildDesignQuestionnaireFollowUpDecisionSystemPrompt,
  buildDesignQuestionnaireSystemPrompt,
} from '../api/services/structured-generation/prompts/design-questionnaire';
import { questionnaireChoiceFormSchema } from '../shared/schemas/design-questionnaire.schema';

describe('design questionnaire prompts', () => {
  it('asks for starter stack and database choices needed to identify template variants', () => {
    const prompt = buildDesignQuestionnaireSystemPrompt();

    expect(prompt).toContain('使用する技術スタック');
    expect(prompt).toContain('DB/永続化');
    expect(prompt).toContain('branch variant');
    expect(prompt).toContain('Hono + React/Vite');
    expect(prompt).toContain('Python/FastAPI + React/Vite');
    expect(prompt).toContain('SQLite');
    expect(prompt).toContain('PostgreSQL');
    expect(prompt).toContain('pgvector');
    expect(prompt).toContain('Turso/libSQL');
    expect(prompt).toContain('各 options は 2-10 件');
  });

  it('keeps missing template variant inputs in follow-up scope', () => {
    const prompt = buildDesignQuestionnaireFollowUpDecisionSystemPrompt();

    expect(prompt).toContain('使用技術スタック');
    expect(prompt).toContain('DB/永続化');
    expect(prompt).toContain('branch variant');
    expect(prompt).toContain('SQLite');
    expect(prompt).toContain('PostgreSQL');
    expect(prompt).toContain('pgvector');
    expect(prompt).toContain('Turso/libSQL');
    expect(prompt).toContain('各 options は 2-10 件');
  });

  it('accepts up to ten choices in generated choice-form output', () => {
    const tenOptions = Array.from({ length: 10 }, (_, index) => `選択肢${index + 1}`);

    expect(
      questionnaireChoiceFormSchema.safeParse({
        title: 'テンプレート選定',
        questions: [{ text: '使用する DB はどれですか？', type: 'radio', options: tenOptions }],
      }).success
    ).toBe(true);
    expect(
      questionnaireChoiceFormSchema.safeParse({
        title: 'テンプレート選定',
        questions: [
          {
            text: '使用する DB はどれですか？',
            type: 'radio',
            options: [...tenOptions, '選択肢11'],
          },
        ],
      }).success
    ).toBe(false);
  });
});
