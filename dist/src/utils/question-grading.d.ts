import { QuestionType } from '@prisma/client';
export declare const QUIZ_QUESTION_TYPES: readonly ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "FILL_IN_THE_BLANK", "ORDERING", "MATCHING", "VISUAL_ACTIVITY"];
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];
export declare function calculateAutoScore(type: QuestionType, content: any, answer: any, maxMarks: number): number | null;
export declare function shuffleArray<T>(arr: T[]): T[];
export declare function stripCorrectAnswerFields(content: any): any;
