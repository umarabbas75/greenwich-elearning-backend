/*
  Warnings:

  - Added the required column `chapterId` to the `quiz_answers` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "quiz_answers" ADD COLUMN     "chapterId" TEXT NOT NULL;
