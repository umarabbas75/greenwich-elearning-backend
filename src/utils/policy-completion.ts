/**
 * Whether a learner has completed a policy. The policies page, the course
 * access check and the course list all use this, so they always agree.
 *
 * Complete when the policy's acknowledgement row says so, or when every
 * required item that applies to the learner is acknowledged. The row is only
 * written when an item is ticked, so it goes stale when an admin removes the
 * last outstanding item. When none of the required items apply (the whole
 * policy came after they enrolled), every required item counts, as in
 * markPolicyItemAsComplete. A policy with no required items has nothing to
 * complete.
 */
export function isPolicyComplete(
  acknowledged: boolean,
  requiredItems: Array<{ applies: boolean; isComplete: boolean }>,
): boolean {
  if (acknowledged) {
    return true;
  }
  const applicable = requiredItems.filter((item) => item.applies);
  const counted = applicable.length > 0 ? applicable : requiredItems;
  return counted.every((item) => item.isComplete);
}
