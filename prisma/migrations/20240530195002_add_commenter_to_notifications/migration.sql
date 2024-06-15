-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "commenterId" TEXT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_commenterId_fkey" FOREIGN KEY ("commenterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
