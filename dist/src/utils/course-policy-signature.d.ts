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
export declare function coursePoliciesSignature(policies: PolicyShape[]): string;
export {};
