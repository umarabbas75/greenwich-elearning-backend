/*
  Warnings:

  - Added the required column `isAnswerCorrect` to the `quiz_answers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "quiz_answers" ADD COLUMN     "isAnswerCorrect" BOOLEAN NOT NULL;
