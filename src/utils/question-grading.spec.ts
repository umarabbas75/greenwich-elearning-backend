import { QuestionType } from '@prisma/client';
import {
  calculateAutoScore,
  stripCorrectAnswerFields,
  QUIZ_QUESTION_TYPES,
} from './question-grading';

describe('question-grading', () => {
  describe('calculateAutoScore', () => {
    it('returns null when there is no answer yet', () => {
      expect(
        calculateAutoScore(QuestionType.SINGLE_CHOICE, {}, null, 1),
      ).toBeNull();
    });

    it('SINGLE_CHOICE: full marks on exact match, 0 otherwise', () => {
      const content = { correctOptionId: 'b' };
      expect(
        calculateAutoScore(
          QuestionType.SINGLE_CHOICE,
          content,
          { selectedOptionId: 'b' },
          1,
        ),
      ).toBe(1);
      expect(
        calculateAutoScore(
          QuestionType.SINGLE_CHOICE,
          content,
          { selectedOptionId: 'a' },
          1,
        ),
      ).toBe(0);
    });

    it('TRUE_FALSE: full marks on exact boolean match', () => {
      const content = { correctAnswer: true };
      expect(
        calculateAutoScore(
          QuestionType.TRUE_FALSE,
          content,
          { answer: true },
          1,
        ),
      ).toBe(1);
      expect(
        calculateAutoScore(
          QuestionType.TRUE_FALSE,
          content,
          { answer: false },
          1,
        ),
      ).toBe(0);
    });

    it('FILL_IN_THE_BLANK: case-insensitive, trimmed match', () => {
      const content = { correctAnswer: 'financial' };
      expect(
        calculateAutoScore(
          QuestionType.FILL_IN_THE_BLANK,
          content,
          { selectedWord: '  Financial ' },
          1,
        ),
      ).toBe(1);
      expect(
        calculateAutoScore(
          QuestionType.FILL_IN_THE_BLANK,
          content,
          { selectedWord: 'moral' },
          1,
        ),
      ).toBe(0);
    });

    it('MULTIPLE_CHOICE: Jaccard similarity for partial credit', () => {
      const content = { correctOptionIds: ['a', 'c'] };
      // intersection {a} = 1, union {a,b,c} = 3 -> 1/3
      expect(
        calculateAutoScore(
          QuestionType.MULTIPLE_CHOICE,
          content,
          { selectedOptionIds: ['a', 'b'] },
          1,
        ),
      ).toBeCloseTo(1 / 3);
      // exact match -> full marks
      expect(
        calculateAutoScore(
          QuestionType.MULTIPLE_CHOICE,
          content,
          { selectedOptionIds: ['a', 'c'] },
          1,
        ),
      ).toBe(1);
    });

    it('ORDERING: positional match fraction', () => {
      const content = { correctOrder: ['1', '2', '3', '4'] };
      // 2 of 4 positions correct (3, 4) => 2/4
      expect(
        calculateAutoScore(
          QuestionType.ORDERING,
          content,
          { orderedIds: ['2', '1', '3', '4'] },
          1,
        ),
      ).toBe(0.5);
    });

    it('MATCHING: correct-pair fraction (leftId === rightId)', () => {
      const content = {
        pairs: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      };
      const answer = {
        pairs: [
          { leftId: 'p1', rightId: 'p1' },
          { leftId: 'p2', rightId: 'p2' },
          { leftId: 'p3', rightId: 'WRONG' },
        ],
      };
      expect(
        calculateAutoScore(QuestionType.MATCHING, content, answer, 1),
      ).toBeCloseTo(2 / 3);
    });

    it('VISUAL_ACTIVITY: behaves like SINGLE_CHOICE when allowMultiple is false', () => {
      const content = {
        allowMultiple: false,
        options: [
          { id: 'a', isCorrect: false },
          { id: 'b', isCorrect: true },
        ],
      };
      expect(
        calculateAutoScore(
          QuestionType.VISUAL_ACTIVITY,
          content,
          { selectedOptionIds: ['b'] },
          1,
        ),
      ).toBe(1);
      expect(
        calculateAutoScore(
          QuestionType.VISUAL_ACTIVITY,
          content,
          { selectedOptionIds: ['a'] },
          1,
        ),
      ).toBe(0);
    });

    it('VISUAL_ACTIVITY: behaves like MULTIPLE_CHOICE when allowMultiple is true', () => {
      const content = {
        allowMultiple: true,
        options: [
          { id: 'a', isCorrect: true },
          { id: 'b', isCorrect: false },
          { id: 'c', isCorrect: true },
        ],
      };
      expect(
        calculateAutoScore(
          QuestionType.VISUAL_ACTIVITY,
          content,
          { selectedOptionIds: ['a', 'b'] },
          1,
        ),
      ).toBeCloseTo(1 / 3);
    });

    it('SHORT_ANSWER/LONG_ANSWER: null (manual grading only)', () => {
      expect(
        calculateAutoScore(QuestionType.SHORT_ANSWER, {}, { text: 'hi' }, 1),
      ).toBeNull();
    });

    it('excludes SHORT_ANSWER/LONG_ANSWER from the quiz-allowed type list', () => {
      expect(QUIZ_QUESTION_TYPES).not.toContain(QuestionType.SHORT_ANSWER);
      expect(QUIZ_QUESTION_TYPES).not.toContain(QuestionType.LONG_ANSWER);
      expect(QUIZ_QUESTION_TYPES).toHaveLength(7);
    });
  });

  describe('stripCorrectAnswerFields', () => {
    it('removes simple correct-answer fields', () => {
      const content = {
        correctOptionId: 'b',
        correctOptionIds: ['a'],
        correctAnswer: 'x',
        correctOrder: ['1', '2'],
        other: 'kept',
      };
      const stripped = stripCorrectAnswerFields(content);
      expect(stripped).toEqual({ other: 'kept' });
      // never mutates the input
      expect(content.correctOptionId).toBe('b');
    });

    it('strips isCorrect/right from options, keeping only {id, text}', () => {
      const content = {
        options: [
          { id: 'a', text: 'Option A', isCorrect: false },
          { id: 'b', text: 'Option B', isCorrect: true },
        ],
      };
      expect(stripCorrectAnswerFields(content)).toEqual({
        options: [
          { id: 'a', text: 'Option A' },
          { id: 'b', text: 'Option B' },
        ],
      });
    });

    it('MATCHING: strips `right` from pairs and derives a shuffled categories list', () => {
      const content = {
        pairs: [
          { id: 'p1', left: 'Left 1', right: 'Right 1' },
          { id: 'p2', left: 'Left 2', right: 'Right 2' },
        ],
      };
      const stripped = stripCorrectAnswerFields(content);
      expect(stripped.pairs).toEqual([
        { id: 'p1', left: 'Left 1' },
        { id: 'p2', left: 'Left 2' },
      ]);
      expect(stripped.categories).toEqual(
        expect.arrayContaining([
          { id: 'p1', text: 'Right 1' },
          { id: 'p2', text: 'Right 2' },
        ]),
      );
      expect(stripped.categories).toHaveLength(2);
    });

    it('passes through null/undefined content unchanged', () => {
      expect(stripCorrectAnswerFields(null)).toBeNull();
      expect(stripCorrectAnswerFields(undefined)).toBeUndefined();
    });
  });
});
