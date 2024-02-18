/*
  Warnings:

  - You are about to drop the column `timestamp` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `Course` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `Module` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `Section` table. All the data in the column will be lost.
  - You are about to drop the column `timestamp` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Chapter" DROP COLUMN "timestamp";

-- AlterTable
ALTER TABLE "Course" DROP COLUMN "timestamp";

-- AlterTable
ALTER TABLE "Module" DROP COLUMN "timestamp";

-- AlterTable
ALTER TABLE "Section" DROP COLUMN "timestamp";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "timestamp";
