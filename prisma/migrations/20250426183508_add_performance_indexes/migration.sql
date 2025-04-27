-- CreateIndex
CREATE INDEX "policies_courseId_idx" ON "policies"("courseId");

-- CreateIndex
CREATE INDEX "policy_items_policyId_isRequired_idx" ON "policy_items"("policyId", "isRequired");

-- CreateIndex
CREATE INDEX "policy_items_policyId_order_idx" ON "policy_items"("policyId", "order");

-- CreateIndex
CREATE INDEX "policy_items_policyId_isRequired_order_idx" ON "policy_items"("policyId", "isRequired", "order");

-- CreateIndex
CREATE INDEX "user_policy_completions_userId_courseId_idx" ON "user_policy_completions"("userId", "courseId");

-- CreateIndex
CREATE INDEX "user_policy_completions_policyId_isComplete_idx" ON "user_policy_completions"("policyId", "isComplete");

-- CreateIndex
CREATE INDEX "user_policy_completions_userId_policyId_idx" ON "user_policy_completions"("userId", "policyId");

-- CreateIndex
CREATE INDEX "user_policy_item_completions_userId_itemId_idx" ON "user_policy_item_completions"("userId", "itemId");

-- CreateIndex
CREATE INDEX "user_policy_item_completions_itemId_isComplete_idx" ON "user_policy_item_completions"("itemId", "isComplete");

-- CreateIndex
CREATE INDEX "user_policy_item_completions_userId_isComplete_idx" ON "user_policy_item_completions"("userId", "isComplete");

-- CreateIndex
CREATE INDEX "user_policy_item_completions_userId_itemId_isComplete_idx" ON "user_policy_item_completions"("userId", "itemId", "isComplete");
