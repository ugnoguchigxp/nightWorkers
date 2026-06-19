import { LoaderCircle, Send } from 'lucide-react';
import type {
  DesignQuestion,
  DesignQuestionDependency,
  DesignQuestionOption,
  DesignQuestionSet,
} from '../../../../shared/schemas/design-questionnaire.schema';
import type { DesignQuestionnaireAnswer, DesignQuestionnaireSession } from '../types';

export function QuestionnaireForm({
  questionGroups,
  answers,
  onChange,
  readOnly = false,
}: {
  questionGroups: DesignQuestionSet[];
  answers: Record<string, DesignQuestionnaireAnswer>;
  onChange: (answers: Record<string, DesignQuestionnaireAnswer>) => void;
  readOnly?: boolean;
}) {
  if (questionGroups.length === 0)
    return <p className="text-xs text-slate-500">No valid question set.</p>;
  const updateAnswer = (questionId: string, patch: Partial<DesignQuestionnaireAnswer>) => {
    const current = answers[questionId] || emptyAnswer(questionId);
    onChange({ ...answers, [questionId]: { ...current, ...patch } });
  };
  return (
    <div className="grid gap-4">
      {questionGroups.map((group) => {
        const questions = (Array.isArray(group.questions) ? group.questions : []).filter(
          (question) => isQuestionDependencySatisfied(question, answers)
        );
        const unanswered = getUnansweredQuestions([group], answers).length;
        return (
          <section key={String(group.id)} className="grid gap-2">
            <div className="flex items-center justify-between gap-3 border-slate-800 border-b pb-1">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">{String(group.title)}</h2>
                <p className="text-[11px] text-slate-500">
                  {String(group.purpose || group.category || '')}
                </p>
              </div>
              <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                {unanswered} unanswered
              </span>
            </div>
            {questions.map((question) => (
              <QuestionCard
                key={String(question.id)}
                question={question}
                answer={answers[question.id] || emptyAnswer(question.id)}
                onChange={(patch) => updateAnswer(question.id, patch)}
                readOnly={readOnly}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function QuestionCard({
  question,
  answer,
  onChange,
  readOnly = false,
}: {
  question: DesignQuestion;
  answer: DesignQuestionnaireAnswer;
  onChange: (patch: Partial<DesignQuestionnaireAnswer>) => void;
  readOnly?: boolean;
}) {
  const options = Array.isArray(question.options) ? question.options : [];
  const isMultiChoice = question.answerType === 'multi_choice';
  return (
    <div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="mt-1 text-sm font-medium text-slate-100">{String(question.question)}</h3>
        </div>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={answer.deferred}
            disabled={readOnly}
            onChange={(event) => onChange({ deferred: event.target.checked })}
          />
          Later
        </label>
      </div>
      {options.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {options.map((option: DesignQuestionOption) => {
            const selected = answer.selectedOptionIds.includes(option.id);
            return (
              <label
                key={String(option.id)}
                className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-left ${
                  selected
                    ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-50'
                    : 'border-slate-800 bg-slate-950/20 text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type={isMultiChoice ? 'checkbox' : 'radio'}
                  name={String(question.id)}
                  checked={selected}
                  disabled={readOnly}
                  onChange={() => {
                    if (isMultiChoice) {
                      onChange({
                        selectedOptionIds: selected
                          ? answer.selectedOptionIds.filter((id) => id !== option.id)
                          : [...answer.selectedOptionIds, option.id],
                      });
                      return;
                    }
                    onChange({
                      selectedOptionIds: selected ? [] : [option.id],
                    });
                  }}
                />
                <span className="font-medium">{String(option.label)}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ActionButton({
  label,
  icon,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  icon?: 'send';
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-950/20 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? (
        <LoaderCircle className="h-3 w-3 animate-spin" />
      ) : icon === 'send' ? (
        <Send className="h-3 w-3" />
      ) : null}
      {label}
    </button>
  );
}

function emptyAnswer(questionId: string): DesignQuestionnaireAnswer {
  return {
    questionId,
    selectedOptionIds: [],
    rankedOptionIds: [],
    deferred: false,
  };
}

export function isAnswered(answer?: DesignQuestionnaireAnswer) {
  return Boolean(
    answer?.deferred ||
      answer?.selectedOptionIds.length ||
      answer?.rankedOptionIds.length ||
      answer?.booleanValue !== undefined ||
      answer?.freeText?.trim()
  );
}

export function isQuestionAnswered(question: DesignQuestion, answer?: DesignQuestionnaireAnswer) {
  if (answer?.deferred) return true;
  if (question.answerType === 'multi_choice') return true;
  return isAnswered(answer);
}

export function getVisibleQuestionnaireQuestions(
  questionGroups: DesignQuestionSet[],
  answers: Record<string, DesignQuestionnaireAnswer>
) {
  return questionGroups.flatMap((group) =>
    (Array.isArray(group.questions) ? group.questions : []).filter((question) =>
      isQuestionDependencySatisfied(question, answers)
    )
  );
}

export function getUnansweredQuestions(
  questionGroups: DesignQuestionSet[],
  answers: Record<string, DesignQuestionnaireAnswer>
) {
  return getVisibleQuestionnaireQuestions(questionGroups, answers).filter(
    (question) => !isQuestionAnswered(question, answers[question.id])
  );
}

export function buildSubmittableQuestionnaireAnswers(
  questionGroups: DesignQuestionSet[],
  answers: Record<string, DesignQuestionnaireAnswer>
) {
  const visibleQuestions = getVisibleQuestionnaireQuestions(questionGroups, answers);
  const merged = { ...answers };
  for (const question of visibleQuestions) {
    if (!merged[question.id] && question.answerType === 'multi_choice') {
      merged[question.id] = emptyAnswer(question.id);
    }
  }
  return Object.values(merged);
}

export function getAnswerProgress(
  questionGroups: DesignQuestionSet[],
  answers: Record<string, DesignQuestionnaireAnswer>
) {
  const questions = getVisibleQuestionnaireQuestions(questionGroups, answers);
  const answeredCount = questions.filter((question) =>
    isQuestionAnswered(question, answers[question.id])
  ).length;
  return {
    answeredCount,
    totalCount: questions.length,
    unansweredCount: Math.max(questions.length - answeredCount, 0),
  };
}

export function getQuestionCount(session: DesignQuestionnaireSession) {
  const answers = Object.fromEntries(session.answers.map((item) => [item.questionId, item.answer]));
  return session.questionSets.reduce((total, set) => {
    const groups = set.questionnaire?.questionSets;
    if (!Array.isArray(groups)) return total;
    return (
      total +
      groups.reduce(
        (sum, group) =>
          sum +
          (Array.isArray(group.questions)
            ? group.questions.filter((question) => isQuestionDependencySatisfied(question, answers))
                .length
            : 0),
        0
      )
    );
  }, 0);
}

function isQuestionDependencySatisfied(
  question: DesignQuestion,
  answers: Record<string, DesignQuestionnaireAnswer>
) {
  const dependencies = Array.isArray(question.dependsOn) ? question.dependsOn : [];
  return dependencies.every((dependency) => {
    const answer = answers[String(dependency.questionId)];
    if (!answer) return false;
    return evaluateQuestionDependency(answer, dependency);
  });
}

function evaluateQuestionDependency(
  answer: DesignQuestionnaireAnswer,
  dependency: DesignQuestionDependency
) {
  const expected = dependency.value;
  const values = [
    ...answer.selectedOptionIds,
    ...answer.rankedOptionIds,
    ...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
  ];
  const hasExpectedString = Array.isArray(expected)
    ? expected.some((value) => values.includes(String(value)))
    : values.includes(String(expected));
  if (typeof expected === 'boolean') {
    if (dependency.operator === 'equals') return answer.booleanValue === expected;
    if (dependency.operator === 'not_equals') return answer.booleanValue !== expected;
    return false;
  }
  if (dependency.operator === 'equals' || dependency.operator === 'includes') {
    return hasExpectedString;
  }
  if (dependency.operator === 'not_equals' || dependency.operator === 'excludes') {
    return !hasExpectedString;
  }
  return false;
}
