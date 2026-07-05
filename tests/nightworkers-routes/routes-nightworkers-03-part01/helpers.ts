export const sameOriginHeaders = { Origin: 'http://localhost:39174' };
export const representativeDataModelArtifact = {
  artifactKind: 'plan_mode_dedicated_view',
  view: 'data_model',
  title: 'Kanban Data Model',
  summary: 'Kanban board persistence model.',
  canonicalSource: 'ddl',
  ddl: 'CREATE TABLE cards (id TEXT PRIMARY KEY, title TEXT NOT NULL);',
  derivedTables: [
    {
      name: 'cards',
      purpose: 'Stores board cards.',
      columns: [
        { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
        { name: 'title', type: 'TEXT', nullable: false },
      ],
      indexes: [],
    },
  ],
  relations: [],
  constraints: ['Keep cards scoped to a board in follow-up design.'],
  openQuestions: [],
};

export function buildMechanicalQuestionnaireAnswers(session: unknown) {
  const answerByQuestionId = new Map(
    (session.answers || []).map((answer: unknown) => [answer.questionId, answer.answer])
  );
  const questions = session.questionSets.flatMap((set: unknown) =>
    (set.questionnaire?.questionSets || []).flatMap((questionSet: unknown) => questionSet.questions)
  );
  const answers = [];
  for (const question of questions) {
    if (answerByQuestionId.has(question.id)) continue;
    if (!areQuestionDependenciesSatisfied(question, answerByQuestionId)) continue;
    const answer = buildMechanicalQuestionnaireAnswer(question);
    answerByQuestionId.set(question.id, answer);
    answers.push(answer);
  }
  return answers;
}

export function buildMechanicalQuestionnaireAnswer(question: unknown) {
  const options = Array.isArray(question.options) ? question.options : [];
  const optionIds = options.map((option: unknown) => String(option.id)).filter(Boolean);
  const preferredOptionId =
    question.recommendedAnswerId && optionIds.includes(question.recommendedAnswerId)
      ? question.recommendedAnswerId
      : optionIds[0];
  return {
    questionId: question.id,
    selectedOptionIds:
      question.answerType === 'single_choice' && preferredOptionId
        ? [preferredOptionId]
        : question.answerType === 'multi_choice' && preferredOptionId
          ? [preferredOptionId]
          : [],
    booleanValue: question.answerType === 'boolean' ? true : undefined,
    freeText:
      question.answerType === 'free_text' ? `E2E synthetic answer for ${question.id}` : undefined,
    rankedOptionIds: question.answerType === 'ranked' ? optionIds : [],
    deferred: false,
  };
}

export function areQuestionDependenciesSatisfied(
  question: unknown,
  answerByQuestionId: Map<string, unknown>
) {
  const dependencies = Array.isArray(question.dependsOn) ? question.dependsOn : [];
  return dependencies.every((dependency: unknown) => {
    const answer = answerByQuestionId.get(String(dependency.questionId));
    if (!answer) return false;
    return doesAnswerSatisfyDependency(answer, dependency);
  });
}

export function doesAnswerSatisfyDependency(answer: unknown, dependency: unknown) {
  const expected = dependency.value;
  if (typeof expected === 'boolean') {
    if (dependency.operator === 'equals') return answer.booleanValue === expected;
    if (dependency.operator === 'not_equals') return answer.booleanValue !== expected;
    return false;
  }
  const selectedValues = [
    ...(answer.selectedOptionIds || []),
    ...(answer.rankedOptionIds || []),
    ...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
  ];
  const hasExpected = Array.isArray(expected)
    ? expected.some((value) => selectedValues.includes(String(value)))
    : selectedValues.includes(String(expected));
  if (dependency.operator === 'equals' || dependency.operator === 'includes') return hasExpected;
  if (dependency.operator === 'not_equals' || dependency.operator === 'excludes')
    return !hasExpected;
  return false;
}
