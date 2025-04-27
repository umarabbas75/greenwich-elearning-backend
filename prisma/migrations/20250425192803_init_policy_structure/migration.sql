/*
  Warnings:

  - You are about to drop the `course_policies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "course_policies" DROP CONSTRAINT "course_policies_courseId_fkey";

-- DropForeignKey
ALTER TABLE "user_policy_completions" DROP CONSTRAINT "user_policy_completions_policyId_fkey";

-- DropTable
DROP TABLE "course_policies";

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "link" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "policyId" TEXT NOT NULL,

    CONSTRAINT "policy_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_policy_item_completions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_policy_item_completions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_policy_item_completions_userId_itemId_key" ON "user_policy_item_completions"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_items" ADD CONSTRAINT "policy_items_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_policy_completions" ADD CONSTRAINT "user_policy_completions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_policy_item_completions" ADD CONSTRAINT "user_policy_item_completions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_policy_item_completions" ADD CONSTRAINT "user_policy_item_completions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "policy_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
