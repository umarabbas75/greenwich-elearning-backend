export declare function normalizeEmail(email: string): string;
export declare function emailEqualsWhere(email: string): {
    email: {
        equals: string;
        mode: "insensitive";
    };
};
