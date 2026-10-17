"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coursePoliciesSignature = void 0;
function coursePoliciesSignature(policies) {
    return JSON.stringify(policies
        .map((policy) => JSON.stringify({
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
    }))
        .sort());
}
exports.coursePoliciesSignature = coursePoliciesSignature;
//# sourceMappingURL=course-policy-signature.js.map