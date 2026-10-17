type PolicyItemShape = {
  title?: string | null;
  description?: string | null;
  link?: string | null;
  isRequired?: boolean | null;
  order?: number | null;
};

type PolicyShape = {
  title?: string | null;
  description?: string | null;
  order?: number | null;
  items?: PolicyItemShape[] | null;
};

/**
 * Order-insensitive fingerprint of a course's policies, normalised with the
 * same defaults `updateCourse` applies on create. Two equal signatures mean
 * recreating the policies would change nothing but wipe learner completions.
 */
export function coursePoliciesSignature(policies: PolicyShape[]): string {
  return JSON.stringify(
    policies
      .map((policy) =>
        JSON.stringify({
          title: policy.title ?? '',
          description: policy.description ?? '',
          order: policy.order ?? 0,
          items: (policy.items ?? [])
            .map((item, index) => ({
              title: item.title ?? '',
              description: item.description ?? '',
              link: item.link ?? '',
              isRequired: item.isRequired ?? true,
              order: item.order ?? index,
            }))
            .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
        }),
      )
      .sort(),
  );
}
