import { QuestionType } from '@prisma/client';

/**
 * The 7 auto-gradable question types chapter quizzes support. Deliberately
 * excludes SHORT_ANSWER and LONG_ANSWER (the Assessment feature's 2 manual-
 * grading types) — a chapter quiz must remain fully automated.
 * See docs/quiz-question-types-backend-handoff.md.
 */
export const QUIZ_QUESTION_TYPES = [
  QuestionType.SINGLE_CHOICE,
  QuestionType.MULTIPLE_CHOICE,
  QuestionType.TRUE_FALSE,
  QuestionType.FILL_IN_THE_BLANK,
  QuestionType.ORDERING,
  QuestionType.MATCHING,
  QuestionType.VISUAL_ACTIVITY,
] as const;

export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

/**
 * Shared auto-grading for a single question, one content/answer pair at a
 * time. Extracted from CourseAssessmentService._calculateAutoScore so chapter
 * quizzes and the Assessment feature grade identically (see the "Recommendation:
 * Code Reuse with Assessment Module" section of the quiz multi-type handoff doc).
 *
 * Returns a score in [0, maxMarks], or null when the type has no auto-grading
 * (SHORT_ANSWER / LONG_ANSWER — not reachable for quizzes, which never carry
 * those types, but kept here so this stays a drop-in replacement for the
 * assessment's version).
 */
export function calculateAutoScore(
  type: QuestionType,
  content: any,
  answer: any,
  maxMarks: number,
): number | null {
  if (!answer) return null;

  switch (type) {
    case QuestionType.SINGLE_CHOICE:
      return answer.selectedOptionId === content.correctOptionId ? maxMarks : 0;

    case QuestionType.TRUE_FALSE:
      return answer.answer === content.correctAnswer ? maxMarks : 0;

    case QuestionType.FILL_IN_THE_BLANK:
      return (answer.selectedWord ?? '').toLowerCase().trim() ===
        (content.correctAnswer ?? '').toLowerCase().trim()
        ? maxMarks
        : 0;

    case QuestionType.MULTIPLE_CHOICE: {
      const correct: Set<string> = new Set(content.correctOptionIds ?? []);
      const selected: Set<string> = new Set(answer.selectedOptionIds ?? []);
      const intersection = [...correct].filter((x) => selected.has(x)).length;
      const union = new Set([...correct, ...selected]).size;
      return union === 0 ? 0 : (intersection / union) * maxMarks;
    }

    case QuestionType.VISUAL_ACTIVITY: {
      const correct: Set<string> = new Set(
        content.options
          ?.filter((o: any) => o.isCorrect)
          .map((o: any) => o.id) ?? [],
      );
      const selected: Set<string> = new Set(answer.selectedOptionIds ?? []);
      if (correct.size === 1 && !content.allowMultiple) {
        const [onlyCorrect] = correct;
        return selected.has(onlyCorrect) && selected.size === 1 ? maxMarks : 0;
      }
      const intersection = [...correct].filter((x) => selected.has(x)).length;
      const union = new Set([...correct, ...selected]).size;
      return union === 0 ? 0 : (intersection / union) * maxMarks;
    }

    case QuestionType.ORDERING: {
      const correct: string[] = content.correctOrder ?? [];
      const given: string[] = answer.orderedIds ?? [];
      const matches = correct.filter((id, idx) => given[idx] === id).length;
      return correct.length === 0 ? 0 : (matches / correct.length) * maxMarks;
    }

    case QuestionType.MATCHING: {
      const pairs: Array<{ id: string }> = content.pairs ?? [];
      const givenPairs: Array<{ leftId: string; rightId: string }> =
        answer.pairs ?? [];
      const correct = givenPairs.filter(
        (gp) => gp.leftId === gp.rightId,
      ).length;
      return pairs.length === 0 ? 0 : (correct / pairs.length) * maxMarks;
    }

    case QuestionType.SHORT_ANSWER:
    case QuestionType.LONG_ANSWER:
      return null;

    default:
      return null;
  }
}

/** Fisher-Yates shuffle — used to randomize MATCHING's derived categories list. */
export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Strips correct-answer fields from one question's content before it is sent
 * to a student — extracted from CourseAssessmentService._stripCorrectAnswers'
 * per-snapshot sanitization so it can be shared with chapter quizzes. Never
 * mutates the input.
 */
export function stripCorrectAnswerFields(content: any): any {
  if (!content) return content;
  const sanitized = { ...content };
  delete sanitized.correctOptionId;
  delete sanitized.correctOptionIds;
  delete sanitized.correctAnswer;
  delete sanitized.correctOrder;
  if (sanitized.pairs) {
    const categories = shuffleArray(
      sanitized.pairs.map((p: any) => ({ id: p.id, text: p.right })),
    );
    sanitized.categories = categories;
    sanitized.pairs = sanitized.pairs.map((p: any) => ({
      id: p.id,
      left: p.left,
    }));
  }
  if (sanitized.options) {
    sanitized.options = sanitized.options.map((o: any) => ({
      id: o.id,
      text: o.text,
    }));
  }
  return sanitized;
}
