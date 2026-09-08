-- Quiz multi-type question support (chapter quizzes gain the same 7
-- auto-gradable question types as the Assessment feature; SHORT_ANSWER and
-- LONG_ANSWER are excluded since chapter quizzes must stay fully automated).
-- Reuses the existing "QuestionType" enum. All new columns are nullable with
-- no default: existing rows stay untouched and are treated as legacy MCQ
-- whenever "type" is null. See docs/quiz-question-types-backend-handoff.md.

DO $$ BEGIN
  ALTER TABLE "quizzes" ADD COLUMN "type" "QuestionType";
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "quizzes" ADD COLUMN "content" JSONB;
EXCEPTION WHEN duplicate_column THEN null; END $$;

-- "answer" was NOT NULL — a multi-type quiz has no single legacy answer
-- string (it's graded via "content" instead), so it must accept NULL. Legacy
-- rows are unaffected.
ALTER TABLE "quizzes" ALTER COLUMN "answer" DROP NOT NULL;

-- quiz_answers: "studentAnswer" holds the polymorphic multi-type answer
-- shape; "systemScore" holds the auto-graded score (0..1, one quiz question
-- = 1 mark). "answer" is relaxed to nullable for the same reason as above.
DO $$ BEGIN
  ALTER TABLE "quiz_answers" ADD COLUMN "studentAnswer" JSONB;
EXCEPTION WHEN duplicate_column THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "quiz_answers" ADD COLUMN "systemScore" DOUBLE PRECISION;
EXCEPTION WHEN duplicate_column THEN null; END $$;

ALTER TABLE "quiz_answers" ALTER COLUMN "answer" DROP NOT NULL;
