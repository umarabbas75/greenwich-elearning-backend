/*
  Warnings:

  - Added the required column `moduleId` to the `sections` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "moduleId" TEXT;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
