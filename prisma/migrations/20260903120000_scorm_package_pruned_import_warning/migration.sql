-- AlterEnum
ALTER TYPE "scorm_package_status" ADD VALUE 'PRUNED';

-- AlterTable
ALTER TABLE "scorm_packages" ADD COLUMN "importWarning" TEXT;
