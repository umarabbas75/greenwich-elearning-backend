-- DropForeignKey
ALTER TABLE "sections" DROP CONSTRAINT "sections_moduleId_fkey";

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
